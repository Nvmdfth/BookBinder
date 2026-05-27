import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BarcodeScanner from '../components/BarcodeScanner';
import { 
  Book, MapPin, Notebook, Plus, Pencil, Trash2, Users, X, Share2, 
  Settings, AlertTriangle, ArrowLeft, Camera, FileText, CheckCircle,
  Search, Bookmark, Check, LayoutGrid, List
} from 'lucide-react';

export default function BookshelfDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [shelf, setShelf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Scanning / Creation view controls
  const [activeTab, setActiveTab] = useState('list'); // 'list', 'scan', 'manual'
  const [prefilledIsbn, setPrefilledIsbn] = useState('');
  
  // v1.5 Grid/List View and Reassignment States
  const [viewMode, setViewMode] = useState(localStorage.getItem('bookbinder_view_mode') || 'grid');
  const [writeableShelves, setWriteableShelves] = useState([]);
  const [targetBookshelfId, setTargetBookshelfId] = useState('');
  const [scanMessage, setScanMessage] = useState(null);
  
  // Modal controllers
  const [editingMapping, setEditingMapping] = useState(null); // Mapping row to edit annotations
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  
  // Sharing management state
  const [shares, setShares] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePerm, setInvitePerm] = useState('view');
  const [shareLoading, setShareLoading] = useState(false);

  // Manual Creation Forms State
  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualPublisher, setManualPublisher] = useState('');
  const [manualCover, setManualCover] = useState('');
  const [manualPages, setManualPages] = useState('');
  const [manualPubDate, setManualPubDate] = useState('');
  const [manualLocation, setManualLocation] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Annotation Edit Forms State
  const [editLocation, setEditLocation] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Wildcard Search Forms State (Req 1.2 Search)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [ingestingBookIsbn, setIngestingBookIsbn] = useState(null);

  const handleWildcardSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return;

    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/books/search?q=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search query failed.');
      setSearchResults(data);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchAddBook = async (book) => {
    setIngestingBookIsbn(book.isbn);
    try {
      const res = await fetch('/api/books/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookshelfId: id,
          isbn: book.isbn,
          title: book.title,
          author: book.author,
          publisher: book.publisher,
          coverImageUrl: book.cover_image_url,
          pageCount: book.page_count,
          publicationDate: book.publication_date,
          physicalLocation: '',
          notes: '',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add search result.');

      // Update UI list mapping state
      setShelf((prev) => ({
        ...prev,
        books: [
          {
            mapping_id: data.mapping.id,
            book_id: data.book.id,
            isbn: data.book.isbn,
            title: data.book.title,
            author: data.book.author,
            publisher: data.book.publisher,
            cover_image_url: data.book.cover_image_url,
            page_count: data.book.page_count,
            publication_date: data.book.publication_date,
            physical_location: data.mapping.physical_location,
            notes: data.mapping.notes,
            is_read: false,
          },
          ...prev.books,
        ],
      }));

      alert(`"${book.title}" added to shelf successfully!`);
    } catch (err) {
      alert(err.message);
    } finally {
      setIngestingBookIsbn(null);
    }
  };

  const handleToggleReadStatus = async (b) => {
    const nextReadState = !b.is_read;
    try {
      const res = await fetch(`/api/books/mapping/${b.mapping_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: nextReadState }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update read status.');

      // Update local state
      setShelf((prev) => ({
        ...prev,
        books: prev.books.map((book) =>
          book.mapping_id === b.mapping_id ? { ...book, is_read: data.mapping.is_read } : book
        ),
      }));
    } catch (err) {
      alert(err.message);
    }
  };

  const fetchShelfDetails = async () => {
    try {
      const res = await fetch(`/api/bookshelves/${id}`);
      if (!res.ok) throw new Error('Bookshelf details could not be resolved.');
      const data = await res.json();
      setShelf(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchWriteableShelves = async () => {
    try {
      const res = await fetch('/api/bookshelves');
      if (res.ok) {
        const data = await res.json();
        // Filter to owner/collaborator role and exclude current shelf ID
        const filtered = data.filter(
          (s) => (s.role === 'owner' || s.role === 'collaborator') && s.id !== parseInt(id, 10)
        );
        setWriteableShelves(filtered);
      }
    } catch (err) {
      console.warn('Failed to fetch writeable shelves list:', err);
    }
  };

  const fetchShareList = async () => {
    try {
      const res = await fetch(`/api/shares/${id}`);
      if (res.ok) {
        const data = await res.json();
        setShares(data);
      }
    } catch (err) {
      console.warn('Shares list fetch failed (likely not owner):', err);
    }
  };

  useEffect(() => {
    fetchShelfDetails();
    fetchWriteableShelves();
  }, [id]);

  useEffect(() => {
    if (shelf?.isOwner) {
      fetchShareList();
    }
  }, [shelf]);

  const handleScanSuccess = async (isbn) => {
    setScanMessage(null);
    try {
      const res = await fetch(`/api/books/scan/${isbn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookshelfId: id,
          physicalLocation: '',
          notes: '',
        }),
      });

      const data = await res.json();

      if (res.status === 404 && data.fallbackToManual) {
        // Ingestion fail redirect fallback prefilled (Req 5.3)
        setPrefilledIsbn(isbn);
        setManualTitle('');
        setManualAuthor('');
        setManualPublisher('');
        setManualCover('');
        setManualPages('');
        setManualPubDate('');
        setManualLocation('');
        setManualNotes('');
        setActiveTab('manual');
        alert('ISBN lookup timed out or failed. Prefilled details redirection loaded.');
      } else if (!res.ok) {
        throw new Error(data.error || 'Barcode ingestion failed.');
      } else {
        // Success
        setScanMessage({ type: 'success', text: `"${data.book.title}" added to library!` });
        setShelf((prev) => ({
          ...prev,
          books: [
            {
              mapping_id: data.mapping.id,
              book_id: data.book.id,
              isbn: data.book.isbn,
              title: data.book.title,
              author: data.book.author,
              publisher: data.book.publisher,
              cover_image_url: data.book.cover_image_url,
              page_count: data.book.page_count,
              publication_date: data.book.publication_date,
              physical_location: data.mapping.physical_location,
              notes: data.mapping.notes,
            },
            ...prev.books,
          ],
        }));
      }
    } catch (err) {
      setScanMessage({ type: 'error', text: err.message });
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualTitle.trim()) return;

    setActionLoading(true);
    try {
      const res = await fetch('/api/books/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookshelfId: id,
          isbn: prefilledIsbn || null,
          title: manualTitle,
          author: manualAuthor,
          publisher: manualPublisher,
          coverImageUrl: manualCover,
          pageCount: manualPages,
          publicationDate: manualPubDate,
          physicalLocation: manualLocation,
          notes: manualNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to manually register book.');

      setShelf((prev) => ({
        ...prev,
        books: [
          {
            mapping_id: data.mapping.id,
            book_id: data.book.id,
            isbn: data.book.isbn,
            title: data.book.title,
            author: data.book.author,
            publisher: data.book.publisher,
            cover_image_url: data.book.cover_image_url,
            page_count: data.book.page_count,
            publication_date: data.book.publication_date,
            physical_location: data.mapping.physical_location,
            notes: data.mapping.notes,
          },
          ...prev.books,
        ],
      }));

      // Reset
      setActiveTab('list');
      setPrefilledIsbn('');
      setManualTitle('');
      setManualAuthor('');
      setManualPublisher('');
      setManualCover('');
      setManualPages('');
      setManualPubDate('');
      setManualLocation('');
      setManualNotes('');
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateAnnotations = async (e) => {
    e.preventDefault();
    if (!editingMapping) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/books/mapping/${editingMapping.mapping_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          physicalLocation: editLocation,
          notes: editNotes,
          targetBookshelfId: targetBookshelfId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save annotations.');

      // Update UI list state: if moved, filter it out from the current shelf rendering, else update inline
      if (targetBookshelfId && parseInt(targetBookshelfId, 10) !== parseInt(id, 10)) {
        setShelf((prev) => ({
          ...prev,
          books: prev.books.filter((b) => b.mapping_id !== editingMapping.mapping_id),
        }));
        alert(`Successfully reassigned to the selected bookshelf!`);
      } else {
        setShelf((prev) => ({
          ...prev,
          books: prev.books.map((b) =>
            b.mapping_id === editingMapping.mapping_id
              ? { ...b, physical_location: data.mapping.physical_location, notes: data.mapping.notes }
              : b
          ),
        }));
      }

      setEditingMapping(null);
      setTargetBookshelfId('');
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteMapping = async (mappingId) => {
    if (!confirm('Are you sure you want to remove this book from this bookshelf?')) return;

    try {
      const res = await fetch(`/api/books/mapping/${mappingId}/delete`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Deletion failed.');

      setShelf((prev) => ({
        ...prev,
        books: prev.books.filter((b) => b.mapping_id !== mappingId),
      }));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleInviteShare = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setShareLoading(true);
    try {
      const res = await fetch(`/api/shares/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, permission: invitePerm }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Share invite failed.');

      // Update shares list (checking for updates vs new)
      setShares((prev) => {
        const existsIndex = prev.findIndex((s) => s.id === data.share.id);
        if (existsIndex > -1) {
          return prev.map((s) => (s.id === data.share.id ? data.share : s));
        }
        return [...prev, data.share];
      });

      setInviteEmail('');
      alert('Bookshelf shared successfully.');
    } catch (err) {
      alert(err.message);
    } finally {
      setShareLoading(false);
    }
  };

  const handleRemoveShare = async (shareId) => {
    if (!confirm('Are you sure you want to revoke this user\'s access to this library shelf?')) return;

    try {
      const res = await fetch(`/api/shares/remove/${shareId}`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Revoke share failed.');

      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteShelf = async () => {
    if (!confirm('⚠️ DANGER: Are you sure you want to delete this bookshelf? All books linked inside this shelf will lose their shelf mapping! This action is permanent.')) return;

    try {
      const res = await fetch(`/api/bookshelves/${id}/delete`, { method: 'POST' });
      if (!res.ok) throw new Error('Delete shelf failed.');
      navigate('/');
    } catch (err) {
      alert(err.message);
    }
  };

  // Helper handling image failures
  const handleImageError = (e) => {
    e.target.style.display = 'none';
    e.target.nextSibling.style.display = 'flex'; // Show high-contrast placeholder
  };

  if (loading) {
    return (
      <div className="skeleton" style={{ height: '300px', width: '100%', borderRadius: 'var(--radius-md)' }}></div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorContainer} className="glass-panel error-shake">
        <AlertTriangle size={32} style={{ color: 'var(--danger-color)' }} />
        <h3>Access Denied</h3>
        <p>{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>
          <ArrowLeft size={18} />
          <span>Return Home</span>
        </button>
      </div>
    );
  }

  const isViewOnly = shelf.accessRole === 'view'; // Access rule parameter checking (Req 4.3.2)
  const isCollaborator = shelf.accessRole === 'owner' || shelf.accessRole === 'collaborator';

  return (
    <div style={styles.detailsContainer}>
      {/* Header Info */}
      <header style={styles.detailsHeader}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>
          <ArrowLeft size={20} />
          <span>Back to Libraries</span>
        </button>
        
        <div style={styles.shelfInfoRow}>
          <div>
            <div style={styles.shelfTitleBlock}>
              <h1 style={styles.title}>{shelf.name}</h1>
              <span style={{ 
                ...styles.badge, 
                ...(shelf.accessRole === 'owner' ? styles.badgeOwner : 
                    shelf.accessRole === 'collaborator' ? styles.badgeCollab : styles.badgeViewer)
              }}>
                {shelf.accessRole}
              </span>
            </div>
            <p style={styles.desc}>{shelf.description || 'No descriptive notes added yet.'}</p>
          </div>
          
          <div style={styles.headerActions}>
            {shelf.isOwner && (
              <>
                <button className="btn btn-secondary" onClick={() => setIsShareModalOpen(true)}>
                  <Share2 size={18} />
                  <span>Share Shelf</span>
                </button>
                {!shelf.isWishlist && (
                  <button className="btn btn-danger" onClick={handleDeleteShelf} style={styles.deleteShelfBtn}>
                    <Trash2 size={18} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* 🔒 RBAC View Triggers (Hides all inputs/mutators if View-Only) (Req 4.3.2) */}
      {isCollaborator && (
        <div style={styles.tabBar} className="glass-panel">
          <button 
            style={{ ...styles.tabBtn, ...(activeTab === 'list' ? styles.tabBtnActive : {}) }}
            onClick={() => setActiveTab('list')}
          >
            <Book size={18} />
            <span>Library Shelf</span>
          </button>
          
          <button 
            style={{ ...styles.tabBtn, ...(activeTab === 'search' ? styles.tabBtnActive : {}) }}
            onClick={() => setActiveTab('search')}
          >
            <Search size={18} />
            <span>Search & Add</span>
          </button>

          <button 
            style={{ ...styles.tabBtn, ...(activeTab === 'scan' ? styles.tabBtnActive : {}) }}
            onClick={() => setActiveTab('scan')}
          >
            <Camera size={18} />
            <span>Scan Ingestion</span>
          </button>
          
          <button 
            style={{ ...styles.tabBtn, ...(activeTab === 'manual' ? styles.tabBtnActive : {}) }}
            onClick={() => setActiveTab('manual')}
          >
            <Plus size={18} />
            <span>Add Manually</span>
          </button>
        </div>
      )}

      {/* 🔍 Search & Add Wildcard Books Tab (Req 1.2 Search) */}
      {isCollaborator && activeTab === 'search' && (
        <div style={styles.searchForm} className="glass-panel">
          <h2 style={styles.tabTitle}>Wildcard Catalog Search</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '12px', width: '100%' }}>
            Type a wildcard title or author to query the local cache and external volume APIs.
          </p>

          <form onSubmit={handleWildcardSearch} style={styles.searchBarRow}>
            <input 
              type="text" 
              className="form-input" 
              style={{ flex: 1, height: '45px' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, author, or publisher (e.g. Tolkien)"
              required
              disabled={searchLoading}
            />
            <button type="submit" className="btn btn-primary" style={{ height: '45px' }} disabled={searchLoading}>
              <Search size={18} />
              <span>Search</span>
            </button>
          </form>

          {searchError && (
            <div style={{ ...styles.scanMessage, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-color)', alignSelf: 'stretch', maxWidth: 'none' }}>
              <AlertTriangle size={18} />
              <span>{searchError}</span>
            </div>
          )}

          {searchLoading && (
            <div style={styles.skeletonList}>
              {[1, 2, 3].map((n) => (
                <div key={n} className="skeleton" style={styles.skeletonItem}></div>
              ))}
            </div>
          )}

          {!searchLoading && searchResults.length > 0 && (
            <div style={styles.searchCardList}>
              {searchResults.map((book, idx) => {
                const bookKey = book.isbn || `SEARCH-${idx}`;
                
                // Deduplicate check if book is already mapped on this shelf
                const isAlreadyOnShelf = book.isbn && shelf.books.some(sb => sb.isbn === book.isbn);
                const isAdding = ingestingBookIsbn === book.isbn;

                return (
                  <div key={bookKey} style={styles.searchCard}>
                    {book.cover_image_url ? (
                      <img 
                        src={book.cover_image_url} 
                        alt="" 
                        style={styles.searchCoverImg} 
                        onError={handleImageError} 
                      />
                    ) : (
                      <div style={styles.searchCoverFallback}>
                        <Book size={20} />
                      </div>
                    )}

                    <div style={styles.searchInfo}>
                      <span style={styles.searchTitle} title={book.title}>{book.title}</span>
                      <span style={styles.searchAuthor}>{book.author}</span>
                      <div style={styles.searchMeta}>
                        {book.publisher && <span>{book.publisher}</span>}
                        {book.publication_date && <span>• {book.publication_date}</span>}
                        {book.page_count && <span>• {book.page_count} pages</span>}
                      </div>
                      
                      <span style={{
                        ...styles.sourceBadge,
                        ...(book.source === 'local' ? styles.sourceLocal : 
                            book.source === 'google_books' ? styles.sourceGoogle : styles.sourceOpenLibrary)
                      }}>
                        {book.source === 'local' ? 'In Library (Cached)' : 
                         book.source === 'google_books' ? 'Google Books' : 'Open Library'}
                      </span>
                    </div>

                    {isAlreadyOnShelf ? (
                      <button className="btn btn-secondary" style={{ height: '36px', padding: '0 12px', fontSize: '0.8rem' }} disabled>
                        <Check size={14} />
                        <span>Added</span>
                      </button>
                    ) : (
                      <button 
                        className="btn btn-primary" 
                        style={{ height: '36px', padding: '0 12px', fontSize: '0.8rem' }} 
                        onClick={() => handleSearchAddBook(book)}
                        disabled={isAdding}
                      >
                        {isAdding ? 'Adding...' : 'Add to Shelf'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!searchLoading && searchResults.length === 0 && searchQuery && (
            <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', width: '100%' }}>
              No books resolved for "{searchQuery}". Try another keyword or check system settings toggles.
            </div>
          )}
        </div>
      )}

      {/* View Ingestion Scanner Tab */}
      {isCollaborator && activeTab === 'scan' && (
        <div style={styles.tabContent} className="glass-panel">
          <h2 style={styles.tabTitle}>Barcode Bar Scanner</h2>
          <BarcodeScanner onScanSuccess={handleScanSuccess} />
          
          {scanMessage && (
            <div style={{
              ...styles.scanMessage,
              backgroundColor: scanMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: scanMessage.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)',
            }}>
              {scanMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
              <span>{scanMessage.text}</span>
            </div>
          )}
        </div>
      )}

      {/* View Manual Book Form Tab */}
      {isCollaborator && activeTab === 'manual' && (
        <form onSubmit={handleManualSubmit} style={styles.manualForm} className="glass-panel">
          <h2 style={styles.tabTitle}>Register Book Details</h2>
          
          {prefilledIsbn && (
            <div style={styles.prefilledAlert}>
              <AlertTriangle size={18} />
              <span>Prefilled lookup values loaded for ISBN: <strong>{prefilledIsbn}</strong></span>
            </div>
          )}

          <div style={styles.formRow}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Book Title *</label>
              <input 
                type="text" 
                className="form-input" 
                value={manualTitle} 
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="e.g. The Hobbit"
                required 
                disabled={actionLoading}
              />
            </div>
            
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Author Name</label>
              <input 
                type="text" 
                className="form-input" 
                value={manualAuthor} 
                onChange={(e) => setManualAuthor(e.target.value)}
                placeholder="e.g. J.R.R. Tolkien"
                disabled={actionLoading}
              />
            </div>
          </div>

          <div style={styles.formRow}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Publisher</label>
              <input 
                type="text" 
                className="form-input" 
                value={manualPublisher} 
                onChange={(e) => setManualPublisher(e.target.value)}
                placeholder="e.g. George Allen & Unwin"
                disabled={actionLoading}
              />
            </div>
            
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Publication Date</label>
              <input 
                type="text" 
                className="form-input" 
                value={manualPubDate} 
                onChange={(e) => setManualPubDate(e.target.value)}
                placeholder="e.g. September 1937"
                disabled={actionLoading}
              />
            </div>
          </div>

          <div style={styles.formRow}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Page Count</label>
              <input 
                type="number" 
                className="form-input" 
                value={manualPages} 
                onChange={(e) => setManualPages(e.target.value)}
                placeholder="e.g. 310"
                disabled={actionLoading}
              />
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Book Cover Image URL</label>
              <input 
                type="url" 
                className="form-input" 
                value={manualCover} 
                onChange={(e) => setManualCover(e.target.value)}
                placeholder="http://domain.com/image.jpg"
                disabled={actionLoading}
              />
            </div>
          </div>

          {/* 📍 Physical Location freeform parameter input (Req 4.2.3) */}
          <div className="form-group">
            <label className="form-label">Physical Location Description</label>
            <input 
              type="text" 
              className="form-input" 
              value={manualLocation} 
              onChange={(e) => setManualLocation(e.target.value)}
              placeholder="e.g. Oak Case B, Shelf 3 or Plastic tub in basement"
              disabled={actionLoading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Annotations / Personal Notes</label>
            <textarea 
              className="form-input" 
              style={{ minHeight: '80px', resize: 'none' }}
              value={manualNotes} 
              onChange={(e) => setManualNotes(e.target.value)}
              placeholder="Add personal thoughts, reading reviews, or loan details..."
              disabled={actionLoading}
            />
          </div>

          <div style={styles.modalActions}>
            <button type="button" className="btn btn-secondary" onClick={() => { setActiveTab('list'); setPrefilledIsbn(''); }} disabled={actionLoading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={actionLoading}>
              {actionLoading ? 'Saving...' : 'Register Book'}
            </button>
          </div>
        </form>
      )}

      {/* 📚 Books List Tab (Always visible, adjusts mutations based on accessRole) */}
      {activeTab === 'list' && (
        <div style={styles.booksSection}>
          {shelf.books.length > 0 && (
            <div style={styles.controlsRow}>
              <span style={styles.booksCount}>{shelf.books.length} {shelf.books.length === 1 ? 'Book' : 'Books'}</span>
              <div style={styles.toggleGroup} className="glass-panel">
                <button
                  style={{
                    ...styles.toggleBtn,
                    ...(viewMode === 'grid' ? styles.toggleBtnActive : {})
                  }}
                  onClick={() => {
                    setViewMode('grid');
                    localStorage.setItem('bookbinder_view_mode', 'grid');
                  }}
                  title="Grid View"
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  style={{
                    ...styles.toggleBtn,
                    ...(viewMode === 'list' ? styles.toggleBtnActive : {})
                  }}
                  onClick={() => {
                    setViewMode('list');
                    localStorage.setItem('bookbinder_view_mode', 'list');
                  }}
                  title="List View"
                >
                  <List size={16} />
                </button>
              </div>
            </div>
          )}

          {shelf.books.length === 0 ? (
            <div style={styles.emptyBooks} className="glass-panel">
              <Book size={48} style={{ color: 'var(--text-muted)' }} />
              <h3>Shelf is Empty</h3>
              <p>This library bookshelf currently has no cataloged entries.</p>
              {isCollaborator && (
                <button className="btn btn-primary" onClick={() => setActiveTab('scan')}>
                  <Camera size={18} />
                  <span>Start Scanning Ingests</span>
                </button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            <div style={styles.booksGrid}>
              {shelf.books.map((b) => (
                <div key={b.mapping_id} style={styles.bookCard} className="glass-panel">
                  {/* Book Cover Container */}
                  <div style={styles.coverWrapper}>
                    {b.cover_image_url ? (
                      <img 
                        src={b.cover_image_url} 
                        alt={b.title} 
                        style={styles.coverImg}
                        onError={handleImageError} 
                      />
                    ) : null}
                    
                    {/* Glassmorphic Fallback cover icon if image is missing/broken */}
                    <div style={{
                      ...styles.coverFallback,
                      display: b.cover_image_url ? 'none' : 'flex'
                    }}>
                      <Book size={32} />
                    </div>
                  </div>

                  {/* Book details context */}
                  <div style={styles.bookDetails}>
                    <div style={styles.bookTitleHeader}>
                      <h3 style={styles.bookTitle} title={b.title}>{b.title}</h3>
                      
                      {/* Read / Unread toggle indicator badge (Req 1.2 Read Status) */}
                      <button
                        style={{
                          ...styles.readStatusBadge,
                          ...(b.is_read ? styles.readBadgeActive : styles.readBadgeInactive),
                          cursor: isCollaborator ? 'pointer' : 'default',
                        }}
                        onClick={() => isCollaborator && handleToggleReadStatus(b)}
                        title={isCollaborator ? `Mark as ${b.is_read ? 'unread' : 'read'}` : `Book is ${b.is_read ? 'read' : 'unread'}`}
                        disabled={!isCollaborator}
                      >
                        {b.is_read ? <CheckCircle size={10} style={{ color: 'var(--success-color)' }} /> : <Bookmark size={10} />}
                        <span>{b.is_read ? 'Read' : 'Unread'}</span>
                      </button>
                    </div>
                    <span style={styles.bookAuthor}>{b.author}</span>
                    
                    <div style={styles.metaRow}>
                      {b.publisher && <span style={styles.metaPill} title={b.publisher}>{b.publisher}</span>}
                      {b.page_count && <span style={styles.metaPill}>{b.page_count} pages</span>}
                    </div>

                    {/* Mapped physical location pill (Req 4.2.3) */}
                    {b.physical_location && (
                      <div style={styles.locationBlock}>
                        <MapPin size={14} style={{ color: 'var(--accent-color)' }} />
                        <span style={styles.locationText} title={b.physical_location}>{b.physical_location}</span>
                      </div>
                    )}

                    {/* Mapped notes section */}
                    {b.notes && (
                      <div style={styles.notesBlock}>
                        <Notebook size={14} style={{ color: 'var(--text-muted)' }} />
                        <p style={styles.notesText}>{b.notes}</p>
                      </div>
                    )}

                    {/* 🔒 Hover mutations triggers (Hides edit/remove buttons if View-only) (Req 4.3.2) */}
                    {isCollaborator && (
                      <div style={styles.cardActions}>
                        <button 
                          style={styles.cardActionBtn} 
                          onClick={() => {
                            setEditingMapping(b);
                            setEditLocation(b.physical_location || '');
                            setEditNotes(b.notes || '');
                            setTargetBookshelfId('');
                          }}
                          title="Edit location & notes"
                        >
                          <Pencil size={16} />
                        </button>
                        <button 
                          style={{ ...styles.cardActionBtn, color: 'var(--danger-color)' }} 
                          onClick={() => handleDeleteMapping(b.mapping_id)}
                          title="Remove book from shelf"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.booksList}>
              {shelf.books.map((b) => (
                <div key={b.mapping_id} style={styles.listRow} className="glass-panel">
                  {/* Row cover thumbnail */}
                  <div style={styles.rowCoverWrapper}>
                    {b.cover_image_url ? (
                      <img 
                        src={b.cover_image_url} 
                        alt="" 
                        style={styles.rowCoverImg}
                        onError={handleImageError} 
                      />
                    ) : null}
                    
                    <div style={{
                      ...styles.rowCoverFallback,
                      display: b.cover_image_url ? 'none' : 'flex'
                    }}>
                      <Book size={18} />
                    </div>
                  </div>

                  {/* Row content details */}
                  <div style={styles.rowContent}>
                    <div style={styles.rowMainInfo}>
                      <div style={styles.rowTitleAuthorStack}>
                        <h3 style={styles.rowBookTitle} title={b.title}>{b.title}</h3>
                        <span style={styles.rowBookAuthor}>{b.author}</span>
                      </div>
                      
                      {/* Publisher / Date pills */}
                      <div style={styles.rowMetaRow}>
                        {b.publisher && <span style={styles.metaPill} title={b.publisher}>{b.publisher}</span>}
                        {b.page_count && <span style={styles.metaPill}>{b.page_count} p.</span>}
                      </div>
                    </div>

                    {/* Location and Notes previews */}
                    <div style={styles.rowAnnotations}>
                      {b.physical_location && (
                        <div style={styles.locationBlock}>
                          <MapPin size={12} style={{ color: 'var(--accent-color)' }} />
                          <span style={styles.locationText} title={b.physical_location}>{b.physical_location}</span>
                        </div>
                      )}
                      {b.notes && (
                        <div style={styles.rowNotesBlock} title={b.notes}>
                          <Notebook size={12} style={{ color: 'var(--text-muted)' }} />
                          <span style={styles.rowNotesText}>{b.notes}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Read/Unread Toggle Badge */}
                  <div style={styles.rowStatus}>
                    <button
                      style={{
                        ...styles.readStatusBadge,
                        ...(b.is_read ? styles.readBadgeActive : styles.readBadgeInactive),
                        cursor: isCollaborator ? 'pointer' : 'default',
                      }}
                      onClick={() => isCollaborator && handleToggleReadStatus(b)}
                      title={isCollaborator ? `Mark as ${b.is_read ? 'unread' : 'read'}` : `Book is ${b.is_read ? 'read' : 'unread'}`}
                      disabled={!isCollaborator}
                    >
                      {b.is_read ? <CheckCircle size={10} style={{ color: 'var(--success-color)' }} /> : <Bookmark size={10} />}
                      <span>{b.is_read ? 'Read' : 'Unread'}</span>
                    </button>
                  </div>

                  {/* Actions */}
                  {isCollaborator && (
                    <div style={styles.rowActions}>
                      <button 
                        style={styles.cardActionBtn} 
                        onClick={() => {
                          setEditingMapping(b);
                          setEditLocation(b.physical_location || '');
                          setEditNotes(b.notes || '');
                          setTargetBookshelfId('');
                        }}
                        title="Edit location & notes"
                      >
                        <Pencil size={16} />
                      </button>
                      <button 
                        style={{ ...styles.cardActionBtn, color: 'var(--danger-color)' }} 
                        onClick={() => handleDeleteMapping(b.mapping_id)}
                        title="Remove book from shelf"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 🛠️ Edit Annotations Modal */}
      {editingMapping && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} className="glass-panel">
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Update Book Mapping</h3>
              <button style={styles.closeModalBtn} onClick={() => setEditingMapping(null)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleUpdateAnnotations} style={styles.modalForm}>
              <div style={styles.bookSummaryRow}>
                <Book size={20} style={{ color: 'var(--accent-color)' }} />
                <span>Editing annotations for: <strong>{editingMapping.title}</strong></span>
              </div>

              {/* 📍 Physical Location input (Req 4.2.3) */}
              <div className="form-group">
                <label className="form-label">Physical Location Description</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  placeholder="e.g. Oak Case B, Shelf 3"
                  disabled={actionLoading}
                />
              </div>

              {/* 🔄 Cross-shelf reassignment (v1.5) */}
              <div className="form-group">
                <label className="form-label">Move to Bookshelf</label>
                <select 
                  className="form-input"
                  value={targetBookshelfId}
                  onChange={(e) => setTargetBookshelfId(e.target.value)}
                  disabled={actionLoading}
                >
                  <option value="">-- Keep on Current Shelf --</option>
                  {writeableShelves.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Annotations / Personal Notes</label>
                <textarea 
                  className="form-input"
                  style={{ minHeight: '100px', resize: 'none' }}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add loan details or reading reviews..."
                  disabled={actionLoading}
                />
              </div>

              <div style={styles.modalActions}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingMapping(null)} disabled={actionLoading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 👥 Owner-Only Sharing Modal Portal */}
      {isShareModalOpen && shelf.isOwner && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalCard, maxWidth: '600px' }} className="glass-panel">
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Bookshelf Share Console</h3>
              <button style={styles.closeModalBtn} onClick={() => setIsShareModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            {/* Invite Form */}
            <form onSubmit={handleInviteShare} style={styles.shareInviteForm}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <input 
                  type="email" 
                  className="form-input"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="recipient@email.com"
                  required
                  disabled={shareLoading}
                />
              </div>
              
              <div className="form-group" style={{ width: '140px', marginBottom: 0 }}>
                <select 
                  className="form-input" 
                  value={invitePerm} 
                  onChange={(e) => setInvitePerm(e.target.value)}
                  disabled={shareLoading}
                >
                  <option value="view">Viewer</option>
                  <option value="collaborator">Collaborator</option>
                </select>
              </div>

              <button type="submit" className="btn btn-primary" disabled={shareLoading} style={{ height: '45px' }}>
                Invite
              </button>
            </form>

            {/* Active Shares List */}
            <div style={styles.sharesListBlock}>
              <h4 style={styles.sharesSub}>Active Shared Access Tiers</h4>
              
              {shares.length === 0 ? (
                <p style={styles.noSharesText}>This library bookshelf has not been shared with any collaborators yet.</p>
              ) : (
                <div style={styles.sharesTableContainer}>
                  {shares.map((s) => (
                    <div key={s.id} style={styles.shareRow}>
                      <div style={styles.shareRowInfo}>
                        <span style={styles.shareEmail} title={s.email}>{s.email}</span>
                        <span style={{
                          ...styles.badge,
                          ...(s.permission === 'collaborator' ? styles.badgeCollab : styles.badgeViewer),
                          fontSize: '0.65rem'
                        }}>
                          {s.permission}
                        </span>
                      </div>
                      
                      <button 
                        style={styles.revokeShareBtn} 
                        onClick={() => handleRemoveShare(s.id)}
                        title="Revoke access"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...styles.modalActions, marginTop: '12px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsShareModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  detailsContainer: {
    paddingBottom: '60px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    width: '100%',
  },
  detailsHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '0.9rem',
    width: 'fit-content',
    padding: '6px 0',
  },
  shelfInfoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: '16px',
  },
  shelfTitleBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: '2.25rem',
    fontWeight: 800,
  },
  desc: {
    color: 'var(--text-secondary)',
    fontSize: '0.95rem',
    marginTop: '6px',
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
  },
  deleteShelfBtn: {
    padding: '12px',
  },
  tabBar: {
    display: 'flex',
    padding: '6px',
    borderRadius: 'var(--radius-sm)',
    gap: '6px',
  },
  tabBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '10px 16px',
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    borderRadius: 'var(--radius-sm)',
    fontWeight: '600',
    fontSize: '0.9rem',
    transition: 'var(--transition-smooth)',
  },
  tabBtnActive: {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--accent-color)',
    boxShadow: 'var(--shadow-sm)',
  },
  tabContent: {
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  tabTitle: {
    fontSize: '1.25rem',
    fontWeight: '750',
    marginBottom: '8px',
    width: '100%',
    textAlign: 'left',
  },
  scanMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 20px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.9rem',
    fontWeight: '600',
    width: '100%',
    maxWidth: '500px',
    marginTop: '8px',
  },
  prefilledAlert: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    color: '#d97706',
    fontSize: '0.85rem',
    marginBottom: '20px',
  },
  manualForm: {
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  formRow: {
    display: 'flex',
    gap: '20px',
    width: '100%',
    flexWrap: 'wrap',
  },
  booksSection: {
    width: '100%',
  },
  emptyBooks: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '60px 20px',
    gap: '16px',
    color: 'var(--text-secondary)',
  },
  booksGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '20px',
  },
  bookCard: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    border: '1px solid var(--border-glass)',
    backgroundColor: 'var(--bg-glass)',
    position: 'relative',
    transition: 'var(--transition-smooth)',
  },
  coverWrapper: {
    width: '100%',
    aspectRatio: '0.7',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderBottom: '1px solid var(--border-glass)',
  },
  coverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  coverFallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    background: 'linear-gradient(135deg, var(--bg-primary) 0%, var(--border-glass) 100%)',
  },
  bookDetails: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: 1,
  },
  bookTitle: {
    fontSize: '1rem',
    fontWeight: '750',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: '2',
    WebkitBoxOrient: 'vertical',
    lineHeight: '1.4',
  },
  bookAuthor: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    fontWeight: '600',
  },
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  metaPill: {
    fontSize: '0.7rem',
    fontWeight: '700',
    backgroundColor: 'var(--bg-primary)',
    padding: '2px 6px',
    borderRadius: '4px',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-glass)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100px',
  },
  locationBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--accent-light)',
    color: 'var(--accent-color)',
    fontSize: '0.75rem',
    fontWeight: '700',
    width: 'fit-content',
    marginTop: '4px',
  },
  locationText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '180px',
  },
  notesBlock: {
    display: 'flex',
    gap: '6px',
    padding: '10px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-glass)',
    marginTop: '4px',
  },
  notesText: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.4',
    fontStyle: 'italic',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: '3',
    WebkitBoxOrient: 'vertical',
  },
  cardActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: 'auto',
    paddingTop: '8px',
    borderTop: '1px solid var(--border-glass)',
  },
  cardActionBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    transition: 'var(--transition-smooth)',
  },
  cardActionBtnHover: {
    backgroundColor: 'var(--border-glass)',
  },
  badge: {
    fontSize: '0.7rem',
    fontWeight: '800',
    textTransform: 'uppercase',
    padding: '4px 8px',
    borderRadius: '4px',
    letterSpacing: '0.05em',
  },
  badgeOwner: {
    backgroundColor: 'var(--accent-light)',
    color: 'var(--accent-color)',
  },
  badgeCollab: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: '#10b981',
  },
  badgeViewer: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    color: '#f59e0b',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px',
    textAlign: 'center',
    gap: '16px',
    maxWidth: '500px',
    margin: '40px auto',
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
    maxWidth: '500px',
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    boxShadow: 'var(--shadow-lg)',
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
  modalForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  bookSummaryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    fontSize: '0.85rem',
    border: '1px solid var(--border-glass)',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '12px',
  },
  shareInviteForm: {
    display: 'flex',
    gap: '12px',
    width: '100%',
    alignItems: 'center',
  },
  sharesListBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    borderTop: '1px solid var(--border-glass)',
    paddingTop: '20px',
    marginTop: '8px',
  },
  sharesSub: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  noSharesText: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  sharesTableContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '160px',
    overflowY: 'auto',
    paddingRight: '6px',
  },
  shareRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-glass)',
  },
  shareRowInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    overflow: 'hidden',
  },
  shareEmail: {
    fontSize: '0.85rem',
    fontWeight: '600',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    maxWidth: '220px',
  },
  revokeShareBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--danger-color)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
  },
  bookTitleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '8px',
    width: '100%',
  },
  readStatusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '0.65rem',
    fontWeight: '750',
    border: 'none',
    transition: 'var(--transition-smooth)',
    whiteSpace: 'nowrap',
  },
  readBadgeActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: 'var(--success-color)',
    border: '1px solid rgba(16, 185, 129, 0.2)',
  },
  readBadgeInactive: {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-glass)',
  },
  searchForm: {
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    width: '100%',
  },
  searchBarRow: {
    display: 'flex',
    gap: '12px',
    width: '100%',
  },
  searchCardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    marginTop: '20px',
  },
  searchCard: {
    display: 'flex',
    gap: '16px',
    padding: '16px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-glass)',
    backgroundColor: 'var(--bg-secondary)',
    alignItems: 'center',
    width: '100%',
  },
  searchCoverImg: {
    width: '60px',
    height: '84px',
    objectFit: 'cover',
    borderRadius: 'var(--radius-xs)',
    boxShadow: 'var(--shadow-sm)',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  searchCoverFallback: {
    width: '60px',
    height: '84px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-xs)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-glass)',
    color: 'var(--text-muted)',
  },
  searchInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
    overflow: 'hidden',
    textAlign: 'left',
  },
  searchTitle: {
    fontSize: '0.95rem',
    fontWeight: '750',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  searchAuthor: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    fontWeight: '600',
  },
  searchMeta: {
    display: 'flex',
    gap: '8px',
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    flexWrap: 'wrap',
  },
  sourceBadge: {
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '0.65rem',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
    width: 'fit-content',
    marginTop: '2px',
  },
  sourceLocal: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: 'var(--success-color)',
    border: '1px solid rgba(16, 185, 129, 0.2)',
  },
  sourceGoogle: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    color: 'var(--accent-color)',
    border: '1px solid rgba(99, 102, 241, 0.2)',
  },
  sourceOpenLibrary: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger-color)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
  },
  skeletonList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    marginTop: '20px',
  },
  skeletonItem: {
    height: '116px',
    width: '100%',
    borderRadius: 'var(--radius-sm)',
  },
  controlsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    width: '100%',
  },
  booksCount: {
    fontSize: '0.9rem',
    fontWeight: '700',
    color: 'var(--text-secondary)',
  },
  toggleGroup: {
    display: 'flex',
    padding: '3px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-glass)',
    backgroundColor: 'var(--bg-glass)',
    gap: '2px',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '6px 10px',
    borderRadius: 'var(--radius-xs)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition-smooth)',
  },
  toggleBtnActive: {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--accent-color)',
    boxShadow: 'var(--shadow-sm)',
  },
  booksList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
  },
  listRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 'var(--radius-md)',
    padding: '12px 16px',
    border: '1px solid var(--border-glass)',
    backgroundColor: 'var(--bg-glass)',
    gap: '16px',
    transition: 'var(--transition-smooth)',
  },
  rowCoverWrapper: {
    width: '35px',
    height: '50px',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: '4px',
    border: '1px solid var(--border-glass)',
    flexShrink: 0,
  },
  rowCoverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  rowCoverFallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    background: 'linear-gradient(135deg, var(--bg-primary) 0%, var(--border-glass) 100%)',
  },
  rowContent: {
    display: 'flex',
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    minWidth: 0,
    flexWrap: 'wrap',
  },
  rowMainInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: '1 1 200px',
    minWidth: 0,
  },
  rowTitleAuthorStack: {
    display: 'flex',
    flexDirection: 'column',
  },
  rowBookTitle: {
    fontSize: '0.95rem',
    fontWeight: '750',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowBookAuthor: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    fontWeight: '600',
  },
  rowMetaRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  rowAnnotations: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: '1 1 250px',
    minWidth: 0,
  },
  rowNotesBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-glass)',
    width: 'fit-content',
    maxWidth: '100%',
  },
  rowNotesText: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowStatus: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexShrink: 0,
  },
};
