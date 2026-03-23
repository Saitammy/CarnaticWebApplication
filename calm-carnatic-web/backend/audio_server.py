from fastapi import FastAPI, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import tempfile
import shutil
import os
import time
import numpy as np
import librosa
from tensorflow.keras.models import load_model # type: ignore
import google.generativeai as genai

# ---------------- CONFIG ----------------

BASE_DIR = os.path.dirname(__file__)

MODEL_PATH = os.path.join(BASE_DIR, "emotion", "Emotion_Voice_Detection_Model.h5")
RAGA_DIR = os.path.join(BASE_DIR, "emotion", "ragas")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

SAMPLE_RATE = 22050

# ---------------- LOAD MODEL ----------------

model = load_model(MODEL_PATH)

LABELS = {
    0: 'Neutral',
    1: 'Calm',
    2: 'Happy',
    3: 'Sad',
    4: 'Angry',
    5: 'Fearful',
    6: 'Disgust',
    7: 'Surprised'
}

# ---------------- RAGA MAP ----------------
RAGA_MAP = {
    "Neutral": "Abhogi",
    "Calm": "Abhogi",
    "Happy": "Bilahari",
    "Sad": "Thodi",
    "Angry": "Vakulabharanam",
    "Fearful": "Kalyani",
    "Disgust": "Vakulabharanam",
    "Surprised": "Bilahari"
}

# ---------------- FASTAPI ----------------

app = FastAPI(title="Audio Emotion Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/raagas", StaticFiles(directory=RAGA_DIR), name="raagas")

# ---------------- CNN ----------------

def predict_emotion(file_path):
    data, sr = librosa.load(file_path, sr=SAMPLE_RATE)
    mfcc = librosa.feature.mfcc(y=data, sr=sr, n_mfcc=40)
    mfccs = np.concatenate([
        np.mean(mfcc.T, axis=0),
        np.std(mfcc.T, axis=0)
    ])
    x = np.expand_dims(mfccs, axis=-1)
    x = np.expand_dims(x, axis=0)

    preds = model.predict(x, verbose=0)
    cls = np.argmax(preds, axis=1)[0]
    return LABELS[cls]

# ---------------- GEMINI ----------------

def get_working_model():
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            if 'flash' in m.name.lower():
                return m.name
            if 'pro' in m.name.lower():
                return m.name
    return "models/gemini-1.5-flash"


def predict_gemini(file_path):
    if not GEMINI_API_KEY:
        return None

    genai.configure(api_key=GEMINI_API_KEY)
    myfile = genai.upload_file(file_path)

    while myfile.state.name == "PROCESSING":
        time.sleep(1)
        myfile = genai.get_file(myfile.name)

    if myfile.state.name == "FAILED":
        return None

    model_name = get_working_model()
    model_ai = genai.GenerativeModel(model_name)

    response = model_ai.generate_content([
        myfile,
        "Classify emotion as: Neutral, Calm, Happy, Sad, Angry, Fearful, Disgust, Surprised. Return ONLY the single word."
    ])
    
    return response.text.strip().capitalize()

# ---------------- FINAL LOGIC ----------------

def get_final_emotion(audio_file):
    print("\n🔍 Running Dual-Model Consensus Protocol...")
    
    cnn_emotion = predict_emotion(audio_file)
    print(f"🤖 CNN Prediction: {cnn_emotion}")
    
    gemini_emotion = None
    try:
        gemini_emotion = predict_gemini(audio_file)
        print(f"✨ Gemini Prediction: {gemini_emotion}")
    except Exception as e:
        print(f"⚠️ Gemini failsafe offline: {e}")

    final_emotion = cnn_emotion
    
    if not gemini_emotion:
        print("⚠️ No Gemini consensus available. Defaulting to CNN.")
    elif cnn_emotion == gemini_emotion:
        print("✅ CONSENSUS REACHED! Models match. Proceeding with CNN output.")
    else:
        print("⚖️ MISMATCH DETECTED! Gemini overriding CNN baseline.")
        if gemini_emotion in RAGA_MAP:
            final_emotion = gemini_emotion
        else:
            print(f"⚠️ Gemini output '{gemini_emotion}' not in Raga map. Falling back to CNN.")

    # We now return a dictionary with all the data for the React UI
    return {
        "cnn": cnn_emotion,
        "gemini": gemini_emotion if gemini_emotion else "N/A",
        "final": final_emotion
    }

# ---------------- API ROUTES ----------------

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    with temp_file as f:
        shutil.copyfileobj(file.file, f)
        temp_path = f.name
    try:
        results = get_final_emotion(temp_path)
        raga_name = RAGA_MAP.get(results["final"], "Unknown")
        raga_file = raga_name.lower() + ".mp3"
        raga_url = f"http://localhost:8001/raagas/{raga_file}"
    finally:
        os.remove(temp_path)
        
    return {
        "cnn_emotion": results["cnn"],
        "gemini_emotion": results["gemini"],
        "final_emotion": results["final"],
        "raga": raga_name,
        "raga_url": raga_url
    }


@app.post("/predict-live")
async def predict_live(file: UploadFile = File(...)):
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    with temp_file as f:
        shutil.copyfileobj(file.file, f)
        temp_path = f.name
    try:
        results = get_final_emotion(temp_path)
        raga_name = RAGA_MAP.get(results["final"], "Unknown")
        raga_file = raga_name.lower() + ".mp3"
        raga_url = f"http://localhost:8001/raagas/{raga_file}"
    finally:
        os.remove(temp_path)
        
    return {
        "cnn_emotion": results["cnn"],
        "gemini_emotion": results["gemini"],
        "final_emotion": results["final"],
        "raga": raga_name,
        "raga_url": raga_url
    }