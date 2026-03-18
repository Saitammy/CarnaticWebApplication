import serial
import time

print("Opening COM3...")
try:
    # Bypassing cushy_serial entirely to read the raw buffer
    with serial.Serial('COM3', 115200, timeout=1) as ser:
        print("Connected! Listening to the raw hardware stream...")
        print("(Press Ctrl+C to stop)\n")
        
        while True:
            # Attempt to read chunks of raw bytes
            raw_bytes = ser.read(50) 
            
            if raw_bytes:
                print(f"DATA RECEIVED: {raw_bytes.hex()}")
            else:
                print("... dead air ...")
                
            time.sleep(0.5)

except Exception as e:
    print(f"Hardware error: {e}")