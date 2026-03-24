"""
RagaChikitsa - Unified Backend Server
======================================
Runs on a single port (default: 8000)

Routes:
  WS  /ws/eeg           -> BrainLink EEG live stream
  POST /predict          -> Audio file emotion detection
  POST /predict-live     -> Live recorded audio emotion detection
  GET  /raagas/{file}    -> Serve raga MP3 files (static)

Usage:
  uvicorn server:app --host 0.0.0.0 --port 8000
"""

import asyncio
import json
import os
import time
import tempfile
import shutil

# Load .env file if present (works on all terminals/OS without any export commands)
try:
    from dotenv import load_dotenv # type: ignore
    load_dotenv()
except ImportError:
    pass  # python-dotenv not installed, fall back to system env vars

import numpy as np
import serial.tools.list_ports
import librosa

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import cushy_serial                         # pip install cushy-serial
from BrainLinkParser import BrainLinkParser # type: ignore # local dependency

from tensorflow.keras.models import load_model  # type: ignore
import google.generativeai as genai

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

BASE_DIR     = os.path.dirname(__file__)
MODEL_PATH   = os.path.join(BASE_DIR, "emotion", "Emotion_Voice_Detection_Model.h5")
RAGA_DIR     = os.path.join(BASE_DIR, "emotion", "ragas")
GEMINI_API_KEY  = os.getenv("GEMINI_API_KEY", "")
USE_GEMINI      = os.getenv("USE_GEMINI", "true").lower() == "true"
SAMPLE_RATE     = 22050

# ─────────────────────────────────────────────
# LOAD CNN MODEL (once, at startup)
# ─────────────────────────────────────────────

cnn_model = load_model(MODEL_PATH)

LABELS = {
    0: "Neutral",
    1: "Calm",
    2: "Happy",
    3: "Sad",
    4: "Angry",
    5: "Fearful",
    6: "Disgust",
    7: "Surprised",
}

RAGA_MAP = {
    "Neutral":   "Abhogi",
    "Calm":      "Abhogi",
    "Happy":     "Bilahari",
    "Sad":       "Thodi",
    "Angry":     "Vakulabharanam",
    "Fearful":   "Kalyani",
    "Disgust":   "Vakulabharanam",
    "Surprised": "Bilahari",
}

# ─────────────────────────────────────────────
# FASTAPI APP
# ─────────────────────────────────────────────

