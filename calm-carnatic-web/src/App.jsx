import { useState, useRef } from 'react';

function App() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [timer, setTimer] = useState(0);
  const [ratios, setRatios] = useState([]);
  const [suggestedRaaga, setSuggestedRaaga] = useState("");
  // NEW: State to track which COM port the backend actually connected to
  const [activePort, setActivePort] = useState("OFFLINE"); 
  
  const ws = useRef(null);
  const timerRef = useRef(null);

  const startAnalyzing = () => {
    setIsAnalyzing(true);
    setTimer(0);
    setRatios([]);
    setSuggestedRaaga("");
    setActivePort("SEARCHING..."); // Update UI while Python looks for the headset

    ws.current = new WebSocket("ws://localhost:8000/ws/eeg");
    
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Catch the dynamic port name sent from the Python backend
      if (data.port) {
        setActivePort(data.port);
      }
      
      if (data.ratio) {
        setRatios((prev) => [...prev, data.ratio]);
      }
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
    setActivePort("OFFLINE"); // Reset the port status when stopped
    
    if (ws.current) {
      ws.current.close();
    }

    setRatios((currentRatios) => {
      if (currentRatios.length > 0) {
        const sum = currentRatios.reduce((acc, val) => acc + val, 0);
        const avgRatio = sum / currentRatios.length;
        
        let raaga = "";
        if (avgRatio < 1.0) {
          raaga = "Ananda Bhairavi";
        } else if (avgRatio >= 1.0 && avgRatio <= 1.3) {
          raaga = "Bilahari";
        } else {
          raaga = "Shankarabharanam";
        }
        setSuggestedRaaga(raaga);
      }
      return currentRatios; 
    });
  };

  const liveRatio = ratios.length > 0 ? ratios[ratios.length - 1].toFixed(3) : "0.000";
  const progressPercentage = (timer / 300) * 100;

  return (
    <>
      {/* Injecting CSS Animations and Global Reset directly into the component */}
      <style>
        {`
          /* --- GLOBAL RESET --- */
          html, body, #root {
            margin: 0;
            padding: 0;
            width: 100%;
            min-height: 100vh;
            background-color: #020617; /* Fallback dark color */
          }
          * {
            box-sizing: border-box; 
          }
          
          /* --- ANIMATIONS --- */
          @keyframes gradientBG {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          @keyframes pulseGlow {
            0% { box-shadow: 0 0 10px rgba(16, 185, 129, 0.4); }
            50% { box-shadow: 0 0 25px rgba(16, 185, 129, 0.8); }
            100% { box-shadow: 0 0 10px rgba(16, 185, 129, 0.4); }
          }
          
          .animated-bg {
            background: linear-gradient(-45deg, #020617, #1e1b4b, #312e81, #0f172a);
            background-size: 400% 400%;
            animation: gradientBG 15s ease infinite;
            min-height: 100vh;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            font-family: "Inter", system-ui, sans-serif;
            color: #f8fafc;
          }
        `}
      </style>

      <div className="animated-bg">
        
        {/* Premium Dark Glass Card */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          padding: '3rem',
          borderRadius: '24px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          width: '100%',
          maxWidth: '550px',
        }}>
          
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <h1 style={{ 
              margin: '0 0 0.5rem 0', 
              fontSize: '2.5rem', 
              fontWeight: '800', 
              background: 'linear-gradient(to right, #c084fc, #f472b6, #fb923c)', 
              WebkitBackgroundClip: 'text', 
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.02em'
            }}>
              Raga Chikitsa
            </h1>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '1rem', fontWeight: '500', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Neural State Analysis Pipeline
            </p>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2.5rem' }}>
            <button 
              onClick={startAnalyzing} 
              disabled={isAnalyzing}
              style={{
                flex: 1,
                padding: '1rem',
                border: 'none',
                borderRadius: '12px',
                fontSize: '1rem',
                fontWeight: '700',
                color: 'white',
                background: isAnalyzing ? '#334155' : 'linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)',
                cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                boxShadow: isAnalyzing ? 'none' : '0 10px 25px -5px rgba(217, 70, 239, 0.4)',
                transition: 'all 0.3s ease',
                opacity: isAnalyzing ? 0.5 : 1
              }}
            >
              INITIALIZE SCAN
            </button>
            
            <button 
              onClick={stopAnalyzing} 
              disabled={!isAnalyzing}
              style={{
                flex: 1,
                padding: '1rem',
                border: '1px solid',
                borderColor: !isAnalyzing ? '#334155' : '#f43f5e',
                borderRadius: '12px',
                fontSize: '1rem',
                fontWeight: '700',
                color: !isAnalyzing ? '#64748b' : '#f43f5e',
                background: !isAnalyzing ? 'transparent' : 'rgba(244, 63, 94, 0.1)',
                cursor: !isAnalyzing ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease'
              }}
            >
              TERMINATE
            </button>
          </div>

          {/* Live Data Dashboard */}
          <div style={{
            background: 'rgba(2, 6, 23, 0.7)',
            borderRadius: '16px',
            padding: '2rem',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.5)'
          }}>
            
            {/* Live Indicator */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {activePort} STATUS
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: isAnalyzing ? '#10b981' : '#475569',
                  animation: isAnalyzing ? 'pulseGlow 2s infinite' : 'none'
                }} />
                <span style={{ fontSize: '0.85rem', fontWeight: '700', color: isAnalyzing ? '#10b981' : '#64748b', letterSpacing: '0.05em' }}>
                  {isAnalyzing ? "STREAMING" : "OFFLINE"}
                </span>
              </div>
            </div>

            {/* Glowing Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: '500' }}>LIVE α/β RATIO</p>
                <p style={{ margin: 0, fontSize: '2.5rem', fontWeight: '300', color: isAnalyzing ? '#38bdf8' : '#64748b', textShadow: isAnalyzing ? '0 0 20px rgba(56, 189, 248, 0.4)' : 'none', fontFamily: 'monospace' }}>
                  {liveRatio}
                </p>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: '500' }}>DATA POINTS</p>
                <p style={{ margin: 0, fontSize: '2.5rem', fontWeight: '300', color: isAnalyzing ? '#f472b6' : '#64748b', textShadow: isAnalyzing ? '0 0 20px rgba(244, 114, 182, 0.4)' : 'none', fontFamily: 'monospace' }}>
                  {ratios.length}
                </p>
              </div>
            </div>

            {/* Cyberpunk Progress Bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', letterSpacing: '0.05em' }}>SESSION DURATION</span>
                <span style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: '600', fontFamily: 'monospace' }}>{timer}s / 300s</span>
              </div>
              <div style={{ width: '100%', height: '6px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  width: `${progressPercentage}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #38bdf8, #818cf8, #c084fc)',
                  boxShadow: '0 0 10px rgba(139, 92, 246, 0.8)',
                  transition: 'width 1s linear'
                }} />
              </div>
            </div>
          </div>

          {/* Model Output / Recommendation */}
          {suggestedRaaga && !isAnalyzing && (
            <div style={{
              marginTop: '2rem',
              padding: '2rem',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '16px',
              textAlign: 'center',
              boxShadow: '0 0 30px rgba(16, 185, 129, 0.1)'
            }}>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#34d399', fontWeight: '600', letterSpacing: '0.1em' }}>
                MODEL PREDICTION
              </p>
              <h2 style={{ margin: 0, fontSize: '2rem', fontWeight: '800', color: '#fff', textShadow: '0 0 15px rgba(52, 211, 153, 0.5)' }}>
                {suggestedRaaga}
              </h2>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

export default App;