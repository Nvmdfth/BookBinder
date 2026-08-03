# Code Review — `prd-alignment-and-card-catalog-ui`

**Scope:** `git diff main...HEAD` (commits `9d8eb27`, `f3b3a88`) plus uncommitted working-tree changes.
**Verification run:** backend `jest` — 7 suites / 142 tests pass. Frontend `vitest` — 7 files / 112 tests pass.
**`--comment`:** ignored — the branch has no upstream and no GitHub PR, so findings are recorded here instead.

Overall this is a strong pass. The backend/PRD alignment (ISBN checksum validation, registration-status probe, cookie-attribute-matched logout, `ON CONFLICT DO NOTHING` seeding, `createApp()` extraction for supertest) is well-judged and well-tested. The Card Catalog redesign is coherent and every CSS class the JSX references actually exists. The findings below are the real defects and the genuine cleanup opportunities.

---

## Correctness

### 1. `frontend/src/pages/BookshelfDetails.jsx:568` — "Recently added" sort shows the oldest books first — **HIGH**

```js
// 'recent' — the shelf response is oldest-first, so newest accessions lead
return matched.slice().reverse();
```

The premise in the comment is wrong. `backend/src/routes/bookshelfRouter.js:118` orders the shelf's books `ORDER BY ub.created_at DESC` — the response is **newest-first**. `handleScanSuccess` also prepends each freshly filed volume to `prev.books`. Reversing therefore puts the oldest volume at the top of the default view.

**Scenario:** file a book by barcode, then return to the list tab. The book you just scanned appears at the very bottom of a shelf sorted "Recently added".

**Fix:** the endpoint already returns `mapping_created_at`, so sort explicitly rather than depending on array order:

```js
return matched
  .slice()
  .sort((a, b) => new Date(b.mapping_created_at || 0) - new Date(a.mapping_created_at || 0));
```

### 2. `frontend/src/pages/Dashboard.jsx:20` — an empty shelf still draws a spine — **MEDIUM**

```js
const filled = Math.max(1, Math.min(9, Math.round((count / 40) * 9) || (count > 0 ? 1 : 0)));
```

The `(count > 0 ? 1 : 0)` branch encodes the intent that an empty shelf gets zero spines, but the outer `Math.max(1, …)` overrides it.

**Scenario:** create a new bookshelf. Its card shows `0` in the count but a coloured spine beside it, so the card reads as holding a book.

**Fix:** `const filled = count === 0 ? 0 : Math.max(1, Math.min(9, Math.round((count / 40) * 9)));`

### 3. `frontend/src/pages/BookshelfDetails.jsx:297` — the scan tray survives a shelf change — **MEDIUM**

`scanTray` is never reset when the `:id` route param changes. The component is not unmounted when navigating from `/bookshelves/4` to `/bookshelves/9` — only `fetchShelfDetails()` re-runs.

**Scenario:** scan three volumes on shelf A, navigate to shelf B without filing, open the scan tab. The button reads *"File 3 into Shelf B"* and filing writes shelf A's run into shelf B. The duplicate guard in `handleScanConfirm` also checks against the wrong shelf's books.

**Fix:** clear the tray in the `id` effect: `useEffect(() => { setScanTray([]); setScanMessage(null); /* …existing fetches… */ }, [id])`.

### 4. `frontend/src/pages/BookshelfDetails.jsx:830` / `:299` — tray identity keyed on a possibly-absent ISBN — **LOW**

`handleScanConfirm` dedupes on `t.isbn === book.isbn` and the row uses `key={t.isbn}`. Nothing guarantees the lookup payload carries an `isbn`.

**Scenario:** two lookups return `isbn: undefined`; the second is silently swallowed by the dedupe, and React logs duplicate-key warnings. The scanner only signals on valid ISBNs today, so this is defensive rather than currently reachable — worth a guard because the tray is the only place a scan lives before it is written.

### 5. `frontend/src/App.jsx:105-119` — DOM mutation inside `useMemo` (render phase) — **LOW/MEDIUM**