app = FastAPI(title="RagaChikitsa Unified API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve raga MP3 files at /raagas/<filename>
app.mount("/raagas", StaticFiles(directory=RAGA_DIR), name="raagas")


# ─────────────────────────────────────────────
# EEG — BrainLink helpers
# ─────────────────────────────────────────────

def get_brainlink_port() -> str:
    """
    Scan all COM/serial ports and return the most likely BrainLink port.
    Falls back to COM3 on Windows or /dev/rfcomm0 on Linux if nothing is found.
    """
    ports = serial.tools.list_ports.comports()
    for port in ports:
        desc = port.description or ""
        hwid = port.hwid or ""
        if "Bluetooth" in desc or "BthEnum" in hwid or "rfcomm" in port.device:
            print(f"🔍 Auto-detected BrainLink candidate: {port.device} ({desc})")
            return port.device

    # Platform-aware fallback
    import platform
    fallback = "COM3" if platform.system() == "Windows" else "/dev/rfcomm0"
    print(f"⚠️  No Bluetooth port found. Using fallback: {fallback}")
    return fallback


# ─────────────────────────────────────────────
# EEG — WebSocket endpoint
# ─────────────────────────────────────────────

@app.websocket("/ws/eeg")
async def eeg_endpoint(websocket: WebSocket):
    """
    Streams alpha/beta ratio values to the React frontend in real time.
    Reconnects safely if the serial port drops.
    """
    await websocket.accept()
    print("🌐 Frontend connected to /ws/eeg")

    latest_ratio_holder = {"value": None}

    # ── EEG parser callbacks ──────────────────
    def on_raw(raw): pass
    def on_extend_eeg(data): pass
    def on_gyro(x, y, z): pass
    def on_rr(rr1, rr2, rr3): pass

    def on_eeg(data):
        try:
            alpha = getattr(data, "lowAlpha", 0) + getattr(data, "highAlpha", 0)
            beta  = getattr(data, "lowBeta",  0) + getattr(data, "highBeta",  0)
            if beta > 0:
                ratio = alpha / beta
                latest_ratio_holder["value"] = ratio
                print(f"🧠 α/β ratio: {ratio:.3f}")
        except Exception as e:
            print(f"⚠️  EEG parse error: {e}")

    target_port = get_brainlink_port()
    serial_conn = None

    try:
        await websocket.send_text(json.dumps({"port": target_port, "status": "connected"}))

        # CushySerial opens the port and handles raw byte streaming
        serial_conn = cushy_serial.CushySerial(target_port, 115200)
        parser = BrainLinkParser(on_eeg, on_extend_eeg, on_gyro, on_rr, on_raw)

        @serial_conn.on_message()
        def handle_message(msg: bytes):
            parser.parse(msg)

        print(f"✅ {target_port} open — streaming brainwaves...")

        while True:
            ratio = latest_ratio_holder["value"]
            if ratio is not None:
                await websocket.send_text(json.dumps({"ratio": ratio}))
                latest_ratio_holder["value"] = None
            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        print("🚫 Frontend disconnected from /ws/eeg")
    except Exception as e:
        print(f"⚠️  EEG server error on {target_port}: {e}")
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        if serial_conn:
            try:
                serial_conn.close()
            except Exception:
                pass
            print(f"🔒 {target_port} closed safely.")


# ─────────────────────────────────────────────
# AUDIO — CNN prediction
# ─────────────────────────────────────────────

def predict_cnn(file_path: str) -> str:
    data, sr = librosa.load(file_path, sr=SAMPLE_RATE)
    mfcc = librosa.feature.mfcc(y=data, sr=sr, n_mfcc=40)
    features = np.concatenate([
        np.mean(mfcc.T, axis=0),
        np.std(mfcc.T, axis=0),
    ])
    x = np.expand_dims(features, axis=-1)
    x = np.expand_dims(x, axis=0)
    preds = cnn_model.predict(x, verbose=0)
    return LABELS[int(np.argmax(preds, axis=1)[0])]


# ─────────────────────────────────────────────
# AUDIO — Gemini prediction (fallback validator)
# ─────────────────────────────────────────────

def _pick_gemini_model() -> str:
    """
    Pick the best available Gemini model by exact name matching.
    Tries each preferred model name in order, picks first one available.
    """
    # Exact model names in priority order — most capable/quota-friendly first
    preferred_models = [
        "models/gemini-2.5-flash",
        "models/gemini-2.5-pro",
        "models/gemini-2.0-flash-lite",
        "models/gemini-2.0-flash-lite-001",
        "models/gemini-2.0-flash",
        "models/gemini-1.5-flash-8b",
        "models/gemini-1.5-flash",
    ]
    available = set()
    try:
        for m in genai.list_models():
            if "generateContent" in m.supported_generation_methods:
                available.add(m.name)
        print(f"📋 Available Gemini models: {sorted(available)}")
    except Exception:
        return "models/gemini-2.5-flash"

    for model in preferred_models:
        if model in available:
            return model

    # Last resort: return whatever is available
    return next(iter(available), "models/gemini-2.5-flash")


def predict_gemini(file_path: str) -> str | None:
    """
    Secondary emotion validator using Gemini.
    Returns a single emotion word or None on failure.
    Includes retry logic for 429 rate limit errors.
    Operates anonymously — no user data is stored.
    """
    if not GEMINI_API_KEY or not USE_GEMINI:
        if not USE_GEMINI:
            print("ℹ️  Gemini disabled via USE_GEMINI=false in .env")
        else:
            print("⚠️  No Gemini API key found. Check your .env file.")
        return None

    genai.configure(api_key=GEMINI_API_KEY)

    try:
        uploaded = genai.upload_file(file_path)

        # Wait for Gemini to finish processing the file
        for _ in range(15):
            if uploaded.state.name != "PROCESSING":
                break
            time.sleep(1)
            uploaded = genai.get_file(uploaded.name)

        if uploaded.state.name == "FAILED":
            print("⚠️  Gemini file processing failed.")
            return None

        model_name = _pick_gemini_model()
        print(f"✨ Using Gemini model: {model_name}")
        ai = genai.GenerativeModel(model_name)

        # Retry up to 3 times on rate limit (429) with backoff
        response = None
        last_error = None
        for attempt in range(3):
            try:
                response = ai.generate_content([
                    uploaded,
                    (
                        "You are a silent emotion classifier. "
                        "Listen to this audio and classify the speaker's emotion as exactly one of: "
                        "Neutral, Calm, Happy, Sad, Angry, Fearful, Disgust, Surprised. "
                        "Respond with ONLY that single word, nothing else."
                    ),
                ])
                break  # success
            except Exception as e:
                last_error = e
                if "429" in str(e) or "quota" in str(e).lower():
                    wait = (attempt + 1) * 10  # 10s, 20s, 30s
                    print(f"⏳ Rate limit hit. Waiting {wait}s before retry {attempt + 1}/3...")
                    time.sleep(wait)
                else:
                    raise

        if response is None:
            print(f"⚠️  Gemini failed after 3 retries: {last_error}")
            return None

        # Clean up uploaded file from Gemini servers immediately
        try:
            genai.delete_file(uploaded.name)
        except Exception:
            pass

        result = response.text.strip().capitalize()
        if result in LABELS.values():
            return result
        print(f"⚠️  Gemini returned unrecognised label: '{result}'")
        return None

    except Exception as e:
        print(f"⚠️  Gemini error: {e}")
        return None


# ─────────────────────────────────────────────
# AUDIO — Dual-model consensus logic
# ─────────────────────────────────────────────

def get_final_emotion(audio_path: str) -> dict:
    print("\n🔍 Running Dual-Model Consensus Protocol...")

    cnn_emotion = predict_cnn(audio_path)
    print(f"🤖 CNN  → {cnn_emotion}")

    gemini_emotion = None
    try:
        gemini_emotion = predict_gemini(audio_path)
        print(f"✨ Gemini → {gemini_emotion}")
    except Exception as e:
        print(f"⚠️  Gemini offline: {e}")

    final_emotion = cnn_emotion

    if not gemini_emotion:
        print("⚠️  No Gemini result. Using CNN output.")
    elif cnn_emotion == gemini_emotion:
        print("✅ Both models agree.")
    else:
        print("⚖️  Mismatch — Gemini overrides CNN.")
        if gemini_emotion in RAGA_MAP:
            final_emotion = gemini_emotion
        else:
            print(f"⚠️  Gemini label '{gemini_emotion}' not in Raga map. Keeping CNN.")

    return {
        "cnn":    cnn_emotion,
        "gemini": gemini_emotion or "N/A",
        "final":  final_emotion,
    }


def build_audio_response(results: dict) -> dict:
    raga_name = RAGA_MAP.get(results["final"], "Unknown")
    raga_file = raga_name.lower() + ".mp3"
    # Points to the /raagas static mount on the same server
    raga_url  = f"http://localhost:8000/raagas/{raga_file}"
    return {
        "cnn_emotion":    results["cnn"],
        "gemini_emotion": results["gemini"],
        "final_emotion":  results["final"],
        "raga":           raga_name,
        "raga_url":       raga_url,
    }


# ─────────────────────────────────────────────
# AUDIO — REST endpoints
# ─────────────────────────────────────────────

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    """Predict emotion from an uploaded audio file."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    with tmp as f:
        shutil.copyfileobj(file.file, f)
        tmp_path = f.name
    try:
        results = get_final_emotion(tmp_path)
    finally:
        os.remove(tmp_path)
    return build_audio_response(results)


@app.post("/predict-live")
async def predict_live(file: UploadFile = File(...)):
    """Predict emotion from a live recording sent by the browser."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    with tmp as f:
        shutil.copyfileobj(file.file, f)
        tmp_path = f.name
    try:
        results = get_final_emotion(tmp_path)
    finally:
        os.remove(tmp_path)
    return build_audio_response(results)