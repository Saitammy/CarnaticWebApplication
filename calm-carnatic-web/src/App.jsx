import { useEffect, useRef, useState } from 'react';

function App() {
  // ================= STATE: EEG PIPELINE =================
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [timer, setTimer] = useState(0);
  const [ratios, setRatios] = useState([]);
  const [suggestedRaaga, setSuggestedRaaga] = useState("");
  const [averageRatio, setAverageRatio] = useState(null);
  const [activePort, setActivePort] = useState("OFFLINE");

  // ================= STATE: CUSTOM AUDIO PLAYER (EEG) =================
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);

  // ================= STATE: VOICE PIPELINE =================
  const [audioFile, setAudioFile] = useState(null);
  const [emotionResult, setEmotionResult] = useState(null);
  const [isRecording, setIsRecording] = useState(false);

  // ================= REFS =================
  const ws = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);         // For EEG Therapy Audio
  const emotionAudioRef = useRef(null);  // For Voice Therapy Audio
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const audioFiles = {
    "Ananda Bhairavi": "/audio/ananda_bhairavi.mp3",
    "Bilahari": "/audio/bilahari.mp3",
    "Shankarabharanam": "/audio/shankarabharanam.mp3"
  };

  // ================= AUDIO PLAYER LOGIC =================
  useEffect(() => {
    const audio = audioRef.current;
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
  }, [suggestedRaaga]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e) => {
    const time = Number(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (e) => {
    const newVolume = Number(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) audioRef.current.volume = newVolume;
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

  const resetSession = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setRatios([]);
    setTimer(0);
    setSuggestedRaaga("");
    setAverageRatio(null);
  };

  const downloadCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,Time (Seconds),Alpha/Beta Ratio\n";
    ratios.forEach((ratio, index) => { csvContent += `${index + 1},${ratio}\n`; });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `EEG_Session_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ================= VOICE LOGIC =================
  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };

    mediaRecorder.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    recorder.stop();
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
        if (emotionAudioRef.current) {
          emotionAudioRef.current.src = data.raga_url;
          emotionAudioRef.current.play().catch(() => { });
        }
      } catch (err) {
        console.error(err);
      }
    };
    setIsRecording(false);
  };

  const handleAudioUpload = async () => {
    if (!audioFile) return;
    const formData = new FormData();
    formData.append("file", audioFile);

    try {
      const res = await fetch("http://localhost:8001/predict", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      setEmotionResult(data);
      if (emotionAudioRef.current) {
        emotionAudioRef.current.src = data.raga_url;
        emotionAudioRef.current.play().catch(() => { });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const liveRatio = ratios.length > 0 ? ratios[ratios.length - 1].toFixed(3) : "0.000";
  const progressPercentage = (timer / 300) * 100;

  return (
    <>
      <style>
        {`
          html, body, #root { margin: 0; padding: 0; width: 100%; min-height: 100vh; background-color: #020617; overflow-x: hidden; }
          * { box-sizing: border-box; }
          
          @keyframes gradientBG { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
          @keyframes spinRecord { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          
          .animated-bg {
            background: linear-gradient(-45deg, #020617, #0f172a, #1e1b4b, #020617);
            background-size: 400% 400%;
            animation: gradientBG 15s ease infinite;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 3rem 1rem;
            font-family: "Inter", system-ui, sans-serif;
            color: #f8fafc;
          }

          .glass-card {
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(20px);
            padding: 2.5rem;
            border-radius: 28px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
            width: 100%;
            max-width: 520px;
            transition: transform 0.2s ease;
          }
          
          .title {
            font-size: 2rem; font-weight: 800; margin: 0 0 0.5rem 0;
            background: linear-gradient(to right, #38bdf8, #c084fc, #f472b6);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          }

          .btn-primary { flex: 1; padding: 1rem; border-radius: 14px; border: none; background: linear-gradient(135deg, #6366f1, #a855f7); color: white; font-weight: 800; cursor: pointer; transition: 0.2s; }
          .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; background: #1e293b; }
          
          .btn-secondary { flex: 1; padding: 1rem; border-radius: 14px; border: none; background: linear-gradient(135deg, #38bdf8, #818cf8); color: white; font-weight: 800; cursor: pointer; transition: 0.2s; }
          .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

          .btn-danger { flex: 1; padding: 1rem; border-radius: 14px; border: 1px solid #f43f5e; background: transparent; color: #f43f5e; font-weight: 800; cursor: pointer; transition: 0.2s; }
          .btn-danger:disabled { opacity: 0.3; cursor: not-allowed; }

          /* Custom Range Sliders */
          input[type=range] { -webkit-appearance: none; width: 100%; background: transparent; cursor: pointer; }
          input[type=range]:focus { outline: none; }
          input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); }
          input[type=range]::-webkit-slider-thumb { height: 16px; width: 16px; border-radius: 50%; background: #38bdf8; -webkit-appearance: none; margin-top: -5px; box-shadow: 0 0 10px rgba(56, 189, 248, 0.6); }
          .volume-slider::-webkit-slider-runnable-track { height: 4px; }
          .volume-slider::-webkit-slider-thumb { height: 12px; width: 12px; margin-top: -4px; }
        `}
      </style>

      <div className="animated-bg">
        <div style={{ display: "flex", gap: "3rem", width: "100%", maxWidth: "1200px", alignItems: "stretch", justifyContent: "center", flexWrap: "wrap" }}>

          {/* ================= LEFT CARD (EEG PIPELINE) ================= */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
              <h1 className="title">Raga Chikitsa</h1>
              <p style={{ color: '#64748b', letterSpacing: "0.15em", fontSize: '0.85rem', fontWeight: '600' }}>NEURAL STATE PIPELINE</p>
            </div>

            {!suggestedRaaga ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: "flex", gap: "1rem", marginBottom: "2.5rem" }}>
                  <button onClick={startAnalyzing} disabled={isAnalyzing} className="btn-primary">INITIALIZE SCAN</button>
                  <button onClick={stopAnalyzing} disabled={!isAnalyzing} className="btn-danger">TERMINATE</button>
                </div>

                <div style={{ background: 'rgba(2, 6, 23, 0.5)', borderRadius: '20px', padding: '2rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569' }}>{activePort}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: '700', color: isAnalyzing ? '#10b981' : '#475569' }}>{isAnalyzing ? "● STREAMING" : "○ OFFLINE"}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                    <div>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.7rem', color: '#94a3b8' }}>LIVE α/β RATIO</p>
                      <p style={{ margin: 0, fontSize: '2.2rem', fontWeight: '300', color: '#38bdf8', fontFamily: 'monospace' }}>{liveRatio}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.7rem', color: '#94a3b8' }}>SAMPLES</p>
                      <p style={{ margin: 0, fontSize: '2.2rem', fontWeight: '300', color: '#f472b6', fontFamily: 'monospace' }}>{ratios.length}</p>
                    </div>
                  </div>
                  <div style={{ width: '100%', height: '4px', background: '#1e293b', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${progressPercentage}%`, height: '100%', background: '#38bdf8', transition: 'width 1s linear' }} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ marginBottom: '2rem' }}>
                   <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem' }}>AVG RATIO: {averageRatio?.toFixed(3)}</p>
                   <h2 style={{ fontSize: '2.2rem', fontWeight: '800', color: '#fff', margin: 0 }}>{suggestedRaaga}</h2>
                </div>

                <div style={{ background: 'rgba(2, 6, 23, 0.8)', padding: '2rem', borderRadius: '24px', border: '1px solid rgba(56, 189, 248, 0.2)', marginBottom: '1.5rem' }}>
                  <div style={{ width: '100px', height: '100px', margin: '0 auto 1.5rem auto', borderRadius: '50%', background: 'linear-gradient(135deg, #0f172a, #1e293b)', border: `2px solid ${isPlaying ? '#38bdf8' : '#334155'}`, boxShadow: isPlaying ? '0 0 40px rgba(56, 189, 248, 0.4)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: isPlaying ? 'spinRecord 8s linear infinite' : 'none', transition: 'all 0.5s ease' }}>
                     <div style={{ width: '25px', height: '25px', borderRadius: '50%', background: '#020617', border: '2px solid rgba(255,255,255,0.1)' }} />
                  </div>
                  
                  <audio ref={audioRef} src={audioFiles[suggestedRaaga]} onCanPlay={(e) => e.target.volume = volume} />
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', width: '35px', textAlign: 'right', fontFamily: 'monospace' }}>{formatTime(currentTime)}</span>
                    <input type="range" min={0} max={duration || 0} value={currentTime} onChange={handleSeek} style={{ flex: 1 }} />
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', width: '35px', textAlign: 'left', fontFamily: 'monospace' }}>{formatTime(duration)}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <button onClick={togglePlay} style={{ width: '56px', height: '56px', borderRadius: '50%', border: 'none', background: isPlaying ? '#1e293b' : 'linear-gradient(135deg, #38bdf8, #818cf8)', color: isPlaying ? '#38bdf8' : '#fff', fontSize: '1.2rem', cursor: 'pointer', zIndex: 2 }}>{isPlaying ? "⏸" : "▶"}</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'absolute', right: 0, width: '90px' }}>
                      <span style={{ fontSize: '0.8rem' }}>{volume === 0 ? '🔇' : '🔊'}</span>
                      <input type="range" className="volume-slider" min={0} max={1} step={0.01} value={volume} onChange={handleVolumeChange} />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button onClick={downloadCSV} className="btn-secondary" style={{ background: 'transparent', border: '1px solid #334155', color: '#cbd5e1' }}>SAVE CSV</button>
                  <button onClick={resetSession} className="btn-primary" style={{ background: '#1e293b', color: '#fff' }}>NEW SESSION</button>
                </div>
              </div>
            )}
          </div>

          {/* ================= RIGHT CARD (VOICE PIPELINE) ================= */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
              <h1 className="title">Voice Analysis</h1>
              <p style={{ color: '#64748b', letterSpacing: "0.15em", fontSize: '0.85rem', fontWeight: '600' }}>EMOTION DETECTOR</p>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              
              <div style={{ background: 'rgba(2, 6, 23, 0.5)', padding: '1.5rem', borderRadius: '16px', border: '1px dashed rgba(255,255,255,0.2)', marginBottom: '1.5rem', textAlign: 'center' }}>
                <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files[0])} style={{ color: '#94a3b8', fontSize: '0.85rem', width: '100%' }} />
                {audioFile && <p style={{ fontSize: "0.8rem", color: "#38bdf8", marginTop: '0.5rem', marginBottom: 0 }}>Selected: {audioFile.name}</p>}
              </div>

              <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
                {!isRecording ? (
                  <button onClick={startRecording} className="btn-secondary">🎤 START RECORDING</button>
                ) : (
                  <button onClick={stopRecording} className="btn-danger" style={{ background: 'rgba(244, 63, 94, 0.1)' }}>⏹ STOP RECORDING</button>
                )}
              </div>

              <div style={{ display: "flex", gap: "1rem" }}>
                <button onClick={handleAudioUpload} disabled={isRecording || !audioFile} className="btn-primary">ANALYZE UPLOAD</button>
                <button onClick={() => { setAudioFile(null); setEmotionResult(null); if (emotionAudioRef.current) { emotionAudioRef.current.pause(); emotionAudioRef.current.src = ""; } }} className="btn-danger">RESET</button>
              </div>

              {emotionResult && (
                <div style={{ marginTop: "2rem", padding: '1.5rem', background: 'rgba(56, 189, 248, 0.05)', borderRadius: '16px', border: '1px solid rgba(56, 189, 248, 0.2)', textAlign: "center", animation: 'fadeIn 0.5s ease-out' }}>
                  
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', letterSpacing: '0.1em', marginBottom: '0.5rem', fontWeight: '700' }}>DETECTED EMOTION</p>
                  <h3 style={{ color: "#38bdf8", fontSize: '2rem', margin: '0 0 1rem 0', textTransform: 'uppercase', textShadow: '0 0 15px rgba(56, 189, 248, 0.4)' }}>{emotionResult.final_emotion}</h3>
                  
                  <p style={{ fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '1rem' }}>Prescribed Therapy: <strong style={{color: '#f472b6'}}>{emotionResult.raga}</strong></p>

                  <audio ref={emotionAudioRef} controls style={{ width: "100%", height: '40px', outline: 'none', borderRadius: '20px' }} />
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

export default App;