`readPaletteTokens` appends a probe node to `document.body` and calls `getComputedStyle` from inside `MUIThemeBridge`'s `useMemo`. Render-phase side effects are what React StrictMode and concurrent rendering are allowed to double-invoke or discard.

**Scenario:** in StrictMode (dev) the probe is created and destroyed twice per theme change; under a future concurrent/suspended render an abandoned render could leave the probe attached. It also forces a synchronous style recalculation on every theme or palette switch.

**Fix:** resolve the tokens in a `useEffect` into state, or read them once from `document.documentElement` (which `ThemeProvider` already stamps) rather than from a throwaway probe.

### 6. `frontend/src/components/Layout.jsx:21` and `frontend/src/pages/BookshelfDetails.jsx:32` — unguarded `localStorage` — **LOW**

`localStorage.getItem` in a `useState` initializer throws (not returns `null`) when storage is blocked — Safari private browsing, a partitioned/embedded context, or a "block all cookies" setting.

**Scenario:** a user with site data disabled signs in and the entire authenticated shell crashes at mount, because the throw happens in `Layout`, above every page.

**Fix:** a small `safeStorage` helper wrapping `getItem`/`setItem` in `try/catch`, shared by both call sites.

### 7. `backend/src/app.js:25` — permissive CORS reflection in production — **MEDIUM (deficiency, carried over)**

```js
origin: process.env.CORS_ORIGIN || true,
credentials: true,
```

`origin: true` reflects **any** requesting origin while `credentials: true` allows the session cookie. This is pre-existing code moved into a new file, so it is not a regression — but it is now in the diff, and a deployment that forgets `CORS_ORIGIN` has any website able to make authenticated cross-origin calls on a signed-in user's behalf. The `sameSite: 'strict'` cookie mitigates it substantially; that is the only thing standing between this and a CSRF hole.

**Suggestion:** fail loud rather than open — `origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : true)`.

---

## Duplicated code

### 8. `frontend/src/utils/isbn.js` ↔ `backend/src/utils/isbn.js` — near-identical modules

The two files differ only in comment wording and `export`/`module.exports`. The two test suites (`frontend/src/tests/isbn.test.js`, `backend/tests/isbn.test.js`) duplicate the same cases. Deliberate — validation has to run on both sides — but the copies will drift.

**Options (pick one, no strong preference):** a tiny `shared/` module both sides import; or keep the copy and add a test that asserts the two files' function bodies are identical. Given the repo has no workspace tooling, the second is the cheaper honest answer.

### 9. `frontend/src/App.jsx:20-60` — `ProtectedRoute` and `AdminRoute` are copy-paste

The loading screen JSX, the `loading` branch, the `isAuthenticated` branch, and the `<Layout>` wrapper are duplicated verbatim. `AdminRoute` can compose:

```jsx
export function AdminRoute({ children }) {
  const { isAdmin, loading } = useAuth();
  if (!loading && !isAdmin) return <Navigate to="/" replace />;
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
```

### 10. `frontend/src/components/BarcodeScanner.jsx:123` — a now-dead prop path

```js
if (onConfirm) onConfirm(lookupDetails);
else onScanSuccess(lookupDetails.isbn);
```

`BookshelfDetails` passes **both** props, so the `onScanSuccess` branch (and the `'Yes, Add'` button label) is unreachable from the only call site. Two confirm behaviours are being maintained for one caller.

**Suggestion:** if the immediate-file flow is not wanted anywhere, drop `onScanSuccess` from the scanner's contract and call `handleScanSuccess` only from `handleFileTray`. **This is one to confirm before acting** — see Question A.

### 11. `frontend/src/pages/BookshelfDetails.jsx:1055-1085` — view-mode persistence repeated

Both view-mode buttons inline `setViewMode(x); localStorage.setItem('bookbinder_view_mode', x)`. One `selectViewMode(mode)` helper removes the chance of the two drifting, and pairs naturally with the `safeStorage` wrapper from finding 6.

---

