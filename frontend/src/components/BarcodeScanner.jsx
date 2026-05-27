import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Volume2, VolumeX, AlertCircle } from 'lucide-react';

export default function BarcodeScanner({ onScanSuccess, onScanError }) {
  const [isActive, setIsActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isVibratingSupport, setIsVibratingSupport] = useState(true);
  const [isPulse, setIsPulse] = useState(false);
  
  // v1.4 Scanner Lookup Confirmation states
  const [lookupDetails, setLookupDetails] = useState(null);
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  
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

  const handleScanLookup = async (isbn) => {
    setIsLookupLoading(true);
    setScanError(null);
    setLookupDetails(null);
    
    try {
      const res = await fetch(`/api/books/lookup/${isbn}`);
      const data = await res.json();
      
      if (res.status === 404 && data.fallbackToManual) {
        // Stop scanning completely and fallback to parent manual redirection tab
        await stopScanner();
        onScanSuccess(isbn);
      } else if (!res.ok) {
        throw new Error(data.error || 'Metadata lookup failed.');
      } else {
        setLookupDetails(data);
      }
    } catch (err) {
      console.error('Scan lookup failed:', err);
      setScanError(err.message || 'Failed to query book metadata.');
    } finally {
      setIsLookupLoading(false);
    }
  };

  const handleConfirmYes = () => {
    if (lookupDetails) {
      onScanSuccess(lookupDetails.isbn);
    }
    handleConfirmDismiss();
  };

  const handleConfirmDismiss = () => {
    setLookupDetails(null);
    setScanError(null);
    if (qrCodeRef.current) {
      try {
        qrCodeRef.current.resume();
      } catch (e) {
        console.warn('Failed to resume scanner:', e);
      }
    }
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

    setIsActive(true);
  };

  useEffect(() => {
    let html5Qrcode = null;

    const initScanner = async () => {
      if (!isActive) return;

      try {
        html5Qrcode = new Html5Qrcode(scannerContainerId);
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

        try {
          await html5Qrcode.start(
            { facingMode: 'environment' }, // Target rear camera (Req 4.1.3)
            config,
            (decodedText) => {
              if (qrCodeRef.current && qrCodeRef.current.isScanning) {
                if (qrCodeRef.current.isPaused()) return;
                try {
                  qrCodeRef.current.pause(true);
                } catch (e) {
                  console.warn('Scan pause error:', e);
                }
              }
              // ISBN found!
              triggerSuccessSignals();
              handleScanLookup(decodedText);
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
              if (qrCodeRef.current && qrCodeRef.current.isScanning) {
                if (qrCodeRef.current.isPaused()) return;
                try {
                  qrCodeRef.current.pause(true);
                } catch (e) {
                  console.warn('Scan pause error:', e);
                }
              }
              triggerSuccessSignals();
              handleScanLookup(decodedText);
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

    if (isActive) {
      // Small timeout to ensure browser has painted the element and offsetWidth/offsetHeight are positive
      const timer = setTimeout(() => {
        initScanner();
      }, 80);
      
      return () => {
        clearTimeout(timer);
        if (html5Qrcode && html5Qrcode.isScanning) {
          html5Qrcode.stop().catch(console.error);
        }
      };
    }
  }, [isActive]);

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

          {/* v1.4 Loading Overlay */}
          {isLookupLoading && (
            <div style={styles.confirmationOverlay}>
              <RefreshCw size={36} className="spin" style={{ color: 'var(--accent-color)' }} />
              <p style={{ fontWeight: '600', fontSize: '0.9rem', marginTop: '8px' }}>Fetching book details...</p>
            </div>
          )}

          {/* v1.4 Confirmation Overlay */}
          {lookupDetails && (
            <div style={styles.confirmationOverlay}>
              <h4 style={{ fontWeight: '800', fontSize: '1rem', color: 'var(--accent-color)', marginBottom: '8px' }}>
                Is this the correct book?
              </h4>
              
              {lookupDetails.cover_image_url ? (
                <img 
                  src={lookupDetails.cover_image_url} 
                  alt="" 
                  style={styles.confirmCover} 
                  onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                />
              ) : null}
              <div style={{ ...styles.confirmCoverFallback, display: lookupDetails.cover_image_url ? 'none' : 'flex' }}>
                <Camera size={24} style={{ color: 'var(--text-muted)' }} />
              </div>

              <div style={{ marginTop: '6px' }}>
                <div style={styles.confirmTitle} title={lookupDetails.title}>{lookupDetails.title}</div>
                <div style={styles.confirmAuthor}>by {lookupDetails.author || 'Unknown Author'}</div>
              </div>

              <div style={styles.confirmButtons}>
                <button className="btn btn-danger" style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem' }} onClick={handleConfirmDismiss}>
                  No, Skip
                </button>
                <button className="btn btn-success" style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem', backgroundColor: 'var(--success-color)', border: 'none', color: '#ffffff' }} onClick={handleConfirmYes}>
                  Yes, Add
                </button>
              </div>
            </div>
          )}

          {/* v1.4 Scan Error Overlay */}
          {scanError && (
            <div style={styles.confirmationOverlay}>
              <AlertCircle size={36} style={{ color: 'var(--danger-color)' }} />
              <p style={{ fontWeight: '600', fontSize: '0.85rem', color: 'var(--danger-color)', maxWidth: '240px', marginTop: '8px' }}>{scanError}</p>
              <button className="btn btn-secondary" style={{ height: '36px', padding: '0 16px', fontSize: '0.85rem', marginTop: '12px' }} onClick={handleConfirmDismiss}>
                Scan Again
              </button>
            </div>
          )}
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
  confirmationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    color: '#ffffff',
    zIndex: 10,
    textAlign: 'center',
    gap: '12px',
  },
  confirmCover: {
    height: '110px',
    borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    objectFit: 'cover',
  },
  confirmCoverFallback: {
    height: '110px',
    width: '75px',
    borderRadius: '4px',
    backgroundColor: 'var(--bg-glass)',
    border: '1px solid var(--border-glass)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  confirmTitle: {
    fontSize: '0.95rem',
    fontWeight: '750',
    lineHeight: '1.3',
    maxWidth: '240px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  confirmAuthor: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    fontWeight: '600',
  },
  confirmButtons: {
    display: 'flex',
    gap: '12px',
    marginTop: '6px',
    width: '100%',
    justifyContent: 'center',
  },
};
