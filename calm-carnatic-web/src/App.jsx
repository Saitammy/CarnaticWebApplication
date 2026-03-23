import { useEffect, useRef, useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';

function App() {
  // ================= GLOBAL APP STATE =================
  const [user, setUser] = useState(null); 
  const [currentView, setCurrentView] = useState('login'); 

  // ================= STATE: EEG PIPELINE =================
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [timer, setTimer] = useState(0);
  const [ratios, setRatios] = useState([]);
  const [suggestedRaaga, setSuggestedRaaga] = useState("");
  const [averageRatio, setAverageRatio] = useState(null);
  const [activePort, setActivePort] = useState("OFFLINE");

  // ================= STATE: CUSTOM AUDIO PLAYER =================
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);

  // ================= STATE: VOICE PIPELINE =================
  const [emotionResult, setEmotionResult] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);

  // ================= REFS =================
  const ws = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);         
  const emotionAudioRef = useRef(null);  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const audioFiles = {
    "Ananda Bhairavi": "/audio/ananda_bhairavi.mp3",
    "Bilahari": "/audio/bilahari.mp3",
    "Shankarabharanam": "/audio/shankarabharanam.mp3"
  };

  // ================= GOOGLE AUTH & DRIVE =================
  const login = useGoogleLogin({
    onSuccess: (codeResponse) => {
      setUser({ name: "Clinician", token: codeResponse.access_token });
      setCurrentView('dashboard');
    },
    scope: 'https://www.googleapis.com/auth/drive.file',
    onError: (error) => console.log('Login Failed:', error)
  });

  const handleGuestLogin = () => {
    setUser('guest');
    setCurrentView('dashboard');
  };

  const saveToDrive = async (content, filename) => {
    if (user === 'guest' || !user?.token) {
      alert("Guests cannot save to Google Drive. Please log in.");
      return;
    }

    const metadata = { name: filename, mimeType: 'text/csv' };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: 'text/csv' }));

    try {
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
        body: form
      });
      if (res.ok) alert("Successfully saved to Google Drive!");
      else alert("Failed to save to Drive.");
    } catch (err) {
      console.error(err);
      alert("Error connecting to Google Drive.");
    }
  };

  // ================= AUDIO PLAYER LOGIC =================
  const setupAudioListeners = (ref) => {
    const audio = ref.current;
    if (!audio) return;
    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  };

  useEffect(() => setupAudioListeners(audioRef), [suggestedRaaga]);
  useEffect(() => setupAudioListeners(emotionAudioRef), [emotionResult]);

  const togglePlay = (ref) => {
    if (!ref.current) return;
    if (isPlaying) ref.current.pause();
    else ref.current.play();
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e, ref) => {
    const time = Number(e.target.value);
    if (ref.current) ref.current.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return "0:00";
    const m = Math.floor(timeInSeconds / 60);
    const s = Math.floor(timeInSeconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // ================= EEG LOGIC =================
  const startAnalyzing = () => {
    setIsAnalyzing(true);
    setTimer(0);
    setRatios([]);
    setSuggestedRaaga("");
    setAverageRatio(null);
    setActivePort("SEARCHING...");

    ws.current = new WebSocket("ws://localhost:8000/ws/eeg");

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.port) setActivePort(data.port);
      if (data.ratio) setRatios((prev) => [...prev, data.ratio]);
    };

    timerRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev >= 299) {
          stopAnalyzing();
          return 300;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopAnalyzing = () => {
    setIsAnalyzing(false);
    clearInterval(timerRef.current);
    setActivePort("OFFLINE");
    if (ws.current) ws.current.close();

    setRatios((currentRatios) => {
      if (currentRatios.length > 0) {
        const sum = currentRatios.reduce((acc, val) => acc + val, 0);
        const avg = sum / currentRatios.length;
        setAverageRatio(avg);

        if (avg < 1.0) setSuggestedRaaga("Ananda Bhairavi");
        else if (avg >= 1.0 && avg <= 1.3) setSuggestedRaaga("Bilahari");
        else setSuggestedRaaga("Shankarabharanam");
      }
      return currentRatios;
    });
  };

  const exportEEG = () => {
    let csv = "Time (s),Alpha/Beta Ratio\n";
    ratios.forEach((r, i) => csv += `${i + 1},${r}\n`);
    csv += `\nFinal Average,${averageRatio}\nPrescribed Raga,${suggestedRaaga}\n`;
    saveToDrive(csv, `EEG_Session_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ================= VOICE LOGIC =================
  const startRecording = async () => {
    setEmotionResult(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    mediaRecorder.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    recorder.stop();
    setIsRecording(false);
    setIsPredicting(true);

    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/wav" });
      const formData = new FormData();
      formData.append("file", blob, "recording.wav");

      try {
        const res = await fetch("http://localhost:8001/predict-live", {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        setEmotionResult(data);
      } catch (err) {
        console.error(err);
        alert("Prediction Server Offline.");
      } finally {
        setIsPredicting(false);
      }
    };
  };

  const exportAudio = () => {
    const csv = `Emotion Detected,${emotionResult.final_emotion}\nPrescribed Raga,${emotionResult.raga}\nDate,${new Date().toISOString()}`;
    saveToDrive(csv, `Voice_Session_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const resetAll = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    if (emotionAudioRef.current) { emotionAudioRef.current.pause(); emotionAudioRef.current.currentTime = 0; }
    setIsPlaying(false); setCurrentTime(0); setRatios([]); setTimer(0); setSuggestedRaaga("");
    setAverageRatio(null); setEmotionResult(null);
  };

  // ================= RENDER HELPERS =================
  const liveRatio = ratios.length > 0 ? ratios[ratios.length - 1].toFixed(3) : "0.000";
  const progressPercentage = (timer / 300) * 100;

  const renderAudioPlayer = (audioSrc, ref) => (
    <div style={{ background: 'rgba(2, 6, 23, 0.8)', padding: '2rem', borderRadius: '24px', border: '1px solid rgba(56, 189, 248, 0.2)', marginBottom: '1.5rem', width: '100%' }}>
      <div style={{ width: '80px', height: '80px', margin: '0 auto 1.5rem auto', borderRadius: '50%', background: 'linear-gradient(135deg, #0f172a, #1e293b)', border: `2px solid ${isPlaying ? '#38bdf8' : '#334155'}`, boxShadow: isPlaying ? '0 0 30px rgba(56, 189, 248, 0.4)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: isPlaying ? 'spinRecord 8s linear infinite' : 'none', transition: 'all 0.5s ease' }}>
          <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#020617', border: '2px solid rgba(255,255,255,0.1)' }} />
      </div>
      
      <audio ref={ref} src={audioSrc} onCanPlay={(e) => e.target.volume = volume} />
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8', width: '35px', textAlign: 'right', fontFamily: 'monospace' }}>{formatTime(currentTime)}</span>
        <input type="range" min={0} max={duration || 0} value={currentTime} onChange={(e) => handleSeek(e, ref)} style={{ flex: 1 }} />
        <span style={{ fontSize: '0.75rem', color: '#94a3b8', width: '35px', textAlign: 'left', fontFamily: 'monospace' }}>{formatTime(duration)}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <button onClick={() => togglePlay(ref)} style={{ width: '56px', height: '56px', borderRadius: '50%', border: 'none', background: isPlaying ? '#1e293b' : 'linear-gradient(135deg, #38bdf8, #818cf8)', color: isPlaying ? '#38bdf8' : '#fff', fontSize: '1.2rem', cursor: 'pointer', zIndex: 2 }}>{isPlaying ? "⏸" : "▶"}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'absolute', right: 0, width: '90px' }}>
          <span style={{ fontSize: '0.8rem' }}>{volume === 0 ? '🔇' : '🔊'}</span>
          <input type="range" className="volume-slider" min={0} max={1} step={0.01} value={volume} onChange={(e) => { setVolume(Number(e.target.value)); if (ref.current) ref.current.volume = Number(e.target.value); }} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <style>
        {`
          html, body, #root { margin: 0; padding: 0; width: 100%; min-height: 100vh; background-color: #020617; overflow-x: hidden; }
          * { box-sizing: border-box; }
          
          @keyframes gradientBG { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
          @keyframes spinRecord { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes loadingBar { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          
          .animated-bg {
            background: linear-gradient(-45deg, #020617, #0f172a, #1e1b4b, #020617);
            background-size: 400% 400%;
            animation: gradientBG 15s ease infinite;
            min-height: 100vh;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            padding: 2rem; font-family: "Inter", system-ui, sans-serif; color: #f8fafc;
          }

          .glass-card {
            background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(20px); padding: 3rem;
            border-radius: 28px; border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
            width: 100%; max-width: 550px; animation: fadeIn 0.4s ease-out;
            display: flex; flex-direction: column; align-items: center;
          }

          .nav-bar { width: 100%; max-width: 1200px; display: flex; justify-content: space-between; align-items: center; padding: 1rem 2rem; background: rgba(15, 23, 42, 0.5); border-radius: 20px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 2rem; }
          
          .title { font-size: 2.2rem; font-weight: 800; margin: 0 0 0.5rem 0; background: linear-gradient(to right, #38bdf8, #c084fc, #f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          
          .btn { padding: 1rem; border-radius: 14px; border: none; font-weight: 800; cursor: pointer; transition: 0.2s; width: 100%; }
          .btn-primary { background: linear-gradient(135deg, #6366f1, #a855f7); color: white; }
          .btn-secondary { background: linear-gradient(135deg, #38bdf8, #818cf8); color: white; }
          .btn-danger { background: rgba(244, 63, 94, 0.1); border: 1px solid #f43f5e; color: #f43f5e; }
          .btn-outline { background: transparent; border: 1px solid #334155; color: #cbd5e1; }
          .btn:disabled { opacity: 0.5; cursor: not-allowed; }

          .loading-bar { width: 100%; height: 6px; background: #1e293b; border-radius: 4px; overflow: hidden; margin: 1.5rem 0; }
          .loading-fill { height: 100%; background: linear-gradient(90deg, #38bdf8, #c084fc, #38bdf8); background-size: 200% 100%; animation: loadingBar 2s linear infinite; }

          input[type=range] { -webkit-appearance: none; width: 100%; background: transparent; cursor: pointer; }
          input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); }
          input[type=range]::-webkit-slider-thumb { height: 16px; width: 16px; border-radius: 50%; background: #38bdf8; -webkit-appearance: none; margin-top: -5px; box-shadow: 0 0 10px rgba(56, 189, 248, 0.6); }
        `}
      </style>

      <div className="animated-bg">
        
        {/* Navigation Bar (Visible outside Login) */}
        {currentView !== 'login' && (
          <div className="nav-bar">
            <h2 style={{margin: 0, fontSize: '1.2rem', fontWeight: '800'}}>Raga<span style={{color: '#38bdf8'}}>Chikitsa</span></h2>
            <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
              <span style={{fontSize: '0.8rem', color: '#94a3b8'}}>
                {user === 'guest' ? '👤 Guest Mode (No Cloud Save)' : '🟢 Logged In'}
              </span>
              <button className="btn btn-outline" style={{padding: '0.5rem 1rem', width: 'auto'}} onClick={() => {resetAll(); setCurrentView('dashboard');}}>Home</button>
            </div>
          </div>
        )}

        {/* 1. LOGIN VIEW */}
        {currentView === 'login' && (
          <div className="glass-card">
            <h1 className="title" style={{fontSize: '3rem'}}>Raga Chikitsa</h1>
            <p style={{ color: '#64748b', letterSpacing: "0.15em", marginBottom: '3rem' }}>NEURAL & VOCAL THERAPY</p>
            
            <button className="btn btn-primary" style={{marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'}} onClick={() => login()}>
               Sign in with Google
            </button>
            <button className="btn btn-outline" onClick={handleGuestLogin}>
              Continue as Guest
            </button>
          </div>
        )}

        {/* 2. DASHBOARD VIEW */}
        {currentView === 'dashboard' && (
          <div style={{ display: "flex", gap: "2rem", width: "100%", maxWidth: "900px", justifyContent: "center", flexWrap: "wrap" }}>
            <div className="glass-card" style={{flex: 1, minWidth: '300px', cursor: 'pointer'}} onClick={() => setCurrentView('eeg')}>
              <h2 style={{color: '#fff', fontSize: '1.8rem', marginBottom: '1rem'}}>🧠 Brainwave Scan</h2>
              <p style={{color: '#94a3b8', textAlign: 'center', fontSize: '0.9rem'}}>Real-time EEG hardware analysis to prescribe therapies based on neural state.</p>
              <button className="btn btn-primary" style={{marginTop: 'auto'}}>ENTER</button>
            </div>
            
            <div className="glass-card" style={{flex: 1, minWidth: '300px', cursor: 'pointer'}} onClick={() => setCurrentView('audio')}>
              <h2 style={{color: '#fff', fontSize: '1.8rem', marginBottom: '1rem'}}>🎙️ Voice Analysis</h2>
              <p style={{color: '#94a3b8', textAlign: 'center', fontSize: '0.9rem'}}>Advanced ML emotion detection from vocal biomarkers to map appropriate Raagas.</p>
              <button className="btn btn-secondary" style={{marginTop: 'auto'}}>ENTER</button>
            </div>
          </div>
        )}

        {/* 3. EEG VIEW */}
        {currentView === 'eeg' && (
          <div className="glass-card" style={{width: '100%'}}>
            <h2 style={{color: '#fff', marginBottom: '2rem', letterSpacing: '0.1em'}}>EEG PIPELINE</h2>
            
            {!suggestedRaaga ? (
              <div style={{ width: '100%' }}>
                <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
                  <button onClick={startAnalyzing} disabled={isAnalyzing} className="btn btn-primary">INITIALIZE SCAN</button>
                  <button onClick={stopAnalyzing} disabled={!isAnalyzing} className="btn btn-danger">TERMINATE</button>
                </div>

                <div style={{ background: 'rgba(2, 6, 23, 0.5)', borderRadius: '20px', padding: '2rem', width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569' }}>{activePort}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: '700', color: isAnalyzing ? '#10b981' : '#475569' }}>{isAnalyzing ? "● STREAMING" : "○ OFFLINE"}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem', textAlign: 'center' }}>
                    <div>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.7rem', color: '#94a3b8' }}>LIVE α/β RATIO</p>
                      <p style={{ margin: 0, fontSize: '2.5rem', fontWeight: '300', color: '#38bdf8', fontFamily: 'monospace' }}>{liveRatio}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.7rem', color: '#94a3b8' }}>SAMPLES</p>
                      <p style={{ margin: 0, fontSize: '2.5rem', fontWeight: '300', color: '#f472b6', fontFamily: 'monospace' }}>{ratios.length}</p>
                    </div>
                  </div>
                  <div style={{ width: '100%', height: '4px', background: '#1e293b', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${progressPercentage}%`, height: '100%', background: '#38bdf8', transition: 'width 1s linear' }} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ width: '100%', textAlign: 'center' }}>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem' }}>AVG RATIO: {averageRatio?.toFixed(3)}</p>
                <h2 style={{ fontSize: '2.2rem', fontWeight: '800', color: '#fff', margin: '0 0 2rem 0' }}>{suggestedRaaga}</h2>
                
                {renderAudioPlayer(audioFiles[suggestedRaaga], audioRef)}

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button onClick={exportEEG} className="btn btn-outline" style={{color: '#38bdf8', borderColor: '#38bdf8'}}>SAVE TO DRIVE</button>
                  <button onClick={resetAll} className="btn btn-primary">NEW SCAN</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. AUDIO VIEW */}
        {currentView === 'audio' && (
          <div className="glass-card" style={{width: '100%'}}>
            <h2 style={{color: '#fff', marginBottom: '2rem', letterSpacing: '0.1em'}}>VOCAL BIOMARKERS</h2>
            
            <div style={{ width: '100%' }}>
              {!emotionResult && !isPredicting ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ background: 'rgba(2, 6, 23, 0.5)', padding: '3rem 2rem', borderRadius: '20px', marginBottom: '2rem' }}>
                    <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: isRecording ? 'rgba(244, 63, 94, 0.2)' : 'rgba(56, 189, 248, 0.1)', margin: '0 auto 1.5rem auto', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: isRecording ? 'pulse 1.5s infinite' : 'none' }}>
                       <span style={{fontSize: '2rem'}}>{isRecording ? '🎙️' : '🎤'}</span>
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>{isRecording ? "Recording in progress..." : "Press record and speak naturally."}</p>
                  </div>

                  <div style={{ display: "flex", gap: "1rem" }}>
                    {!isRecording ? (
                      <button onClick={startRecording} className="btn btn-secondary">START RECORDING</button>
                    ) : (
                      <button onClick={stopRecording} className="btn btn-danger">STOP & ANALYZE</button>
                    )}
                  </div>
                </div>
              ) : isPredicting ? (
                <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                  <h3 style={{ color: '#38bdf8', marginBottom: '1rem' }}>Analyzing Vocal Biomarkers...</h3>
                  <div className="loading-bar"><div className="loading-fill"></div></div>
                  <p style={{ color: '#64748b', fontSize: '0.8rem' }}>Extracting MFCCs and running deep neural classification</p>
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', letterSpacing: '0.1em', marginBottom: '0.5rem', fontWeight: '700' }}>DETECTED EMOTION</p>
                  <h3 style={{ color: "#38bdf8", fontSize: '2.5rem', margin: '0 0 1rem 0', textTransform: 'uppercase', textShadow: '0 0 20px rgba(56, 189, 248, 0.4)' }}>{emotionResult.final_emotion}</h3>
                  <p style={{ fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '2rem' }}>Prescribed Therapy: <strong style={{color: '#f472b6', fontSize: '1.1rem'}}>{emotionResult.raga}</strong></p>

                  {renderAudioPlayer(emotionResult.raga_url, emotionAudioRef)}

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={exportAudio} className="btn btn-outline" style={{color: '#38bdf8', borderColor: '#38bdf8'}}>SAVE TO DRIVE</button>
                    <button onClick={resetAll} className="btn btn-secondary">NEW RECORDING</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </>
  );
}

export default App;