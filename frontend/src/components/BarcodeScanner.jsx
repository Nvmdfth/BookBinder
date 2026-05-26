import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Volume2, VolumeX, AlertCircle } from 'lucide-react';

export default function BarcodeScanner({ onScanSuccess, onScanError }) {
  const [isActive, setIsActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isVibratingSupport, setIsVibratingSupport] = useState(true);
  const [isPulse, setIsPulse] = useState(false);
  
  const qrCodeRef = useRef(null);
  const scannerContainerId = 'bookbinder-scanner-view';

  useEffect(() => {
    // Check vibration support
    setIsVibratingSupport(!!navigator.vibrate);
  }, []);

  // Web Audio API synthesizes a success beep directly (no static audio files required)
  const synthesizeSuccessBeep = () => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Sweet high A note (880Hz)
      
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15); // Fast decay

      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.15);
    } catch (err) {
      console.warn('Audio Context synthesize failed:', err);
    }
  };

  // Perform success signals (Vibration + Synthesized Sound + CSS Visual Pulse overlay)
  const triggerSuccessSignals = () => {
    synthesizeSuccessBeep();
    
    // Trigger vibration
    if (isVibratingSupport) {
      try {
        navigator.vibrate(100);
      } catch (err) {
        console.warn('Vibration API blocked or failed:', err);
      }
    }
    
    // Trigger visual pulse overlay fallback
    setIsPulse(true);
    setTimeout(() => setIsPulse(false), 800);
  };

  const startScanner = async () => {
    setErrorMessage(null);
    
    // Pre-unlock Web Audio API by initializing a dummy oscillator on first user click (Safari requirements)
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const dummyCtx = new AudioCtx();
        if (dummyCtx.state === 'suspended') {
          await dummyCtx.resume();
        }
      }
    } catch (e) {
      console.warn('Audio pre-unlock failed:', e);
    }

    try {
      const html5Qrcode = new Html5Qrcode(scannerContainerId);
      qrCodeRef.current = html5Qrcode;

      const config = {
        fps: 15,
        qrbox: (width, height) => {
          // Responsive target frame
          const size = Math.min(width, height) * 0.7;
          return { width: size, height: size * 0.5 }; // Horizontal barcode size ratio
        },
        aspectRatio: 1.0,
      };

      setIsActive(true);

      try {
        await html5Qrcode.start(
          { facingMode: 'environment' }, // Target rear camera (Req 4.1.3)
          config,
          (decodedText) => {
            // ISBN found!
            triggerSuccessSignals();
            onScanSuccess(decodedText);
          },
          (error) => {
            if (onScanError) onScanError(error);
          }
        );
      } catch (envErr) {
        console.warn('Rear camera environment constraint failed, trying default camera:', envErr);
        // Fallback to default webcam constraints (works on desktops/laptops with single webcams)
        await html5Qrcode.start(
          {}, // Empty constraints allows browser to fallback to default webcam
          config,
          (decodedText) => {
            triggerSuccessSignals();
            onScanSuccess(decodedText);
          },
          (error) => {
            if (onScanError) onScanError(error);
          }
        );
      }

    } catch (err) {
      console.error('Camera starting failed:', err);
      setIsActive(false);
      setErrorMessage(
        'Unable to access the camera stream. Please ensure camera permissions are active and HTTPS secure context requirements are satisfied.'
      );
    }
  };

  const stopScanner = async () => {
    if (qrCodeRef.current && qrCodeRef.current.isScanning) {
      try {
        await qrCodeRef.current.stop();
        qrCodeRef.current = null;
      } catch (err) {
        console.error('Error stopping camera:', err);
      }
    }
    setIsActive(false);
  };

  // Auto clean up camera stream on unmount
  useEffect(() => {
    return () => {
      if (qrCodeRef.current && qrCodeRef.current.isScanning) {
        qrCodeRef.current.stop().catch(console.error);
      }
    };
  }, []);

  return (
    <div style={styles.scannerWrapper}>
      <div 
        style={{ 
          ...styles.startPanel, 
          display: !isActive ? 'flex' : 'none' 
        }} 
        className="glass-panel"
      >
        <Camera size={44} style={styles.icon} />
        <h3 style={styles.title}>Camera Ingestion</h3>
        <p style={styles.desc}>
          Position the book's linear barcode (ISBN-10 or ISBN-13) inside the target frame using your rear environment camera.
        </p>
        <button className="btn btn-primary" onClick={startScanner}>
          Start Ingestion Scanner
        </button>
        
        {errorMessage && (
          <div style={styles.errorBanner}>
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      <div 
        style={{ 
          ...styles.activePanel, 
          display: isActive ? 'flex' : 'none' 
        }}
      >
        {/* Controls Bar */}
        <div style={styles.controlsRow}>
          <button
            style={styles.toggleBtn}
            onClick={() => setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? 'Mute Sounds' : 'Unmute Sounds'}
          >
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            <span>{soundEnabled ? 'Sound On' : 'Muted'}</span>
          </button>
          
          <button className="btn btn-danger" onClick={stopScanner} style={styles.closeBtn}>
            Close Scanner
          </button>
        </div>

        {/* Viewfinder frame */}
        <div style={styles.cameraViewport} className="glass-panel">
          <div id={scannerContainerId} style={styles.cameraPreview}></div>
          
          {/* Custom high-contrast scanning guide lines overlay */}
          <div style={styles.overlayFrame} className={isPulse ? 'scan-pulse' : ''}>
            <div style={styles.scanningLine}></div>
            <div style={styles.guideText}>Align Barcode Here</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  scannerWrapper: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  startPanel: {
    width: '100%',
    maxWidth: '500px',
    padding: '30px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '16px',
  },
  icon: {
    color: 'var(--accent-color)',
    marginBottom: '8px',
  },
  title: {
    fontSize: '1.25rem',
  },
  desc: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger-color)',
    fontSize: '0.85rem',
    textAlign: 'left',
    marginTop: '8px',
    width: '100%',
  },
  activePanel: {
    width: '100%',
    maxWidth: '500px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  controlsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-glass)',
    fontSize: '0.9rem',
  },
  closeBtn: {
    padding: '8px 16px',
    fontSize: '0.9rem',
  },
  cameraViewport: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1', // Square frame mapping
    overflow: 'hidden',
    backgroundColor: '#000000',
    border: '2px solid var(--border-glass)',
  },
  cameraPreview: {
    width: '100%',
    height: '100%',
  },
  overlayFrame: {
    position: 'absolute',
    top: '25%',
    left: '15%',
    right: '15%',
    height: '35%',
    border: '2.5px solid rgba(255, 255, 255, 0.8)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 0 0 2000px rgba(0, 0, 0, 0.65)', // High-contrast translucent mask surrounding the frame
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    transition: 'var(--transition-smooth)',
  },
  scanningLine: {
    position: 'absolute',
    left: '4%',
    right: '4%',
    height: '2px',
    backgroundColor: 'var(--danger-color)',
    boxShadow: '0 0 8px var(--danger-color)',
    animation: 'shimmer 1.5s infinite linear', // Barcode sweeping motion
  },
  guideText: {
    position: 'absolute',
    bottom: '-32px',
    color: '#ffffff',
    fontSize: '0.8rem',
    fontWeight: '600',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    textShadow: '0 2px 4px rgba(0,0,0,0.8)',
  },
};
