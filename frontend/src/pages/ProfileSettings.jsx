import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthProvider';
import { useTheme } from '../context/ThemeProvider';
import { 
  User, Mail, ShieldAlert, Key, Upload, AlertCircle, CheckCircle,
  FileSpreadsheet, Play, CheckCircle2, MinusCircle, RefreshCw, X, Plus, FolderPlus, Info,
  Palette, Sun, Moon
} from 'lucide-react';

export default function ProfileSettings() {
  const { user, updateProfile, updateAvatarUrl } = useAuth();
  const { theme, setTheme, palette, setPalette, availablePalettes } = useTheme();
  
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Status Alerts
  const [profileMessage, setProfileMessage] = useState(null);
  const [avatarMessage, setAvatarMessage] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const fileInputRef = useRef(null);

  // Bulk Ingestion states (Req 1.3 Bulk Import)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [shelves, setShelves] = useState([]);
  const [targetShelfId, setTargetShelfId] = useState('');
  const [createNewShelf, setCreateNewShelf] = useState(false);
  const [newShelfName, setNewShelfName] = useState('');
  const [newShelfDesc, setNewShelfDesc] = useState('');
  
  const [importFile, setImportFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [fieldMappings, setFieldMappings] = useState({
    isbn: '',
    title: '',
    author: '',
    publisher: '',
    physicalLocation: '',
    notes: '',
  });
  
  const [importStep, setImportStep] = useState(1); // 1: Config/Upload, 2: Mapping, 3: Processing
  const [importQueue, setImportQueue] = useState([]); // List of resolved book rows
  const [queueStatus, setQueueStatus] = useState({}); // { [index]: 'pending' | 'processing' | 'success' | 'error' | 'already' }
  const [queueErrors, setQueueErrors] = useState({}); // { [index]: 'error details' }
  const [ingestionInProgress, setIngestionInProgress] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

  const importFileInputRef = useRef(null);

  // Query shelves list on mount / modal open to select destinations
  useEffect(() => {
    async function fetchShelves() {
      try {
        const res = await fetch('/api/bookshelves');
        if (res.ok) {
          const data = await res.json();
          // Filter to bookshelves where the user has write permissions (owner or collaborator)
          const writeable = data.filter(s => s.role === 'owner' || s.role === 'collaborator');
          setShelves(writeable);
          if (writeable.length > 0) {
            setTargetShelfId(writeable[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to query bookshelves list for import mapping:', err);
      }
    }
    if (isImportModalOpen) {
      fetchShelves();
    }
  }, [isImportModalOpen]);

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileMessage(null);

    if (newPassword && newPassword !== confirmPassword) {
      return setProfileMessage({ type: 'error', text: 'New passwords do not match.' });
    }

    setProfileLoading(true);
    try {
      await updateProfile(email, newPassword || null, currentPassword);
      setProfileMessage({ type: 'success', text: 'Profile updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setProfileMessage({ type: 'error', text: err.message });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return setAvatarMessage({ type: 'error', text: 'JPEG, PNG, or WebP images only.' });
    }
    if (file.size > 5 * 1024 * 1024) {
      return setAvatarMessage({ type: 'error', text: 'Image file size cannot exceed 5MB.' });
    }

    setAvatarLoading(true);
    setAvatarMessage(null);

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await fetch('/api/users/profile/avatar', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Avatar upload failed.');

      updateAvatarUrl(data.avatarUrl);
      setAvatarMessage({ type: 'success', text: 'Profile picture updated!' });
    } catch (err) {
      setAvatarMessage({ type: 'error', text: err.message });
    } finally {
      setAvatarLoading(false);
    }
  };

  // 📂 Client-Side File Parsers (Req 1.3)
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileType = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'json'].includes(fileType)) {
      alert('Spreadsheet import accepts CSV or JSON files only.');
      return;
    }

    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      if (fileType === 'json') {
        parseJsonFile(text);
      } else {
        parseCsvFile(text);
      }
    };
    reader.readAsText(file);
  };

  const parseJsonFile = (text) => {
    try {
      const data = JSON.parse(text);
      const rows = Array.isArray(data) ? data : [data];
      if (rows.length === 0) throw new Error('Loaded JSON list is empty.');
      
      const discoveredKeys = Object.keys(rows[0]);
      setHeaders(discoveredKeys);
      setParsedRows(rows);
      autoDetermineMappings(discoveredKeys, rows);
      setImportStep(2);
    } catch (err) {
      alert('Failed parsing JSON file: ' + err.message);
    }
  };

  const parseCsvFile = (text) => {
    try {
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length === 0) throw new Error('Loaded CSV spreadsheet is empty.');
      
      const parsedHeaders = splitCsvLine(lines[0]);
      if (parsedHeaders.length === 0) throw new Error('Failed to resolve CSV headers.');

      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const values = splitCsvLine(lines[i]);
        if (values.length === 0) continue;
        
        const rowObj = {};
        parsedHeaders.forEach((header, idx) => {
          rowObj[header] = values[idx] !== undefined ? values[idx] : '';
        });
        rows.push(rowObj);
      }

      setHeaders(parsedHeaders);
      setParsedRows(rows);
      autoDetermineMappings(parsedHeaders, rows);
      setImportStep(2);
    } catch (err) {
      alert('Failed parsing CSV spreadsheet: ' + err.message);
    }
  };

  const splitCsvLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim().replace(/^"(.*)"$/, '$1'));
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"(.*)"$/, '$1'));
    return result;
  };

  // 🧠 Smart Regex Auto-determine Field Mapping Engine (Req 1.3 mapping)
  const autoDetermineMappings = (discoveredKeys, rows) => {
    const resolved = {
      isbn: '',
      title: '',
      author: '',
      publisher: '',
      physicalLocation: '',
      notes: '',
    };

    discoveredKeys.forEach(key => {
      const k = key.toLowerCase().trim();
      
      if (k.includes('isbn') || k === 'barcode' || k === 'code' || k === 'bookisbn') {
        resolved.isbn = key;
      } else if (k === 'title' || k === 'book' || k === 'name' || k === 'booktitle' || k.includes('title')) {
        resolved.title = key;
      } else if (k === 'author' || k === 'creator' || k === 'writer' || k.includes('author')) {
        resolved.author = key;
      } else if (k === 'publisher' || k.includes('publisher')) {
        resolved.publisher = key;
      } else if (k === 'location' || k.includes('shelf') || k.includes('room') || k === 'place') {
        resolved.physicalLocation = key;
      } else if (k === 'notes' || k === 'comment' || k === 'review' || k === 'desc' || k.includes('notes')) {
        resolved.notes = key;
      }
    });

    // Content regex mapping analysis fallback
    if (!resolved.isbn && rows.length > 0) {
      const firstRow = rows[0];
      for (const key of discoveredKeys) {
        const valStr = String(firstRow[key]).replace(/[- ]/g, '').trim();
        if (/^(97[89])?\d{9}(\d|X)$/i.test(valStr)) {
          resolved.isbn = key;
          break;
        }
      }
    }

    setFieldMappings(resolved);
  };

  const handleMapConfirm = () => {
    if (!createNewShelf && !targetShelfId) {
      alert('Import Error: Please select an existing target bookshelf or opt to create a new one first.');
      setImportStep(1);
      return;
    }

    if (!fieldMappings.title) {
      alert('Mapping Error: A column must be selected for the Book Title field.');
      return;
    }

    const queue = parsedRows.map((row, idx) => {
      const isbnVal = fieldMappings.isbn ? String(row[fieldMappings.isbn]).replace(/[- ]/g, '').toUpperCase().trim() : '';
      const titleVal = fieldMappings.title ? String(row[fieldMappings.title]).trim() : '';
      const authorVal = fieldMappings.author ? String(row[fieldMappings.author]).trim() : '';
      const publisherVal = fieldMappings.publisher ? String(row[fieldMappings.publisher]).trim() : '';
      const locationVal = fieldMappings.physicalLocation ? String(row[fieldMappings.physicalLocation]).trim() : '';
      const notesVal = fieldMappings.notes ? String(row[fieldMappings.notes]).trim() : '';

      return {
        index: idx,
        isbn: isbnVal,
        title: titleVal || 'Untitled Book',
        author: authorVal || 'Unknown Author',
        publisher: publisherVal || 'Unknown Publisher',
        physicalLocation: locationVal || '',
        notes: notesVal || '',
      };
    });

    setImportQueue(queue);
    
    const statusMap = {};
    queue.forEach(item => {
      statusMap[item.index] = 'pending';
    });
    setQueueStatus(statusMap);
    setQueueErrors({});
    setProcessedCount(0);
    setImportStep(3);
  };

  // ⚙️ Sequential Async Ingestion Loop Controller (Req 1.3 queue)
  const handleStartIngestion = async () => {
    if (ingestionInProgress) return;
    setIngestionInProgress(true);

    let activeShelfId = targetShelfId;

    try {
      // 1. Create a brand new bookshelf if requested
      if (createNewShelf) {
        if (!newShelfName.trim()) {
          alert('New Bookshelf Name is required.');
          setIngestionInProgress(false);
          return;
        }

        const shelfRes = await fetch('/api/bookshelves', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newShelfName, description: newShelfDesc }),
        });

        const shelfData = await shelfRes.json();
        if (!shelfRes.ok) throw new Error(shelfData.error || 'Failed to construct target bookshelf.');
        
        activeShelfId = shelfData.bookshelf.id;
        console.log(`✨ Created new bookshelf for import, ID: ${activeShelfId}`);
      }

      // 2. Sequential ingestion worker queue (Req 1.3 sequential processing)
      for (let i = 0; i < importQueue.length; i++) {
        const item = importQueue[i];
        
        setQueueStatus(prev => ({ ...prev, [item.index]: 'processing' }));

        try {
          let success = false;
          let errorMessage = '';

          // Step 2.1: Try ISBN scan pipeline first (allows keyless/keyed API query & catalog caching)
          if (item.isbn && item.isbn.length >= 9) {
            const scanRes = await fetch(`/api/books/scan/${item.isbn}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookshelfId: activeShelfId,
                physicalLocation: item.physicalLocation,
                notes: item.notes,
              }),
            });

            const scanData = await scanRes.json();

            if (scanRes.ok) {
              success = true;
              setQueueStatus(prev => ({ ...prev, [item.index]: 'success' }));
            } else if (scanRes.status === 409) {
              // Deduplication bypass mapping warning (Req 1.3 duplicate skip)
              success = true;
              setQueueStatus(prev => ({ ...prev, [item.index]: 'already' }));
            } else {
              errorMessage = scanData.error || 'ISBN lookup failed.';
            }
          }

          // Step 2.2: Fallback to Manual Ingestion if scan failed, is empty, or timed out
          if (!success) {
            const manualRes = await fetch('/api/books/manual', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookshelfId: activeShelfId,
                isbn: item.isbn || null,
                title: item.title,
                author: item.author,
                publisher: item.publisher,
                coverImageUrl: '',
                pageCount: null,
                publicationDate: '',
                physicalLocation: item.physicalLocation,
                notes: item.notes,
              }),
            });

            const manualData = await manualRes.json();

            if (manualRes.ok) {
              success = true;
              setQueueStatus(prev => ({ ...prev, [item.index]: 'success' }));
            } else if (manualRes.status === 409) {
              success = true;
              setQueueStatus(prev => ({ ...prev, [item.index]: 'already' }));
            } else {
              errorMessage = manualData.error || 'Manual registration failed.';
            }
          }

          if (!success) {
            setQueueStatus(prev => ({ ...prev, [item.index]: 'error' }));
            setQueueErrors(prev => ({ ...prev, [item.index]: errorMessage }));
          }

        } catch (itemErr) {
          console.error(`Ingest row ${item.index} crash:`, itemErr);
          setQueueStatus(prev => ({ ...prev, [item.index]: 'error' }));
          setQueueErrors(prev => ({ ...prev, [item.index]: itemErr.message }));
        }

        setProcessedCount(i + 1);
        // Small delay to protect database pools and respect API thresholds (Req 1.3 delay)
        await new Promise(resolve => setTimeout(resolve, 350));
      }

      alert('Bulk Catalog Ingestion processing loop completed!');

    } catch (err) {
      alert('Ingestion error: ' + err.message);
    } finally {
      setIngestionInProgress(false);
    }
  };

  const handleCloseImportModal = () => {
    setIsImportModalOpen(false);
    setImportStep(1);
    setImportFile(null);
    setParsedRows([]);
    setHeaders([]);
    setImportQueue([]);
    setQueueStatus({});
    setQueueErrors({});
    setCreateNewShelf(false);
    setNewShelfName('');
    setNewShelfDesc('');
    setProcessedCount(0);
  };

  const getInitials = (email) => {
    if (!email) return 'B';
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  return (
    <div style={styles.profileContainer}>
      <header style={styles.header}>
        <h1 style={styles.title}>Account Settings</h1>
        <p style={styles.subtitle}>Manage your library profile credentials and picture avatars.</p>
      </header>

      <div style={styles.grid}>
        {/* Left Card - Avatar Upload */}
        <div style={styles.card} className="glass-panel">
          <h2 style={styles.cardTitle}>Profile Picture</h2>
          
          <div style={styles.avatarBlock}>
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="User Avatar" style={styles.avatarPreview} />
            ) : (
              <div style={styles.avatarFallback}>{getInitials(user?.email)}</div>
            )}
            
            <div style={styles.avatarMeta}>
              <span style={styles.roleBadge}>{user?.role}</span>
              <span style={styles.mimeInfo}>JPEG, PNG, WebP (Max 5MB)</span>
            </div>
          </div>

          {avatarMessage && (
            <div style={{
              ...styles.messageBanner,
              backgroundColor: avatarMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: avatarMessage.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)',
            }}>
              {avatarMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{avatarMessage.text}</span>
            </div>
          )}

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAvatarChange} 
            style={{ display: 'none' }}
            accept="image/*"
            disabled={avatarLoading}
          />
          
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={() => fileInputRef.current.click()}
            disabled={avatarLoading}
            style={styles.uploadBtn}
          >
            <Upload size={18} />
            <span>{avatarLoading ? 'Uploading...' : 'Upload New Picture'}</span>
          </button>
        </div>

        {/* Right Card - Profile Credentials */}
        <div style={{ ...styles.card, flex: 2 }} className="glass-panel">
          <h2 style={styles.cardTitle}>Security Details</h2>

          {profileMessage && (
            <div style={{
              ...styles.messageBanner,
              backgroundColor: profileMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: profileMessage.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)',
            }} className={profileMessage.type === 'error' ? 'error-shake' : ''}>
              {profileMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{profileMessage.text}</span>
            </div>
          )}

          <form onSubmit={handleProfileSubmit} style={styles.form}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input 
                type="email" 
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={profileLoading}
              />
            </div>

            <div style={styles.divider}>
              <Key size={16} style={{ color: 'var(--text-muted)' }} />
              <span style={styles.dividerText}>Update Password (Optional)</span>
            </div>

            <div className="form-group">
              <label className="form-label">New Password</label>
              <input 
                type="password" 
                className="form-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current"
                disabled={profileLoading}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input 
                type="password" 
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                disabled={profileLoading}
              />
            </div>

            <div style={{ ...styles.divider, margin: '24px 0 16px 0' }}></div>

            <div className="form-group">
              <label className="form-label" style={{ color: 'var(--danger-color)' }}>Current Password *</label>
              <input 
                type="password" 
                className="form-input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password to save changes"
                required
                disabled={profileLoading}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={styles.submitBtn} disabled={profileLoading}>
              <span>{profileLoading ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* 🎨 Theme Selection & Aesthetic Personalization Card */}
      <div style={styles.bulkImportCard} className="glass-panel">
        <h2 style={styles.cardTitle}>
          <Palette size={22} style={{ color: 'var(--accent-color)', verticalAlign: 'middle', marginRight: '8px' }} />
          <span>Aesthetic Personalization</span>
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '24px', marginTop: '4px' }}>
          Customize your BookBinder interface using vibrant, harmonized color palettes tailored for reading.
        </p>

        {/* Mode Selector */}
        <div style={styles.themeModeSelectorRow}>
          <span style={styles.settingLabel}>Display Mode</span>
          <div style={styles.toggleButtonGroup}>
            <button 
              type="button" 
              className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTheme('light')}
              style={styles.toggleBtn}
            >
              <Sun size={16} />
              <span>Light Mode</span>
            </button>
            <button 
              type="button" 
              className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTheme('dark')}
              style={styles.toggleBtn}
            >
              <Moon size={16} />
              <span>Dark Mode</span>
            </button>
          </div>
        </div>

        <div style={styles.settingsDivider}></div>

        {/* Palette Selector Swatches Grid */}
        <span style={styles.settingLabel}>Color Palette Swatch</span>
        <div style={styles.paletteGrid}>
          {availablePalettes.map((p) => {
            const isSelected = palette === p.id;
            return (
              <div 
                key={p.id}
                style={{
                  ...styles.paletteCard,
                  borderColor: isSelected ? 'var(--accent-color)' : 'var(--border-glass)',
                  boxShadow: isSelected ? '0 0 0 2px var(--accent-color)' : 'none',
                }}
                onClick={() => setPalette(p.id)}
                className="palette-hover-btn"
              >
                <div style={styles.paletteSwatches}>
                  <span style={{ ...styles.swatch, backgroundColor: p.primary }}></span>
                  <span style={{ ...styles.swatch, backgroundColor: p.secondary }}></span>
                </div>
                <div style={styles.paletteInfo}>
                  <div style={styles.paletteName}>{p.name}</div>
                  <div style={styles.paletteDesc}>{p.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 🚀 Bulk Catalog Ingestion Card (Req 1.3 Bulk Import) */}
      <div style={styles.bulkImportCard} className="glass-panel">
        <h2 style={styles.cardTitle}>Bulk Catalog Ingestion</h2>
        <div style={styles.bulkImportContent}>
          <div style={styles.bulkImportText}>
            <p style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
              Import Spreadsheets (CSV or JSON)
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Seamlessly import catalog files. Automatically resolve columns using smart regex mapping, create bookshelves on-the-fly, and ingest books sequentially with real-time status trackers.
            </p>
          </div>
          <button 
            type="button" 
            className="btn btn-primary"
            onClick={() => setIsImportModalOpen(true)}
            style={{ width: 'fit-content' }}
          >
            <FileSpreadsheet size={18} />
            <span>Launch Import Console</span>
          </button>
        </div>
      </div>

      {/* 🛠️ Bulk Import Console Modal Overlay (Step-by-Step UI) */}
      {isImportModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalCard, maxWidth: importStep === 3 ? '800px' : '650px' }} className="glass-panel">
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                <FileSpreadsheet size={22} style={{ color: 'var(--accent-color)', verticalAlign: 'middle', marginRight: '8px' }} />
                <span>Bulk Catalog Importer</span>
              </h3>
              <button style={styles.closeModalBtn} onClick={handleCloseImportModal} disabled={ingestionInProgress}>
                <X size={20} />
              </button>
            </div>

            {/* STEP 1: Upload File & Select Shelf */}
            {importStep === 1 && (
              <div style={styles.modalBody}>
                <div style={styles.formSection}>
                  <h4 style={styles.formSectionTitle}>1. Target Library Shelf Settings</h4>
                  
                  {/* Create New Bookshelf Toggle */}
                  <div style={styles.checkboxRow}>
                    <input 
                      type="checkbox"
                      id="createNewShelf"
                      checked={createNewShelf}
                      onChange={(e) => setCreateNewShelf(e.target.checked)}
                      disabled={ingestionInProgress}
                    />
                    <label htmlFor="createNewShelf" style={{ fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer' }}>
                      Create a brand new bookshelf for these cataloged items
                    </label>
                  </div>

                  {createNewShelf ? (
                    <div style={styles.subFormBlock}>
                      <div className="form-group">
                        <label className="form-label">New Bookshelf Name *</label>
                        <input 
                          type="text"
                          className="form-input"
                          value={newShelfName}
                          onChange={(e) => setNewShelfName(e.target.value)}
                          placeholder="e.g. My Imported Collection"
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Short Description</label>
                        <textarea 
                          className="form-input"
                          style={{ minHeight: '60px', resize: 'none' }}
                          value={newShelfDesc}
                          onChange={(e) => setNewShelfDesc(e.target.value)}
                          placeholder="e.g. Imported catalog from family archive"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="form-group" style={{ marginTop: '8px' }}>
                      <label className="form-label">Select Destination Bookshelf *</label>
                      {shelves.length === 0 ? (
                        <div style={styles.warningAlert}>
                          <Info size={16} />
                          <span>No writeable bookshelves found. Please check 'Create a new bookshelf' instead.</span>
                        </div>
                      ) : (
                        <select 
                          className="form-input"
                          value={targetShelfId}
                          onChange={(e) => setTargetShelfId(e.target.value)}
                        >
                          {shelves.map(s => (
                            <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ ...styles.formSection, marginTop: '20px' }}>
                  <h4 style={styles.formSectionTitle}>2. Choose Spreadsheet File (.csv or .json)</h4>
                  
                  <div 
                    style={styles.dropZone}
                    onClick={() => importFileInputRef.current.click()}
                  >
                    <Upload size={32} style={{ color: 'var(--accent-color)' }} />
                    <p style={{ fontWeight: '700', margin: '8px 0 4px 0' }}>Click to browse or drop spreadsheet file</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Supports comma-separated CSV or JSON arrays</p>
                  </div>
                  
                  <input 
                    type="file"
                    ref={importFileInputRef}
                    onChange={handleFileChange}
                    accept=".csv,.json"
                    style={{ display: 'none' }}
                  />
                </div>
              </div>
            )}

            {/* STEP 2: Map Fields */}
            {importStep === 2 && (
              <div style={styles.modalBody}>
                <div style={styles.warningAlert}>
                  <Info size={18} />
                  <div>
                    <h5 style={{ fontWeight: '750' }}>Verify Column Field Mapping</h5>
                    <p style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                      Our engine automatically mapped headers using smart regex checks. Review and manually adjust any column keys below if necessary.
                    </p>
                  </div>
                </div>

                <div style={styles.mappingGrid}>
                  {/* Mapping Fields */}
                  <div style={styles.mappingSelectors}>
                    {/* ISBN Column */}
                    <div className="form-group" style={styles.mapFormGroup}>
                      <label className="form-label" style={styles.mapLabel}>ISBN Column</label>
                      <select 
                        className="form-input"
                        value={fieldMappings.isbn}
                        onChange={(e) => setFieldMappings(prev => ({ ...prev, isbn: e.target.value }))}
                      >
                        <option value="">-- Skip Field --</option>
                        {headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>

                    {/* Title Column (Required) */}
                    <div className="form-group" style={styles.mapFormGroup}>
                      <label className="form-label" style={styles.mapLabel}>Book Title Column *</label>
                      <select 
                        className="form-input"
                        style={{ borderColor: fieldMappings.title ? 'var(--border-glass)' : 'var(--danger-color)' }}
                        value={fieldMappings.title}
                        onChange={(e) => setFieldMappings(prev => ({ ...prev, title: e.target.value }))}
                        required
                      >
                        <option value="">-- Select Title (Required) --</option>
                        {headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>

                    {/* Author Column */}
                    <div className="form-group" style={styles.mapFormGroup}>
                      <label className="form-label" style={styles.mapLabel}>Author Column</label>
                      <select 
                        className="form-input"
                        value={fieldMappings.author}
                        onChange={(e) => setFieldMappings(prev => ({ ...prev, author: e.target.value }))}
                      >
                        <option value="">-- Skip Field --</option>
                        {headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>

                    {/* Publisher Column */}
                    <div className="form-group" style={styles.mapFormGroup}>
                      <label className="form-label" style={styles.mapLabel}>Publisher Column</label>
                      <select 
                        className="form-input"
                        value={fieldMappings.publisher}
                        onChange={(e) => setFieldMappings(prev => ({ ...prev, publisher: e.target.value }))}
                      >
                        <option value="">-- Skip Field --</option>
                        {headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>

                    {/* Physical Location Column */}
                    <div className="form-group" style={styles.mapFormGroup}>
                      <label className="form-label" style={styles.mapLabel}>Physical Location</label>
                      <select 
                        className="form-input"
                        value={fieldMappings.physicalLocation}
                        onChange={(e) => setFieldMappings(prev => ({ ...prev, physicalLocation: e.target.value }))}
                      >
                        <option value="">-- Skip Field --</option>
                        {headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>

                    {/* Notes Column */}
                    <div className="form-group" style={styles.mapFormGroup}>
                      <label className="form-label" style={styles.mapLabel}>Personal Notes</label>
                      <select 
                        className="form-input"
                        value={fieldMappings.notes}
                        onChange={(e) => setFieldMappings(prev => ({ ...prev, notes: e.target.value }))}
                      >
                        <option value="">-- Skip Field --</option>
                        {headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div style={styles.modalActions}>
                  <button type="button" className="btn btn-secondary" onClick={() => setImportStep(1)}>
                    Back
                  </button>
                  <button type="button" className="btn btn-primary" onClick={handleMapConfirm}>
                    <span>Confirm Mapping & Preview ({parsedRows.length} books)</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Processing Queue */}
            {importStep === 3 && (
              <div style={styles.modalBody}>
                {/* Progress stats */}
                <div style={styles.progressBarWrapper}>
                  <div style={styles.progressBarHeader}>
                    <span style={{ fontWeight: '750', fontSize: '0.9rem' }}>
                      {ingestionInProgress ? 'Cataloging books sequentially...' : 'Import Preview Ready'}
                    </span>
                    <span style={{ fontWeight: '750', fontSize: '0.85rem', color: 'var(--accent-color)' }}>
                      Processed {processedCount} of {importQueue.length}
                    </span>
                  </div>
                  
                  <div style={styles.progressBarOuter}>
                    <div 
                      style={{ 
                        ...styles.progressBarInner, 
                        width: `${importQueue.length > 0 ? (processedCount / importQueue.length) * 100 : 0}%` 
                      }} 
                    />
                  </div>
                </div>

                {/* Grid checklist of rows */}
                <div style={styles.queueContainer}>
                  <table style={styles.queueTable}>
                    <thead>
                      <tr>
                        <th style={styles.queueTh}>ISBN</th>
                        <th style={styles.queueTh}>Book Title / Author</th>
                        <th style={styles.queueTh}>Shelf Annotations</th>
                        <th style={{ ...styles.queueTh, textAlign: 'right' }}>Ingest Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importQueue.map((item) => {
                        const status = queueStatus[item.index];
                        const errText = queueErrors[item.index];
                        
                        return (
                          <tr key={item.index} style={styles.queueTr}>
                            <td style={styles.queueTd}>
                              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{item.isbn || '-- No ISBN --'}</span>
                            </td>
                            <td style={styles.queueTd}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontWeight: '700', fontSize: '0.85rem' }}>{item.title}</span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>by {item.author}</span>
                              </div>
                            </td>
                            <td style={styles.queueTd}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem' }}>
                                {item.physicalLocation && <span>📍 {item.physicalLocation}</span>}
                                {item.notes && <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>📝 {item.notes}</span>}
                                {!item.physicalLocation && !item.notes && <span style={{ color: 'var(--text-muted)' }}>--</span>}
                              </div>
                            </td>
                            <td style={{ ...styles.queueTd, textAlign: 'right' }}>
                              {status === 'pending' && (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: '700' }}>Pending</span>
                              )}
                              {status === 'processing' && (
                                <span style={{ ...styles.statusTag, backgroundColor: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-color)' }}>
                                  <RefreshCw size={10} className="spin" style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                  <span>Cataloging</span>
                                </span>
                              )}
                              {status === 'success' && (
                                <span style={{ ...styles.statusTag, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)' }}>
                                  <CheckCircle2 size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                  <span>Indexed</span>
                                </span>
                              )}
                              {status === 'already' && (
                                <span style={{ ...styles.statusTag, backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#d97706' }}>
                                  <MinusCircle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                  <span>Already on Shelf</span>
                                </span>
                              )}
                              {status === 'error' && (
                                <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                  <span style={{ ...styles.statusTag, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-color)' }}>
                                    <AlertCircle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                    <span>Failed</span>
                                  </span>
                                  <span style={{ fontSize: '0.65rem', color: 'var(--danger-color)', marginTop: '2px', maxWidth: '160px', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={errText}>
                                    {errText}
                                  </span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={styles.modalActions}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={() => setImportStep(2)}
                    disabled={ingestionInProgress}
                  >
                    Back to Columns
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    onClick={handleStartIngestion}
                    disabled={ingestionInProgress || importQueue.length === 0}
                  >
                    {ingestionInProgress ? (
                      <>
                        <RefreshCw size={16} className="spin" style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                        <span>Processing Catalog Queue...</span>
                      </>
                    ) : (
                      <>
                        <Play size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                        <span>Start Ingesting {importQueue.length} Books</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  profileContainer: {
    paddingBottom: '40px',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    width: '100%',
  },
  themeModeSelectorRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '20px',
    flexWrap: 'wrap',
  },
  toggleButtonGroup: {
    display: 'flex',
    gap: '12px',
  },
  toggleBtn: {
    padding: '8px 16px',
    fontSize: '0.9rem',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  settingsDivider: {
    height: '1px',
    backgroundColor: 'var(--border-glass)',
    margin: '24px 0',
  },
  settingLabel: {
    display: 'block',
    fontSize: '0.9rem',
    fontWeight: '750',
    marginBottom: '12px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-heading)',
  },
  paletteGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '16px',
    width: '100%',
  },
  paletteCard: {
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
    display: 'flex',
    gap: '14px',
    alignItems: 'center',
    cursor: 'pointer',
    backgroundColor: 'var(--bg-glass)',
    transition: 'all 0.3s ease',
  },
  paletteSwatches: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  swatch: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'block',
    boxShadow: 'var(--shadow-sm)',
  },
  paletteInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  paletteName: {
    fontWeight: '750',
    fontSize: '0.95rem',
    color: 'var(--text-primary)',
  },
  paletteDesc: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.2',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  title: {
    fontSize: '2.25rem',
    fontWeight: 800,
  },
  subtitle: {
    color: 'var(--text-secondary)',
    fontSize: '0.95rem',
  },
  grid: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap',
    width: '100%',
  },
  card: {
    flex: 1,
    minWidth: '300px',
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    borderRadius: 'var(--radius-md)',
  },
  cardTitle: {
    fontSize: '1.25rem',
    fontWeight: '750',
    borderBottom: '1px solid var(--border-glass)',
    paddingBottom: '12px',
  },
  avatarBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    marginTop: '8px',
  },
  avatarPreview: {
    width: '96px',
    height: '96px',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '3px solid var(--accent-color)',
    boxShadow: 'var(--shadow-md)',
  },
  avatarFallback: {
    width: '96px',
    height: '96px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--accent-gradient)',
    color: '#ffffff',
    fontSize: '2.25rem',
    fontWeight: '700',
    boxShadow: 'var(--shadow-md)',
  },
  avatarMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  roleBadge: {
    fontSize: '0.75rem',
    fontWeight: '800',
    textTransform: 'uppercase',
    color: 'var(--accent-color)',
    backgroundColor: 'var(--accent-light)',
    padding: '4px 8px',
    borderRadius: '4px',
    letterSpacing: '0.05em',
    width: 'fit-content',
  },
  mimeInfo: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontWeight: '600',
  },
  uploadBtn: {
    width: '100%',
  },
  messageBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.85rem',
    fontWeight: '600',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: '16px 0 12px 0',
    borderBottom: '1px solid var(--border-glass)',
    paddingBottom: '8px',
  },
  dividerText: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  submitBtn: {
    width: '100%',
    marginTop: '12px',
  },
  bulkImportCard: {
    width: '100%',
    padding: '30px',
    borderRadius: 'var(--radius-md)',
    marginTop: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  bulkImportContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '20px',
  },
  bulkImportText: {
    flex: 1,
    minWidth: '260px',
  },
  modalBody: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  formSection: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  formSectionTitle: {
    fontSize: '0.95rem',
    fontWeight: '750',
    color: 'var(--text-primary)',
    marginBottom: '12px',
    borderBottom: '1px solid var(--border-glass)',
    paddingBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: '4px 0 12px 0',
  },
  subFormBlock: {
    backgroundColor: 'var(--bg-primary)',
    padding: '16px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-glass)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginTop: '4px',
    marginBottom: '8px',
  },
  warningAlert: {
    display: 'flex',
    gap: '10px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    color: 'var(--accent-color)',
    border: '1px solid rgba(99, 102, 241, 0.15)',
    fontSize: '0.85rem',
    marginBottom: '16px',
  },
  dropZone: {
    border: '2px dashed var(--border-glass)',
    borderRadius: 'var(--radius-md)',
    padding: '40px 20px',
    textAlign: 'center',
    cursor: 'pointer',
    backgroundColor: 'var(--bg-primary)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition-smooth)',
  },
  mappingGrid: {
    width: '100%',
    marginTop: '8px',
    marginBottom: '16px',
  },
  mappingSelectors: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '16px',
    width: '100%',
  },
  mapFormGroup: {
    marginBottom: 0,
  },
  mapLabel: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  },
  progressBarWrapper: {
    width: '100%',
    marginBottom: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  progressBarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressBarOuter: {
    width: '100%',
    height: '8px',
    backgroundColor: 'var(--bg-primary)',
    borderRadius: '4px',
    overflow: 'hidden',
    border: '1px solid var(--border-glass)',
  },
  progressBarInner: {
    height: '100%',
    backgroundColor: 'var(--accent-color)',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  queueContainer: {
    width: '100%',
    maxHeight: '320px',
    overflowY: 'auto',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-glass)',
    backgroundColor: 'var(--bg-primary)',
    marginBottom: '20px',
  },
  queueTable: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left',
  },
  queueTh: {
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    fontWeight: '800',
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--bg-secondary)',
    padding: '12px 16px',
    borderBottom: '1px solid var(--border-glass)',
    letterSpacing: '0.05em',
  },
  queueTr: {
    borderBottom: '1px solid var(--border-glass)',
  },
  queueTd: {
    padding: '10px 16px',
    fontSize: '0.8rem',
    color: 'var(--text-primary)',
    verticalAlign: 'middle',
  },
  statusTag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '0.7rem',
    fontWeight: '750',
    whiteSpace: 'nowrap',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    backdropFilter: 'blur(4px)',
  },
  modalCard: {
    width: '100%',
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    boxShadow: 'var(--shadow-lg)',
    maxHeight: '90vh',
    overflowY: 'auto',
    borderRadius: 'var(--radius-lg)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: '1.25rem',
    fontWeight: '750',
  },
  closeModalBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '12px',
  },
};
