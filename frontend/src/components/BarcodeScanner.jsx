import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Volume2, VolumeX, AlertCircle, RefreshCw } from 'lucide-react';
import { cleanISBN, isValidBarcode, isValidISBN } from '../utils/isbn';
import BookVolume from './BookVolume';

/**
 * The decode region, as a fraction of the viewport.
 *
 * These two numbers are the single source of truth: the qrbox config below is
 * computed from them, and so is the on-screen reticle. The previous overlay was
 * positioned independently (top:25%, height:35%) and so sat about 7% above the
 * region html5-qrcode was actually decoding — the guide box and the scanner
 * disagreed about where the barcode should go.
 */
const BOX_W = 0.7;
const BOX_H = 0.35;

/** The mask cut-outs, derived so they can never drift from the region. */
const MASK_X = `${((1 - BOX_W) / 2) * 100}%`;
const MASK_Y = `${((1 - BOX_H) / 2) * 100}%`;

export default function BarcodeScanner({ onScanSuccess, onConfirm, onScanError, onManualFallback }) {
  const [isActive, setIsActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isVibratingSupport, setIsVibratingSupport] = useState(true);
  const [isPulse, setIsPulse] = useState(false);
  
  // v1.4 Scanner Lookup Confirmation states
  const [lookupDetails, setLookupDetails] = useState(null);
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [unknownBarcode, setUnknownBarcode] = useState(null);
  
  const qrCodeRef = useRef(null);
  const isScannerPausedRef = useRef(false);
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

  const handleScanLookup = async (barcode) => {
    isScannerPausedRef.current = true;
    setIsLookupLoading(true);
    setScanError(null);
    setUnknownBarcode(null);
    setLookupDetails(null);

    try {
      const res = await fetch(`/api/books/lookup/${barcode}`);
      const data = await res.json();

      if (res.status === 404 && data.fallbackToManual) {
        if (data.barcodeType === 'upc') {
          /*
           * A UPC that the catalog has not been taught is a dead end, not a
           * failure worth tearing the session down for — no metadata provider
           * indexes book UPCs. Keep the camera up: the same cover usually
           * carries an ISBN barcode that resolves in one shot.
           */
          setUnknownBarcode(data.barcode || barcode);
          return;
        }
        // Stop scanning completely and fallback to parent manual redirection tab
        await stopScanner();
        onScanSuccess(barcode);
      } else if (!res.ok) {
        throw new Error(data.error || 'Metadata lookup failed.');
      } else {
        // A UPC withheld its "captured" signal until now (see onDecoded)
        if (!isValidISBN(barcode)) triggerSuccessSignals();
        setLookupDetails(data);
      }
    } catch (err) {
      console.error('Scan lookup failed:', err);
      setScanError(err.message || 'Failed to query book metadata.');
    } finally {
      setIsLookupLoading(false);
    }
  };

  /** Hand an unteachable barcode to the manual form, carrying it along to be learned. */
  const handleEnterManually = async () => {
    const barcode = unknownBarcode;
    setUnknownBarcode(null);
    await stopScanner();
    if (onManualFallback) onManualFallback({ barcode, barcodeType: 'upc' });
    else onScanSuccess(barcode);
  };

  const handleConfirmYes = () => {
    if (lookupDetails) {
      /*
       * Standing at a shelf, confirm-and-return is the wrong loop: you work
       * along a row of thirty spines, not one book at a time. When the caller
       * supplies onConfirm the volume drops into its session tray and the
       * camera stays live; the whole run is filed in one go at the end.
       */
      if (onConfirm) onConfirm(lookupDetails);
      else onScanSuccess(lookupDetails.isbn);
    }
    handleConfirmDismiss();
  };

  const handleConfirmDismiss = () => {
    setLookupDetails(null);
    setScanError(null);
    setUnknownBarcode(null);
    isScannerPausedRef.current = false;
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
            // Responsive target frame, centred by html5-qrcode. The reticle
            // overlay is laid out from the same two constants.
            const side = Math.min(width, height);
            return { width: side * BOX_W, height: side * BOX_H };
          },
          aspectRatio: 1.0,
        };

        const onDecoded = (decodedText) => {
          if (isScannerPausedRef.current) return;

          // ISBN-10/13 or valid UPC-A checksum matches count as a hit. Anything
          // else (library stickers, malformed reads) is ignored so the camera
          // keeps scanning without firing a false success signal (Req 4.1.3).
          const candidate = cleanISBN(decodedText);
          if (!isValidBarcode(candidate)) return;

          isScannerPausedRef.current = true;

          if (qrCodeRef.current && qrCodeRef.current.isScanning) {
            try {
              qrCodeRef.current.pause(true);
            } catch (e) {
              console.warn('Scan pause error:', e);
            }
          }

          /*
           * A Bookland EAN is a book by construction, so it earns the "captured"
           * buzz the instant it decodes. A UPC-A does not: it is an ordinary
           * product code, and a cereal box satisfies the same checksum. Those
           * wait until the lookup resolves, or the signal would tell the user
           * "got it" for something that was never a book (Req 4.1.3).
           */
          if (isValidISBN(candidate)) triggerSuccessSignals();
          handleScanLookup(candidate);
        };

        const onDecodeFailure = (error) => {
          if (onScanError) onScanError(error);
        };

        try {
          // Req 4.1.3 mandates the exact rear-camera constraint; the catch below is
          // the required programmatic fallback for devices with a single camera.
          await html5Qrcode.start(
            { facingMode: { exact: 'environment' } },
            config,
            onDecoded,
            onDecodeFailure
          );
        } catch (envErr) {
          console.warn('Exact rear camera constraint failed, relaxing to preferred environment:', envErr);
          try {
            await html5Qrcode.start({ facingMode: 'environment' }, config, onDecoded, onDecodeFailure);
          } catch (preferredErr) {
            console.warn('Preferred environment constraint failed, using default camera:', preferredErr);
            // Empty constraints allows the browser to pick its default webcam
            await html5Qrcode.start({}, config, onDecoded, onDecodeFailure);
          }
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
    isScannerPausedRef.current = false;
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
        className="card"
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
        <div style={styles.cameraViewport} className="card">
          <div id={scannerContainerId} style={styles.cameraPreview}></div>
          
          {/* Mask, cut to the decode region on all four sides. Four panels
              rather than one giant spread box-shadow, so the region and the
              mask are guaranteed to be the same rectangle. */}
          <div style={{ ...styles.mask, left: 0, right: 0, top: 0, height: MASK_Y }} />
          <div style={{ ...styles.mask, left: 0, right: 0, bottom: 0, height: MASK_Y }} />
          <div style={{ ...styles.mask, left: 0, top: MASK_Y, bottom: MASK_Y, width: MASK_X }} />
          <div style={{ ...styles.mask, right: 0, top: MASK_Y, bottom: MASK_Y, width: MASK_X }} />

          {/* The reticle: corner brackets on the decode region itself, with the
              caption below the mask rather than printed over the barcode. */}
          <div style={styles.reticle} className={isPulse ? 'scan-pulse' : ''}>
            <span style={{ ...styles.corner, left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3, borderRadius: '5px 0 0 0' }} />
            <span style={{ ...styles.corner, right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3, borderRadius: '0 5px 0 0' }} />
            <span style={{ ...styles.corner, left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderRadius: '0 0 0 5px' }} />
            <span style={{ ...styles.corner, right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3, borderRadius: '0 0 5px 0' }} />
            <span style={styles.scanningLine} className="scan-sweep" />
            <span style={styles.guideText}>
              {isPulse ? 'Matched' : 'Align the barcode'}
            </span>
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
              
              <BookVolume
                title={lookupDetails.title}
                author={lookupDetails.author}
                coverUrl={lookupDetails.cover_image_url}
                seed={lookupDetails.isbn}
                size="sm"
                style={{ width: '82px' }}
              />

              <div style={{ marginTop: '6px' }}>
                <div style={styles.confirmTitle} title={lookupDetails.title}>{lookupDetails.title}</div>
                <div style={styles.confirmAuthor}>by {lookupDetails.author || 'Unknown Author'}</div>
              </div>

              <div style={styles.confirmButtons}>
                <button className="btn btn-danger" style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem' }} onClick={handleConfirmDismiss}>
                  No, Skip
                </button>
                <button className="btn btn-success" style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem', backgroundColor: 'var(--success-color)', border: 'none', color: '#ffffff' }} onClick={handleConfirmYes}>
                  {onConfirm ? 'File it' : 'Yes, Add'}
                </button>
              </div>
            </div>
          )}

          {/* Unrecognized UPC Overlay — camera stays live behind it */}
          {unknownBarcode && (
            <div style={styles.confirmationOverlay}>
              <AlertCircle size={32} style={{ color: 'var(--accent-color)' }} />
              <p style={{ fontWeight: '700', fontSize: '0.9rem', marginTop: '4px' }}>
                Product barcode not in your catalog
              </p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '260px', lineHeight: '1.45' }}>
                No book database indexes UPCs. Scan the ISBN barcode on this cover instead, or
                enter it once and this code will be remembered for next time.
              </p>
              <code style={styles.barcodeChip}>{unknownBarcode}</code>

              <div style={styles.confirmButtons}>
                <button
                  className="btn btn-secondary"
                  style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem' }}
                  onClick={handleConfirmDismiss}
                >
                  Scan Again
                </button>
                <button
                  className="btn btn-primary"
                  style={{ height: '36px', padding: '0 16px', fontSize: '0.8rem' }}
                  onClick={handleEnterManually}
                >
                  Enter Manually
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
    backgroundColor: 'color-mix(in srgb, var(--danger-color) 11%, transparent)',
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
    backgroundColor: 'var(--surface-raised)',
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
    border: '2px solid var(--rule)',
  },
  cameraPreview: {
    width: '100%',
    height: '100%',
  },
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(10, 7, 4, 0.7)',
    pointerEvents: 'none',
    zIndex: 2,
  },
  reticle: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: `${BOX_W * 100}%`,
    height: `${BOX_H * 100}%`,
    pointerEvents: 'none',
    zIndex: 3,
  },
  corner: {
    position: 'absolute',
    width: '26px',
    height: '26px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 252, 245, 0.92)',
    borderWidth: 0,
  },
  scanningLine: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    top: '50%',
    height: '2px',
    backgroundColor: 'rgba(255, 252, 245, 0.92)',
    boxShadow: '0 0 10px rgba(255, 252, 245, 0.85)',
  },
  guideText: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Clear of the mask edge, so the caption never sits on the barcode
    bottom: '-34px',
    textAlign: 'center',
    fontFamily: 'var(--font-stamp)',
    fontSize: '0.69rem',
    fontWeight: 700,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'rgba(255, 252, 245, 0.9)',
    textShadow: '0 2px 6px rgba(0, 0, 0, 0.9)',
    whiteSpace: 'nowrap',
  },
  confirmationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(16, 11, 7, 0.95)',
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
  barcodeChip: {
    fontFamily: 'var(--font-stamp), monospace',
    fontSize: '0.8rem',
    letterSpacing: '0.1em',
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(255, 252, 245, 0.1)',
    color: 'rgba(255, 252, 245, 0.85)',
  },
  confirmButtons: {
    display: 'flex',
    gap: '12px',
    marginTop: '6px',
    width: '100%',
    justifyContent: 'center',
  },
};