## UI / UX

### 12. `frontend/src/pages/BookshelfDetails.jsx:1264` — the catalog-card modal is not dismissible by keyboard — **MEDIUM**

The new volume sheet has no `Escape` handler, no `role="dialog"` / `aria-modal="true"`, no focus move onto the panel, and no focus trap. The overlay `<div onClick>` is mouse-only. Since the grid now routes *every* book interaction through this modal, it is the most-opened surface in the app.

**Fix:** it is worth extracting one `<Modal>` shell — `role="dialog"`, `aria-modal`, Escape-to-close, focus restored to the trigger, click-outside — and re-using it for the volume sheet, the edit-annotations modal, and the share modal, all of which currently share the same gaps.

### 13. `frontend/src/pages/BookshelfDetails.jsx:1035` — read status now costs three interactions per book — **MEDIUM, needs a decision**

The old grid card carried an inline Read/Unread toggle and edit/remove buttons. The redesigned `cover-cell` moves all of them into the modal: open → toggle → close, per book. The cover grid is beautiful and I would not undo it, but marking a stack of ten books as read after a holiday is now 30 interactions instead of 10.

**Suggestion:** a hover/focus-revealed read toggle in the corner of `.cover-cell` restores the one-click path without putting the chrome back on the card. **See Question B.**

### 14. `frontend/src/pages/Dashboard.jsx:248` — the Accession Record renders zeroed for empty and loading states

The panel is unconditional. A brand-new account sees `0 Volumes / 0 Shelves / 0% Read / 0 Filed` above an empty-state prompt, which reads as a broken widget rather than an empty library.

**Suggestion:** render the panel only when `accession.shelves > 0`, and let the existing empty state carry the first-run screen alone.

### 15. `frontend/src/pages/Register.jsx:24` — a network blip locks the registration form with no way back

The `catch` sets `isLocked(true)` permanently. Failing closed is right, but a transient fetch failure on an *open* instance now shows "Public registration is currently disabled on this instance" — a message that is factually wrong and offers only "Return to Sign In".

**Suggestion:** distinguish "closed" (a `200` with `allowOpenRegistration: false`) from "could not reach the server", and give the latter a retry button.

---

## Minor notes (no action needed)

- `backend/src/routes/bookshelfRouter.js:26-40` — six correlated sub-selects, three per `UNION ALL` arm. Correct and fine at home-library scale; if a user ever reaches hundreds of shelves, a single `LEFT JOIN … GROUP BY` over `user_books` collapses it to one pass.
- `frontend/src/components/Layout.jsx:59` — `title={item.name}` is set unconditionally, so expanded nav links show a tooltip that repeats the visible label. Apply it only when `collapsed`.
- `skills/bookbinder_developer/SKILL.md` is deleted and `skills/bookbinderDeveloper/` is untracked — stage the rename so the move is reviewable rather than appearing as a deletion.
- `frontend/src/components/BarcodeScanner.jsx:24-35` — the reticle/`qrbox` unification is correct *because* `cameraViewport` is `aspect-ratio: 1`, which makes `min(w, h) === w === h`. That dependency deserves a one-line comment on the `cameraViewport` style, since removing the square aspect ratio would silently desynchronise the guide box from the decode region again.

---

## Questions — please clarify before I change anything

**A.** `BarcodeScanner` still supports both an immediate-file (`onScanSuccess`) and a batch-tray (`onConfirm`) confirm path, but only the tray path is reachable. Is the immediate-file path meant to be kept for a future caller, or should the prop be removed?

**B.** Was removing the inline read/edit/remove controls from the grid card (finding 13) a deliberate simplification, or should a hover-revealed read toggle be restored to the cover cell?

**C.** For the duplicated ISBN utility (finding 8): would you prefer a shared module (which means introducing a workspace/build step neither package currently has), or keeping the copies with a drift-detecting test?

**D.** Finding 7 (CORS): is `CORS_ORIGIN` set in your production deployment? If so this is documentation only; if not, I would make the production default fail closed.
