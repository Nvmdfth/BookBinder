# Global Scan Button — Design

**Date:** 2026-08-11
**Branch:** `feat/global-scan-button`

## Problem

Scanning today only exists *inside* a bookshelf: you open a shelf, switch to its Scan
tab, and every volume you capture is filed into that one shelf. There is no way to
scan a book without having first decided where it goes, and no way to ask the
question that actually comes up in a bookshop or at a friend's house — *do I already
own this?*

## What we're building

A scan entry point in the app chrome that opens the camera in a modal, independent of
any shelf. On each capture it answers "is this already in my library?", then lets you
choose a destination shelf. Captures accumulate in a session tray and are written in
one go.

## Behaviour

### Entry point

- **Desktop:** a `Scan` item in the sidebar nav, alongside Catalog / Profile. It is a
  `<button>`, not a `<Link>` — it opens a modal rather than navigating.
- **Mobile (≤860px):** a floating circular action button sitting above the bottom
  tray. The tray keeps its existing 2–3 items untouched.

The mobile breakpoint is 860px, matching the existing `.app-sidebar { display: none }`
rule in `index.css`. The FAB must clear `.app-bottom-tray` (62px tall, `z-index: 90`,
with `padding-bottom: env(safe-area-inset-bottom)`) and sit below the modal overlay
(`z-index: 200`).

### On a successful capture

The lookup returns the book plus a `holdings` array — every shelf visible to this user
that already carries it.

**Holdings non-empty →** show where it lives: cover, title, author, and each holding
with its shelf name and physical location. Wording varies by shelf kind:

| Holding | Wording |
|---|---|
| Shelf you own | "Already in your library" |
| Shelf shared with you (view or collaborator) | "Already in your library — on a shelf shared with you" |
| Shelf with `is_wishlist` | "On your wishlist" |

Actions: **Scan Again**, or **Add to another shelf** → shelf picker.

**Holdings empty →** go straight to the shelf picker.

### Shelf picker

Lists shelves the user can write to — `role` of `owner` or `collaborator`. View-only
shelves are excluded. This is a UI courtesy only: `verifyBookshelfAccess` +
`requireCollaborator` remain the real boundary server-side.

Shelves the book already sits on are shown but disabled, so you cannot create a
duplicate mapping the backend would reject with a 409 anyway.

Choosing a shelf adds the book to the tray tagged with that shelf, and returns to the
camera.

### Unresolvable barcode

When no provider can identify the barcode (unknown ISBN, or a UPC with no learned
alias), a compact manual-entry form appears **inside the modal**: title (required),
author, and shelf. Submitting adds a `manual` row to the tray. The run is never
broken by a navigation.

The scanned barcode is carried on the row and sent as `scannedBarcode` at filing time,
so `learnBarcodeAlias` records it and the next scan of that cover resolves locally.

Known wrinkle, accepted for v1: an unresolvable *ISBN* tears the camera down before
handing off (`BarcodeScanner.jsx:141` calls `stopScanner()` first), whereas an
unresolvable *UPC* leaves it live. So the ISBN case costs one extra tap to restart the
camera after submitting the form. Not worth widening the scanner's contract for.

### Tray and filing

Rows accumulate with a per-row destination shelf. Nothing is written until **File all**.
Filing is sequential so a mid-run failure stops cleanly; rows that failed stay in the
tray with their error, rows that succeeded are removed.

Deduplication keys on `book.id`, not `book.isbn` — manually created books get a
synthetic `MANUAL-${Date.now()}` ISBN (`bookRouter.js:490`), so two manual entries of
the same title share a catalog row but not an ISBN.

## Architecture

### Frontend

**New: `frontend/src/components/ScanModal.jsx`**

Composes the existing `Modal` and `BarcodeScanner`. Owns a step machine:

```
scanning ──capture──> holdings ──"add elsewhere"──> picker ──> (tray) ──> scanning
    │                                                 ▲
    └──capture, no holdings───────────────────────────┘
    └──unresolvable──> manual ──> (tray) ──> scanning
```

Step panels render as absolutely-positioned overlays over the scanner region — the
same technique `BarcodeScanner` already uses for its own confirmation overlay, and the
same pattern `BookshelfDetails` uses to hang a tray off the scanner. The scanner stays
mounted throughout; unmounting it would kill the camera and force a restart tap on
every loop.

`ScanModal` fetches `GET /api/bookshelves` once on open.

**Modified: `frontend/src/components/Layout.jsx`** — sidebar button, mobile FAB, and
one `scanOpen` boolean.

**Modified: `frontend/src/index.css`** — FAB styles, hidden above 860px.

**Modified: `frontend/src/components/BarcodeScanner.jsx`** — one additive,
default-`false` `paused` prop.

