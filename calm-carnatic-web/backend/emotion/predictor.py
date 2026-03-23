import numpy as np
import librosa
from keras.models import load_model
import os

# Load model once
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.h5")
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

SAMPLE_RATE = 22050

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