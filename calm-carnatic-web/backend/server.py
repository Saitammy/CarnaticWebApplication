import asyncio
import json
import serial.tools.list_ports
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import cushy_serial # type: ignore
from BrainLinkParser import BrainLinkParser # type: ignore

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

latest_ratio = None

def onRaw(raw): pass
def onExtendEEG(data): pass
def onGyro(x, y, z): pass
def onRR(rr1, rr2, rr3): pass

def onEEG(data):
    global latest_ratio
    try:
        alpha = getattr(data, 'lowAlpha', 0) + getattr(data, 'highAlpha', 0)
        beta = getattr(data, 'lowBeta', 0) + getattr(data, 'highBeta', 0)
        
        if beta > 0:
            latest_ratio = alpha / beta
            print(f"🧠 Valid Brainwave Calculated! Ratio: {latest_ratio:.3f}")
    except Exception as e:
        print(f"Parsing error: {e}")

def get_brainlink_port():
    """Scans hardware and finds the active Bluetooth COM port"""
    ports = serial.tools.list_ports.comports()
    for port in ports:
        # Windows usually labels these as 'Standard Serial over Bluetooth link'
        if "Bluetooth" in port.description or "BthEnum" in port.hwid:
            return port.device
    return "COM3" # Fallback if scanning fails

@app.websocket("/ws/eeg")
async def eeg_endpoint(websocket: WebSocket):
    global latest_ratio
    await websocket.accept()
    print("🌐 React Frontend connected!")
    
    serial_conn = None
    target_port = get_brainlink_port()
    
    try:
        print(f"🔌 Auto-detected device on {target_port}. Attempting to open...")
        
        # Tell the React frontend which port we found
        await websocket.send_text(json.dumps({"port": target_port, "status": "connected"}))
        
        serial_conn = cushy_serial.CushySerial(target_port, 115200)
        parser = BrainLinkParser(onEEG, onExtendEEG, onGyro, onRR, onRaw)
        print(f"✅ {target_port} Opened. Listening for brainwaves...")

        @serial_conn.on_message()
        def handle_message(msg: bytes):
            parser.parse(msg)

        while True:
            if latest_ratio is not None:
                await websocket.send_text(json.dumps({"ratio": latest_ratio}))
                latest_ratio = None
            
            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        print("🚫 React Frontend disconnected.")
    except Exception as e:
        print(f"⚠️ Server Error on {target_port}: {e}")
        await websocket.send_text(json.dumps({"error": str(e)}))
    finally:
        if serial_conn:
            serial_conn.close()
            print(f"🔒 {target_port} port safely closed.")