This is a deliberate deviation from "leave the scanner untouched". It is necessary:
after `onConfirm` fires, the component resumes its own camera
(`handleConfirmYes` → `handleConfirmDismiss` → `resume()`), so without a brake it
would keep decoding behind the holdings/picker overlay. The prop defaults to `false`,
so existing behaviour and the three tests pinned to this component
(`scannerTeardown`, `upcScanner`, `scanTrayFiling`) are unaffected.

Because React state updates are async, `paused` flips one render *after*
`handleConfirmDismiss` has already resumed — a few milliseconds of live camera. That
is harmless, and `ScanModal` additionally drops any `onConfirm` arriving while
`step !== 'scanning'` as a second line of defence.

### Backend

**1. `GET /api/books/lookup/:isbn` gains `holdings`.**

The route is already behind `authenticateToken`, so `req.user.id` is available and no
new auth surface appears. After the book resolves, one extra query:

```sql
SELECT ub.id AS mapping_id, bs.id AS bookshelf_id, bs.name AS bookshelf_name,
       bs.is_wishlist, ub.physical_location, ub.is_read,
       CASE WHEN bs.user_id = $2 THEN 'owner' ELSE ss.permission END AS role
  FROM user_books ub
  JOIN bookshelves bs ON ub.bookshelf_id = bs.id
  LEFT JOIN shelf_shares ss
    ON ss.bookshelf_id = bs.id AND ss.shared_with_user_id = $2
 WHERE ub.book_id = $1
   AND (bs.user_id = $2 OR ss.shared_with_user_id IS NOT NULL)
 ORDER BY bs.name ASC
```

The `CASE`/`LEFT JOIN` pair mirrors the role resolution already used by the
`UNION ALL` in `bookshelfRouter.js:24-48`. `UNIQUE (bookshelf_id, shared_with_user_id)`
caps the join at one row per shelf, so owning a shelf that is also shared with you
cannot duplicate a holding.

The response becomes `{ ...book, holdings: [...] }`. Existing callers do not read the
key. Note it is *carried, not ignored*: `BookshelfDetails.jsx:362` spreads the whole
lookup object into each tray row, so the array rides along in that state. Harmless —
`handleFileTray` sends only `book.isbn`.

**2. New index.**

```sql
CREATE INDEX IF NOT EXISTS idx_user_books_book_id ON user_books(book_id);
```

The schema declares exactly one explicit index today (`idx_book_barcodes_book_id`), and
Postgres auto-creates them only for PRIMARY KEY and UNIQUE constraints — so
`user_books.book_id` has none, and the holdings query would sequentially scan the
fastest-growing table in the app on every scan. `init.sql` re-runs on every boot by
design, so `IF NOT EXISTS` migrates existing databases with no extra step.

*Noted, not fixed:* `user_books.bookshelf_id` is also unindexed, making the three
correlated subselects per shelf in `bookshelfRouter.js:26-29` seq scans. Pre-existing
and outside this feature's scope.

**3. New: `POST /api/books/file`.**

Body: `{ bookId, bookshelfId, physicalLocation?, notes? }`. Guarded by
`verifyBookshelfAccess` + `requireCollaborator`, then the same duplicate check and
`user_books` insert as steps 5–6 of `POST /scan/:isbn`.

This exists because the tray already holds a resolved catalog row. Filing through
`POST /scan/:isbn` would re-run `findCatalogBook` — and, worse, would break outright
for a UPC-aliased manual book: `/scan/:isbn` validates its parameter with
`isValidBarcode`, which a synthetic `MANUAL-1234…` ISBN fails. Filing by `bookId` is
the correct primitive and sidesteps both problems.

## Testing

- **Backend (`backend/tests`)** — `holdings` shape for: owned shelf, collaborator
  shelf, view-only shelf, wishlist shelf, and a book held nowhere (empty array).
  `POST /api/books/file`: happy path, 403 on a view-only shelf, 409 on a duplicate
  mapping, 404 on an unknown book.
- **Frontend (`frontend/src/tests`)** — `ScanModal` with `BarcodeScanner` stubbed:
  capture with holdings routes to the holdings panel; capture without routes to the
  picker; picker excludes view-only shelves and disables already-held ones; tray dedupe
  keys on `book.id`; filing dispatches `catalog` rows to `/file` and `manual` rows to
  `/manual`; a mid-run failure leaves the remaining rows in the tray.
- **Existing scanner tests must stay green untouched** — the `paused` default proves
  the prop is genuinely additive.

## Out of scope

- Physical location / notes at scan time. The picker asks for a shelf only; annotate
  afterwards from the shelf page.
- Deep-linking the scanner as a `/scan` route.
- Persisting the tray across a modal close.
