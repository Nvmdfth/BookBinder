import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BarcodeScanner from '../components/BarcodeScanner';
import BookVolume from '../components/BookVolume';
import Modal from '../components/Modal';
import { readSetting, writeSetting } from '../utils/storage';
import { filterBooks, sortBooks, locationsOf } from '../utils/shelf';
import {
  Book, MapPin, Notebook, Plus, Pencil, Trash2, X, Share2,
  AlertTriangle, ArrowLeft, Camera, CheckCircle,
  Search, Bookmark, Check, LayoutGrid, List, ArrowUpDown, SearchX, Package,
} from 'lucide-react';

const VIEW_MODE_KEY = 'bookbinder_view_mode';

/** Sort orders offered above a shelf. */
const SORTS = [
  { value: 'recent', label: 'Recently added' },
  { value: 'title', label: 'Title A→Z' },
  { value: 'author', label: 'Author A→Z' },
  { value: 'location', label: 'Physical location' },
];

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
  const [viewMode, setViewMode] = useState(() => readSetting(VIEW_MODE_KEY, 'grid'));
  const [writeableShelves, setWriteableShelves] = useState([]);
  const [targetBookshelfId, setTargetBookshelfId] = useState('');
  const [scanMessage, setScanMessage] = useState(null);
  const [bookSearchQuery, setBookSearchQuery] = useState('');

  // Shelf criteria. Read state and physical location are the two axes anyone
  // actually browses a home library along, so both get first-class controls
  // rather than being buried in the free-text filter.
  const [readFilter, setReadFilter] = useState('all'); // 'all' | 'read' | 'unread'
  const [sortMode, setSortMode] = useState('recent');
  const [locationFilter, setLocationFilter] = useState('');

  // The catalog card for one volume, opened from the cover grid
  const [viewingBook, setViewingBook] = useState(null);

  // Volumes confirmed during the current scanning run, not yet filed
  const [scanTray, setScanTray] = useState([]);
  const [filingTray, setFilingTray] = useState(false);
  
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
            mapping_created_at: data.mapping.created_at,
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

    // React Router reuses this component across :id changes, so anything scoped
    // to one shelf has to be cleared by hand. A tray left over from shelf A
    // would otherwise offer to file A's volumes into B.
    setScanTray([]);
    setViewingBook(null);
    setScanMessage(null);
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
        return 'fallback';
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
              // Carried through so the "recently added" sort can order this row
              // against the ones that arrived with the shelf payload
              mapping_created_at: data.mapping.created_at,
            },
            ...prev.books,
          ],
        }));
        return 'filed';
      }
    } catch (err) {
      setScanMessage({ type: 'error', text: err.message });
      return 'error';
    }
  };

  /**
   * A volume confirmed at the camera. Nothing is written yet — it waits in the
   * session tray until the whole run is filed, so working along a shelf is one
   * continuous loop rather than a round trip per book.
   */
  const handleScanConfirm = (book) => {
    setScanMessage(null);

    if (book.isbn && shelf?.books?.some((b) => b.isbn === book.isbn)) {
      setScanMessage({ type: 'error', text: `"${book.title}" is already on this shelf.` });
      return;
    }

    setScanTray((prev) => {
      // Only a real ISBN identifies a duplicate. Keying on a missing one would
      // silently collapse two different lookups into a single tray row.
      if (book.isbn && prev.some((t) => t.isbn === book.isbn)) return prev;
      return [...prev, { ...book, trayId: `${book.isbn || 'no-isbn'}-${Date.now()}` }];
    });
  };

  /** File the whole run. Sequential so a mid-run failure stops cleanly. */
  const handleFileTray = async () => {
    setFilingTray(true);
    try {
      const filed = [];
      for (const book of scanTray) {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await handleScanSuccess(book.isbn);
        if (outcome !== 'filed') {
          // A lookup that fell back to the manual form, or an outright failure,
          // takes over the screen. Keep the rest of the run in the tray.
          setScanTray((prev) => prev.filter((t) => !filed.includes(t.trayId)));
          return;
        }
        filed.push(book.trayId);
      }
      setScanTray([]);
      setScanMessage({
        type: 'success',
        text: `Filed ${filed.length} ${filed.length === 1 ? 'volume' : 'volumes'} into ${shelf.name}.`,
      });
      setActiveTab('list');
    } finally {
      setFilingTray(false);
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
            mapping_created_at: data.mapping.created_at,
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

  // Cover-image failures are now handled inside BookVolume, which falls back to
  // a rendered binding rather than swapping in a sibling placeholder element.

  /**
   * The distinct physical locations on this shelf, offered as filter chips.
   *
   * A home library's real subject headings are where things physically live —
   * "Oak Case, Row 2" is the query someone standing in the room actually has.
   */
  const locations = useMemo(() => locationsOf(shelf?.books), [shelf]);

  const filteredBooks = useMemo(
    () =>
      sortBooks(
        filterBooks(shelf?.books, {
          query: bookSearchQuery,
          readFilter,
          locationFilter,
        }),
        sortMode
      ),
    [shelf, bookSearchQuery, readFilter, locationFilter, sortMode]
  );

  /** Grid or list, remembered across shelves and sessions. */
  const chooseViewMode = (mode) => {
    setViewMode(mode);
    writeSetting(VIEW_MODE_KEY, mode);
  };

  const criteriaActive =
    bookSearchQuery.trim() !== '' || readFilter !== 'all' || locationFilter !== '';

  const clearCriteria = () => {
    setBookSearchQuery('');
    setReadFilter('all');
    setLocationFilter('');
  };

  if (loading) {
    return (
      <div className="skeleton" style={{ height: '300px', width: '100%', borderRadius: 'var(--radius-md)' }}></div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorContainer} className="card error-shake">
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
        <div style={styles.tabBar} className="card">
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
        <div style={styles.searchForm} className="card">
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
            <div style={{ ...styles.scanMessage, backgroundColor: 'color-mix(in srgb, var(--danger-color) 11%, transparent)', color: 'var(--danger-color)', alignSelf: 'stretch', maxWidth: 'none' }}>
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
                    <BookVolume
                      title={book.title}
                      author={book.author}
                      coverUrl={book.cover_image_url}
                      seed={book.isbn || bookKey}
                      size="sm"
                      style={{ width: '52px', flex: 'none' }}
                    />

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
        <div style={styles.tabContent} className="card">
          <h2 style={styles.tabTitle}>Barcode Bar Scanner</h2>
          <BarcodeScanner
            onScanSuccess={handleScanSuccess}
            onConfirm={handleScanConfirm}
          />

          {scanMessage && (
            <div style={{
              ...styles.scanMessage,
              backgroundColor: scanMessage.type === 'success' ? 'color-mix(in srgb, var(--success-color) 11%, transparent)' : 'color-mix(in srgb, var(--danger-color) 11%, transparent)',
              color: scanMessage.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)',
            }}>
              {scanMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
              <span>{scanMessage.text}</span>
            </div>
          )}

          {/* Session tray — the run so far, filed in one go */}
          <div className="card" style={styles.tray}>
            <div style={styles.trayHead}>
              <Package size={19} style={{ color: 'var(--accent-color)' }} />
              <span className="eyebrow">This Session</span>
              <div style={{ flex: 1 }} />
              <span className="typed" style={styles.trayCount}>
                {scanTray.length} {scanTray.length === 1 ? 'VOLUME' : 'VOLUMES'}
              </span>
            </div>

            {scanTray.length === 0 ? (
              <p style={styles.trayEmpty}>
                Keep the camera on and work along the shelf — each confirmed volume drops in here.
                <br />
                File the whole run in one go when you&apos;re done.
              </p>
            ) : (
              <>
                {scanTray.map((t) => (
                  <div key={t.trayId} style={styles.trayRow} className="tray-row-in">
                    <BookVolume
                      title={t.title}
                      author={t.author}
                      coverUrl={t.cover_image_url}
                      seed={t.isbn}
                      size="sm"
                      style={{ width: '26px', flex: 'none' }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={styles.trayTitle}>{t.title}</div>
                      <div style={styles.trayAuthor}>{t.author || 'Unknown author'}</div>
                    </div>
                    <button
                      style={styles.trayRemove}
                      onClick={() => setScanTray((prev) => prev.filter((x) => x.trayId !== t.trayId))}
                      title="Take back out of the tray"
                      disabled={filingTray}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}

                <div style={styles.trayActions}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setScanTray([])}
                    disabled={filingTray}
                  >
                    <span>Undo all</span>
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={handleFileTray}
                    disabled={filingTray}
                  >
                    <Plus size={18} />
                    <span>
                      {filingTray
                        ? 'Filing…'
                        : `File ${scanTray.length} into ${shelf.name}`}
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* View Manual Book Form Tab */}
      {isCollaborator && activeTab === 'manual' && (
        <form onSubmit={handleManualSubmit} style={styles.manualForm} className="card">
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
            <>
              <div className="filter-bar">
                <div className="filter-row">
                  <div className="field field-grow">
                    <Search size={19} style={{ flexShrink: 0 }} />
                    <input
                      type="text"
                      placeholder="Filter by title, author, location…"
                      value={bookSearchQuery}
                      onChange={(e) => setBookSearchQuery(e.target.value)}
                      aria-label="Filter this shelf"
                    />
                    {bookSearchQuery && (
                      <button
                        style={styles.clearSearchBtn}
                        onClick={() => setBookSearchQuery('')}
                        title="Clear filter"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <div className="seg" role="group" aria-label="Read status">
                    {['all', 'read', 'unread'].map((mode) => (
                      <button
                        key={mode}
                        className={`seg-btn${readFilter === mode ? ' seg-btn-active' : ''}`}
                        onClick={() => setReadFilter(mode)}
                        aria-pressed={readFilter === mode}
                      >
                        {mode === 'all' ? 'All' : mode === 'read' ? 'Read' : 'Unread'}
                      </button>
                    ))}
                  </div>

                  <div className="field">
                    <ArrowUpDown size={18} style={{ flexShrink: 0 }} />
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value)}
                      aria-label="Sort order"
                    >
                      {SORTS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="seg" style={{ marginLeft: 'auto' }} role="group" aria-label="View mode">
                    <button
                      className={`seg-btn${viewMode === 'grid' ? ' seg-btn-active' : ''}`}
                      onClick={() => chooseViewMode('grid')}
                      title="Grid View"
                      aria-pressed={viewMode === 'grid'}
                    >
                      <LayoutGrid size={16} />
                    </button>
                    <button
                      className={`seg-btn${viewMode === 'list' ? ' seg-btn-active' : ''}`}
                      onClick={() => chooseViewMode('list')}
                      title="List View"
                      aria-pressed={viewMode === 'list'}
                    >
                      <List size={16} />
                    </button>
                  </div>
                </div>

                {/* Physical locations, as catalog subject chips */}
                {locations.length > 0 && (
                  <div className="chip-row">
                    <button
                      className={`chip${locationFilter === '' ? ' chip-active' : ''}`}
                      onClick={() => setLocationFilter('')}
                    >
                      All locations
                    </button>
                    {locations.map((loc) => (
                      <button
                        key={loc}
                        className={`chip${locationFilter === loc ? ' chip-active' : ''}`}
                        onClick={() => setLocationFilter(loc)}
                      >
                        {loc}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="count-line">
                <span>
                  Showing {filteredBooks.length} of {shelf.books.length}{' '}
                  {shelf.books.length === 1 ? 'volume' : 'volumes'}
                </span>
              </div>
            </>
          )}

          {shelf.books.length === 0 ? (
            <div style={styles.emptyBooks} className="card">
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
          ) : filteredBooks.length === 0 ? (
            <div style={styles.emptyBooks} className="card">
              <SearchX size={40} style={{ color: 'var(--text-muted)' }} />
              <h3>Nothing filed under that</h3>
              <p>No volumes on this shelf match the current criteria. Try clearing them.</p>
              <button className="btn btn-secondary" onClick={clearCriteria}>
                <span>Clear filters</span>
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            /* The catalog grid. Every volume is bound rather than reduced to a
               placeholder glyph, so a shelf with no cover art still reads as
               books — see components/BookVolume.jsx. */
            <div className="cover-grid">
              {filteredBooks.map((b) => (
                /* The cell is a wrapper, not a button: the read toggle sits on
                   top of the cover and a button cannot legally nest inside
                   another one. Marking a book read is the most common action on
                   a shelf and should not cost open/toggle/close. */
                <div key={b.mapping_id} className="cover-cell card-in">
                  <button
                    className="cover-open"
                    onClick={() => setViewingBook(b.mapping_id)}
                    title={b.title}
                  >
                    <BookVolume
                      title={b.title}
                      author={b.author}
                      coverUrl={b.cover_image_url}
                      seed={b.isbn || b.mapping_id}
                      /* When the toggle is rendered it *is* the indicator;
                         a viewer with no toggle still needs the static mark */
                      isRead={b.is_read && !isCollaborator}
                    />
                    <span className="cover-caption">
                      <span className="cover-caption-title">{b.title}</span>
                      <span className="cover-caption-sub">{b.author || 'Unknown author'}</span>
                      {b.physical_location && (
                        <span className="cover-caption-loc">{b.physical_location}</span>
                      )}
                    </span>
                  </button>

                  {isCollaborator && (
                    <button
                      className={`cover-read${b.is_read ? ' cover-read-on' : ''}`}
                      onClick={() => handleToggleReadStatus(b)}
                      aria-pressed={b.is_read}
                      aria-label={`${b.title} — mark as ${b.is_read ? 'unread' : 'read'}`}
                      title={`Mark as ${b.is_read ? 'unread' : 'read'}`}
                    >
                      {b.is_read ? <CheckCircle size={16} /> : <Bookmark size={16} />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.booksList}>
              {filteredBooks.map((b) => (
                <div key={b.mapping_id} style={styles.listRow} className="card">
                  {/* Row cover thumbnail */}
                  <BookVolume
                    title={b.title}
                    author={b.author}
                    coverUrl={b.cover_image_url}
                    seed={b.isbn || b.mapping_id}
                    size="sm"
                    style={{ width: '42px', flex: 'none' }}
                  />

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

      {/* 📇 Catalog card for a single volume */}
      {viewingBook !== null && (() => {
        // Resolved from the live shelf rather than held in state, so a read
        // toggle or an annotation save is reflected here without a second copy
        const b = shelf.books.find((x) => x.mapping_id === viewingBook);
        if (!b) return null;

        const meta = [
          ['Author', b.author],
          ['Publisher', b.publisher],
          ['Published', b.publication_date],
          ['Extent', b.page_count ? `${b.page_count} pages` : null],
          ['ISBN', b.isbn],
          ['Shelf', shelf.name],
        ].filter(([, v]) => v);

        return (
          <Modal
            onClose={() => setViewingBook(null)}
            labelledBy="catalog-card-title"
            width="840px"
            style={{ padding: '26px 28px 30px' }}
          >
              <div style={styles.bookSheetGrid}>
                <div>
                  <BookVolume
                    title={b.title}
                    author={b.author}
                    coverUrl={b.cover_image_url}
                    seed={b.isbn || b.mapping_id}
                    size="lg"
                  />
                  {!b.cover_image_url && (
                    <p className="typed" style={styles.bindingNote}>
                      No cover art on file · binding rendered
                    </p>
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <span className="eyebrow">Catalog Card</span>
                  <h1 id="catalog-card-title" style={styles.bookSheetTitle}>{b.title}</h1>
                  <p style={styles.bookSheetAuthor}>{b.author || 'Unknown author'}</p>

                  <div style={styles.bookSheetStatus}>
                    <button
                      className="stamp stamp-tilt"
                      style={{
                        ...styles.readToggle,
                        color: b.is_read ? 'var(--success-color)' : 'var(--text-muted)',
                        cursor: isCollaborator ? 'pointer' : 'default',
                      }}
                      onClick={() => isCollaborator && handleToggleReadStatus(b)}
                      disabled={!isCollaborator}
                      title={isCollaborator ? `Mark as ${b.is_read ? 'unread' : 'read'}` : undefined}
                    >
                      {b.is_read ? <CheckCircle size={15} /> : <Bookmark size={15} />}
                      {b.is_read ? 'Read' : 'Unread'}
                    </button>
                  </div>

                  <hr className="rule-double" style={{ margin: '20px 0 0' }} />
                  {meta.map(([k, v]) => (
                    <div key={k} style={styles.metaRowLine}>
                      <span style={styles.metaKey}>{k}</span>
                      <span className="typed" style={styles.metaValue}>{v}</span>
                    </div>
                  ))}

                  {/* Physical location (Req 4.2.3) — the whole point of the app */}
                  <div className="card card-spine" style={styles.locationCard}>
                    <div style={styles.locationCardHead}>
                      <MapPin size={18} style={{ color: 'var(--accent-color)' }} />
                      <span className="eyebrow" style={{ color: 'var(--accent-color)' }}>
                        Physical Location
                      </span>
                    </div>
                    <p style={styles.locationCardValue}>
                      {b.physical_location || 'Not recorded yet.'}
                    </p>
                  </div>

                  <div className="card" style={styles.notesCard}>
                    <div style={styles.locationCardHead}>
                      <Notebook size={18} style={{ color: 'var(--text-muted)' }} />
                      <span className="eyebrow">Annotations</span>
                    </div>
                    <p style={styles.notesCardValue}>
                      {b.notes || 'No annotations filed against this copy.'}
                    </p>
                  </div>

                  {isCollaborator && (
                    <div style={styles.bookSheetActions}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setEditingMapping(b);
                          setEditLocation(b.physical_location || '');
                          setEditNotes(b.notes || '');
                          setTargetBookshelfId('');
                          setViewingBook(null);
                        }}
                      >
                        <Pencil size={17} />
                        <span>Edit &amp; move</span>
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ color: 'var(--danger-color)' }}
                        onClick={() => {
                          setViewingBook(null);
                          handleDeleteMapping(b.mapping_id);
                        }}
                      >
                        <Trash2 size={17} />
                        <span>Remove</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
          </Modal>
        );
      })()}

      {/* 🛠️ Edit Annotations Modal */}
      {editingMapping && (
        <Modal
          onClose={() => setEditingMapping(null)}
          eyebrow="Shelf Mapping"
          title="Update Book Mapping"
          busy={actionLoading}
        >
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
        </Modal>
      )}

      {/* 👥 Owner-Only Sharing Modal Portal */}
      {isShareModalOpen && shelf.isOwner && (
        <Modal
          onClose={() => setIsShareModalOpen(false)}
          eyebrow="Access Control"
          title="Bookshelf Share Console"
          width="600px"
          busy={shareLoading}
        >
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
        </Modal>
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
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--step-4)',
    fontWeight: 600,
    letterSpacing: '-0.015em',
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
    backgroundColor: 'color-mix(in srgb, var(--warning-color) 13%, transparent)',
    color: 'var(--warning-color)',
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
  metaPill: {
    fontSize: '0.7rem',
    fontWeight: '700',
    backgroundColor: 'var(--bg-primary)',
    padding: '2px 6px',
    borderRadius: '4px',
    color: 'var(--text-muted)',
    border: '1px solid var(--rule)',
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
    backgroundColor: 'color-mix(in srgb, var(--success-color) 11%, transparent)',
    color: 'var(--success-color)',
  },
  badgeViewer: {
    backgroundColor: 'color-mix(in srgb, var(--warning-color) 13%, transparent)',
    color: 'var(--warning-color)',
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

  /* --- Bulk scanning session tray --- */
  tray: {
    width: '100%',
    maxWidth: '500px',
    alignSelf: 'center',
    marginTop: '18px',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-md)',
  },
  trayHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    padding: '13px 16px',
    borderBottom: '1px solid var(--rule)',
  },
  trayCount: {
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
  },
  trayEmpty: {
    padding: '24px 18px',
    textAlign: 'center',
    fontSize: '0.82rem',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
  },
  trayRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    borderBottom: '1px dotted var(--rule)',
  },
  trayTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '0.88rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  trayAuthor: {
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  trayRemove: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '8px',
    flex: 'none',
  },
  trayActions: {
    display: 'flex',
    gap: '10px',
    padding: '13px 16px',
  },

  /* --- The catalog card for one volume --- */
  bookSheetGrid: {
    display: 'grid',
    // Collapses to a single column on a phone without a second breakpoint
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: '28px',
    alignItems: 'start',
  },
  bindingNote: {
    marginTop: '10px',
    fontSize: '0.62rem',
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  bookSheetTitle: {
    margin: '6px 0 0',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--step-3)',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    lineHeight: 1.15,
  },
  bookSheetAuthor: {
    margin: '7px 0 0',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: '1.05rem',
    color: 'var(--text-secondary)',
  },
  bookSheetStatus: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '15px',
  },
  readToggle: {
    background: 'transparent',
    minHeight: '38px',
    padding: '0 14px',
    fontSize: '0.68rem',
  },
  metaRowLine: {
    display: 'flex',
    gap: '14px',
    padding: '11px 2px',
    borderBottom: '1px dotted var(--rule)',
  },
  metaKey: {
    width: '108px',
    flex: 'none',
    fontSize: '0.63rem',
    fontWeight: 700,
    letterSpacing: '0.13em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    paddingTop: '2px',
  },
  metaValue: {
    fontSize: '0.82rem',
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
  },
  locationCard: {
    marginTop: '22px',
    padding: '15px 17px 15px 20px',
    background: 'var(--accent-light)',
  },
  locationCardHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  locationCardValue: {
    margin: '7px 0 0',
    fontFamily: 'var(--font-display)',
    fontSize: '1.05rem',
    color: 'var(--text-primary)',
  },
  notesCard: {
    marginTop: '14px',
    padding: '15px 17px',
  },
  notesCardValue: {
    margin: '8px 0 0',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: '0.94rem',
    lineHeight: 1.6,
    color: 'var(--text-secondary)',
  },
  bookSheetActions: {
    display: 'flex',
    gap: '9px',
    marginTop: '18px',
    flexWrap: 'wrap',
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
    border: '1px solid var(--rule)',
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
    borderTop: '1px solid var(--rule)',
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
    border: '1px solid var(--rule)',
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
    backgroundColor: 'color-mix(in srgb, var(--success-color) 11%, transparent)',
    color: 'var(--success-color)',
    border: '1px solid color-mix(in srgb, var(--success-color) 22%, transparent)',
  },
  readBadgeInactive: {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-muted)',
    border: '1px solid var(--rule)',
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
    border: '1px solid var(--rule)',
    backgroundColor: 'var(--bg-secondary)',
    alignItems: 'center',
    width: '100%',
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
    backgroundColor: 'color-mix(in srgb, var(--success-color) 11%, transparent)',
    color: 'var(--success-color)',
    border: '1px solid color-mix(in srgb, var(--success-color) 22%, transparent)',
  },
  sourceGoogle: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    color: 'var(--accent-color)',
    border: '1px solid rgba(99, 102, 241, 0.2)',
  },
  sourceOpenLibrary: {
    backgroundColor: 'color-mix(in srgb, var(--danger-color) 11%, transparent)',
    color: 'var(--danger-color)',
    border: '1px solid color-mix(in srgb, var(--danger-color) 22%, transparent)',
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
    border: '1px solid var(--rule)',
    backgroundColor: 'var(--surface-raised)',
    gap: '16px',
    transition: 'var(--transition-smooth)',
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
    border: '1px solid var(--rule)',
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
  clearSearchBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    transition: 'var(--transition-smooth)',
  },
};
