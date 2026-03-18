import { useState, useRef, useEffect } from 'react';

function App() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [timer, setTimer] = useState(0);
  const [ratios, setRatios] = useState([]);
  const [suggestedRaaga, setSuggestedRaaga] = useState("");
  const [averageRatio, setAverageRatio] = useState(null);
  const [activePort, setActivePort] = useState("OFFLINE"); 
  
  // Advanced Audio State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7); // Default volume at 70%
  
  const ws = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);

  const audioFiles = {
    "Ananda Bhairavi": "/audio/ananda_bhairavi.mp3",
    "Bilahari": "/audio/bilahari.mp3",
    "Shankarabharanam": "/audio/shankarabharanam.mp3"
  };

  // Setup Audio Event Listeners
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
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e) => {
    const time = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  };

  // NEW: Handle Volume Change
  const handleVolumeChange = (e) => {
    const newVolume = Number(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return "0:00";
    const m = Math.floor(timeInSeconds / 60);
    const s = Math.floor(timeInSeconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

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
    link.setAttribute("download", `Session_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
            padding: 2rem;
            font-family: "Inter", system-ui, sans-serif;
            color: #f8fafc;
          }
          
          .glass-card {
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(20px);
            padding: 3rem;
            border-radius: 28px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
            width: 100%;
            max-width: 550px;
          }

          /* Custom Range Slider */
          input[type=range] {
            -webkit-appearance: none;
            width: 100%;
            background: transparent;
            cursor: pointer;
          }
          input[type=range]:focus { outline: none; }
          input[type=range]::-webkit-slider-runnable-track {
            width: 100%; height: 6px; border-radius: 4px;
            background: rgba(255, 255, 255, 0.1);
          }
          input[type=range]::-webkit-slider-thumb {
            height: 16px; width: 16px; border-radius: 50%;
            background: #38bdf8;
            -webkit-appearance: none;
            margin-top: -5px;
            box-shadow: 0 0 10px rgba(56, 189, 248, 0.6);
            transition: transform 0.1s;
          }
          input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.2); }
          
          /* Volume Slider Specific Adjustments */
          .volume-slider::-webkit-slider-runnable-track { height: 4px; }
          .volume-slider::-webkit-slider-thumb { height: 12px; width: 12px; margin-top: -4px; }
        `}
      </style>

      <div className="animated-bg">
        <div className="glass-card">
          
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2.5rem', fontWeight: '800', background: 'linear-gradient(to right, #38bdf8, #c084fc, #f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Raga Chikitsa
            </h1>
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem', fontWeight: '600', letterSpacing: '0.2em' }}>NEURAL THERAPY ENGINE</p>
          </div>

          {!suggestedRaaga ? (
            <>
              {/* --- SCANNER VIEW --- */}
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '2.5rem' }}>
                <button onClick={startAnalyzing} disabled={isAnalyzing} style={{ flex: 1, padding: '1rem', border: 'none', borderRadius: '14px', fontSize: '0.9rem', fontWeight: '800', color: 'white', background: isAnalyzing ? '#1e293b' : 'linear-gradient(135deg, #6366f1, #a855f7)', cursor: isAnalyzing ? 'not-allowed' : 'pointer', opacity: isAnalyzing ? 0.6 : 1, transition: 'all 0.3s' }}>INITIALIZE SCAN</button>
                <button onClick={stopAnalyzing} disabled={!isAnalyzing} style={{ flex: 1, padding: '1rem', border: '1px solid #f43f5e', borderRadius: '14px', fontSize: '0.9rem', fontWeight: '800', color: '#f43f5e', background: 'transparent', cursor: !isAnalyzing ? 'not-allowed' : 'pointer', opacity: !isAnalyzing ? 0.3 : 1, transition: 'all 0.3s' }}>TERMINATE</button>
              </div>

              <div style={{ background: 'rgba(2, 6, 23, 0.5)', borderRadius: '20px', padding: '2rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569' }}>{activePort}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: '700', color: isAnalyzing ? '#10b981' : '#475569' }}>{isAnalyzing ? "● STREAMING" : "○ OFFLINE"}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                  <div>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.7rem', color: '#94a3b8' }}>LIVE RATIO</p>
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
            </>
          ) : (
            <>
              {/* --- MUSIC PLAYER RESULTS VIEW --- */}
              <div style={{ background: 'rgba(2, 6, 23, 0.6)', borderRadius: '24px', padding: '2.5rem 2rem', border: '1px solid rgba(56, 189, 248, 0.15)', textAlign: 'center' }}>
                
                {/* Visualizer Orb */}
                <div style={{ 
                  width: '120px', height: '120px', margin: '0 auto 2rem auto', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                  border: `2px solid ${isPlaying ? '#38bdf8' : '#334155'}`,
                  boxShadow: isPlaying ? '0 0 40px rgba(56, 189, 248, 0.4)' : '0 10px 30px rgba(0,0,0,0.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: isPlaying ? 'spinRecord 8s linear infinite' : 'none',
                  transition: 'all 0.5s ease'
                }}>
                   <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#020617', border: '2px solid rgba(255,255,255,0.1)' }} />
                </div>

                <p style={{ fontSize: '0.75rem', color: '#38bdf8', letterSpacing: '0.15em', marginBottom: '0.5rem', fontWeight: '600' }}>PRESCRIBED THERAPY</p>
                <h2 style={{ fontSize: '2.2rem', fontWeight: '800', color: '#fff', margin: '0 0 0.5rem 0' }}>{suggestedRaaga}</h2>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '2rem' }}>Avg. α/β Ratio: {averageRatio?.toFixed(3)}</p>

                {/* Hidden Audio Element - Added onCanPlay to set initial volume */}
                <audio ref={audioRef} src={audioFiles[suggestedRaaga]} onCanPlay={(e) => e.target.volume = volume} />

                {/* Timeline Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', width: '40px', textAlign: 'right', fontFamily: 'monospace' }}>{formatTime(currentTime)}</span>
                  <input 
                    type="range" 
                    min={0} 
                    max={duration || 0} 
                    value={currentTime} 
                    onChange={handleSeek}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', width: '40px', textAlign: 'left', fontFamily: 'monospace' }}>{formatTime(duration)}</span>
                </div>

                {/* Playback Controls & Volume */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', position: 'relative' }}>
                  
                  {/* Big Play Button */}
                  <button 
                    onClick={togglePlay}
                    style={{
                      width: '64px', height: '64px', borderRadius: '50%', border: 'none',
                      background: isPlaying ? '#1e293b' : 'linear-gradient(135deg, #38bdf8, #818cf8)',
                      color: isPlaying ? '#38bdf8' : '#fff',
                      fontSize: '1.5rem', cursor: 'pointer',
                      boxShadow: isPlaying ? 'none' : '0 10px 20px rgba(56, 189, 248, 0.3)',
                      transition: 'all 0.2s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      zIndex: 2
                    }}
                  >
                    {isPlaying ? "⏸" : "▶"}
                  </button>

                  {/* Volume Control */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'absolute', right: 0, width: '100px' }}>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{volume === 0 ? '🔇' : '🔊'}</span>
                    <input 
                      type="range" 
                      className="volume-slider"
                      min={0} 
                      max={1} 
                      step={0.01} 
                      value={volume} 
                      onChange={handleVolumeChange}
                    />
                  </div>
                </div>

              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button onClick={downloadCSV} style={{ flex: 1, padding: '1rem', border: '1px solid #334155', borderRadius: '14px', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }}>SAVE DATA CSV</button>
                <button onClick={resetSession} style={{ flex: 1, padding: '1rem', border: 'none', borderRadius: '14px', background: '#1e293b', color: '#fff', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }}>NEW SESSION</button>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}

export default App;