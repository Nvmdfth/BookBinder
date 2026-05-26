# Product Requirements Document (PRD)

## Project: BookBinder (v1.0)

**Date:** May 2026

**Stack:** React, Express.js, PostgreSQL, Docker

**Target:** Multi-Role, Mobile-First Home Library Management System

---

## 1. Executive Summary

### 1.1. Purpose

BookBinder is an open-source, self-hosted, web-based library management system designed to help users catalog, track, and organize their physical book collections. The application acts as a personal inventory engine, bridging the gap between digital indexing and the actual physical positioning of literature within a household or institution.

### 1.2. Scope

The product will be delivered as a single multi-container production-ready deployment via Docker Compose. It features a responsive React Single Page Application (SPA), a resilient Express.js REST API, and a robust PostgreSQL database. Core differentiators include extreme mobile usability, zero-configuration local hardware camera barcode scanning, database-level deduplication via a global books registry, fine-grained access control toggles, and secure cross-user library collaboration.

---

## 2. User Roles & Permissions

The application enforces a rigid Role-Based Access Control (RBAC) authorization matrix. Permissions are checked at both the frontend routing level and via dedicated backend Express middleware layers.

| Permission / Capability | Guest / Public | User | Admin |
| --- | --- | --- | --- |
| View Landing Page / Login Interface | Yes | Yes | Yes |
| Account Registration (Self-Service) | *Conditional* | Yes | Yes |
| Modify Personal Profile & Security Options | No | Yes | Yes |
| Create, Read, Update, Delete (CRUD) Personal Bookshelves | No | Yes | Yes |
| Scan ISBN & Log Physical Location Mapping | No | Yes | Yes |
| Create Share Links & Explicit Collaborator Invites | No | Yes | Yes |
| Modify System Settings Switch (Open Registration) | No | No | Yes |
| System User Account Auditing / Deactivation | No | No | Yes |
| Global Books Metadata Index Cleaning | No | No | Yes |

** Conditional: Dependent upon the status of the `allow_open_registration` application runtime toggle.*

---

## 3. System Architecture & Data Flow

### 3.1. Infrastructure Topology

The ecosystem is structured using an isolated Docker network. Persisted layers are fully volume-mapped back to the host machine to eliminate data loss risks during runtime container updates.

```
                    ┌────────────────────────┐
                    │      Client Browser    │
                    │ (Mobile / Desktop SPA) │
                    └───────────┬────────────┘
                                │
                        HTTP/WSS│(Port 80/443)
                                ▼
         ┌──────────────────────────────────────────────┐
         │               Docker Compose Network         │
         │                                              │
         │  ┌──────────────────┐  Proxy/  ┌──────────┐  │
         │  │ Frontend Engine  │◄────────►│  Nginx   │  │
         │  │   (React SPA)    │  Static  │ Reverse  │  │
         │  └──────────────────┘          │  Proxy   │  │
         │                                └────┬─────┘  │
         │                                     │        │
         │                                     │API Call│
         │                                     ▼        │
         │                            ┌────────────────┐│
         │                            │ Backend Engine ││
         │                            │ (Express Node) ││
         │                            └───────┬────────┘│
         │                                    │         │
         │                       PostgreSQL   │         │
         │                       Wire Protocol│         │
         │                                    ▼         │
         │                            ┌────────────────┐│
         │                            │ Persistent DB  ││
         │                            │  (PostgreSQL)  ││
         │                            └────────────────┘│
         └──────────────────────────────────────────────┘

```

### 3.2. Sequential Core Workflows

#### 3.2.1. Ingestion Pipeline

When a user scans a barcode, the backend protects external rate limits by prioritizing the internal database cache over third-party API dependencies.

```
[User Camera Barcode Scan]
            │
            ▼
   [Extract ISBN String]
            │
            ▼
 ┌───────────────────────┐
 │ Backend Database Check│
 └──────────┬────────────┘
            │
            ├──► (Record Exists Match?) ──► [YES] ──┐
            │                                       │
            └──► (Record Missing?) ──► [NO]         │
                                        │           │
                                        ▼           │
                           ┌────────────────────────┐│
                           │ Request External API   ││
                           │ (Google Books/OpenLib) ││
                           └────────────┬───────────┘│
                                        │           │
                                        ▼           │
                           ┌────────────────────────┐│
                           │ Parse & Write Record   ││
                           │ To Global Books Schema ││
                           └────────────┬───────────┘│
                                        │           │
                                        ▼           ▼
                           ┌────────────────────────────┐
                           │ Map Global ID to Personal  │
                           │  User Bookshelf Record     │
                           └────────────────────────────┘

```

#### 3.2.2. Social Authorization Pipeline

Privacy is isolated strictly at the data layer unless explicitly bypassed via a dynamic junction control.

```
 [User B Requests Shelf A]
            │
            ▼
 ┌──────────────────────────┐
 │ Backend Middleware Check │
 └──────────┬───────────────┘
            │
            ├──► Is User B Owner of Shelf A? ──► [YES] ──► Allow Access
            │
            └──► [NO] ──► Query `shelf_shares` Table
                                 │
                                 ├──► Record Exists? ──► [YES] ──► Apply Scope (View/Collaborate)
                                 │
                                 └──► Record Missing? ──► [NO] ──► Return 403 Forbidden Error

```

---

## 4. Technical Specifications & Functional Requirements

### 4.1. Mobile-First Responsive User Interface (UI)

* **Req 4.1.1 — Dynamic Layout Architecture:** The application must utilize a mobile-first design strategy. Primary interface paradigms must favor mobile viewports (widths under 768px), deploying sticky bottom action bars, thumb-accessible menus, and swipe-to-reveal context menus. Desktop viewports will reflow naturally into grid layouts.
* **Req 4.1.2 — Dual-Tone Theme Manager:** A native application client theme manager must handle runtime switching between Light and Dark mode variations.
* Default initialization behavior must check `window.matchMedia('(prefers-color-scheme: dark)')` to mirror OS preferences.
* The Dark theme color palette must satisfy WCAG AA contrast ratio requirements (minimum 4.5:1 ratio for regular structural typography) using true off-black and muted charcoal slates (`#121212`, `#1e1e1e`) to diminish night-time eyestrain during inventory verification in storage spaces.


* **Req 4.1.3 — Hardware Stream Barcode Scanner:** The application must embed an in-browser camera execution frame via native JavaScript WebRTC Stream APIs or specialized abstraction modules (`html5-qrcode`).
* **Targeting Overlays:** The viewfinder component must project a translucent high-contrast scanning overlay guide box to aid correct linear barcode alignment.
* **Hardware Adaptability:** The pipeline must target the specific device rear camera using `facingMode: { exact: "environment" }` structures with a programmatic fallback toggle if unavailable.
* **Haptic and Acoustic Signals:** Upon confirmation of an ISBN-10 or ISBN-13 checksum pattern, the UI must dispatch a low-level physical vibration burst via `navigator.vibrate(100)` accompanied by a brief success tone to confirm operation success without checking the display.



### 4.2. Relational Database Schema & Ingestion Logic

* **Req 4.2.1 — Global Integrity Strategy:** Core entities must be separated from operational mapping instances to ensure extreme database denormalization protection. If multiple users own identical books, they map back to a unified system record.
* **Req 4.2.2 — System Fields Specifications:** The Postgres structural schema must be structured exactly around five foundational groupings:
* **User Accounts (`users`):** Stores credentials, email lookups, security hashes, and role keys (`user` or `admin`).
* **Global Public Catalog (`books`):** Unique collection cache indexed by `isbn`. Stores title, author, publisher, cover image assets, page counts, and publication history.
* **Logical Collections Container (`bookshelves`):** The structural group folders managed by individual users.
* **Cross-Reference Mapping Manifest (`user_books`):** Connects a global catalog entry directly to a specific user's physical inventory. Holds localized user context parameters like custom notes and physical location descriptions.
* **Explicit Permission Access Registry (`shelf_shares`):** Houses access exceptions. Links a shared resource directly to target accounts with a permission definition (`view` or `collaborator`).
* **Internal Configuration Parameter Store (`system_settings`):** Global key-value database array supporting instance operational parameters.


* **Req 4.2.3 — Freeform Storage Tracking:** The `physical_location` parameter within the storage table must accept unlimited unstructured text inputs. Users must have total descriptive freedom to define positions arbitrarily (e.g., `"Living Room Case C, Row 4"`, `"Plastic storage tub under basement workbench"`, `"East wall stack, behind the desk"`).

### 4.3. Social Sharing & Access Control Architecture

* **Req 4.3.1 — Isolation Sandbox:** A user's profile and collection records must remain strictly isolated. Database queries executed throughout typical operational sessions must automatically append a security predicate `WHERE user_id = current_authenticated_user_id` unless an explicit verification record inside `shelf_shares` is active.
* **Req 4.3.2 — View-Only Mode Authorization:** When a shelf share entry contains the `'view'` permission scope, the target user can view the bookshelf structure, metadata entries, user annotations, and physical location description text via a shared dashboard route. All layout action elements (such as "Add Book", "Scan Item", "Delete", or text fields) must be programmatically hidden in the frontend interface and hard-blocked at the REST routing layer.
* **Req 4.3.3 — Collaborator Mode Authorization:** When a shelf share entry contains the `'collaborator'` permission scope, the target user receives the ability to run downstream creation and updates against the shared shelf. They can ingest new titles using the scan pipeline, delete items, or update the text inside the `physical_location` notes.

### 4.4. Security Governance & Administrative System Switches

* **Req 4.4.1 — Open Self-Service Registration Switch:** System registration capabilities must run dynamically against checks on the database parameter `allow_open_registration`.
* **Req 4.4.2 — Default Isolation Out-Of-The-Box State:** Upon initialization, the system seed initialization script must automatically default the `allow_open_registration` record status value string to `'false'`. If an unauthenticated user loads the registration interface view, the platform will hide the input parameters and display a hard fallback component message: *"Public registration is currently disabled on this instance. Please contact your system administrator for access."*
* **Req 4.4.3 — Admin Console Switch Interface:** The application navigation layout must present a protected administrative settings interface hidden from standard user tiers. This interface must contain a hardware-styled toggle switch mapped to update the `allow_open_registration` record status in real-time.
* **Req 4.4.4 — API Integrity Guards:** The backend router execution file responsible for registering inbound payloads (`/api/auth/register`) must perform an immediate validation check against the `system_settings` table state. If the switch string records value evaluates to `'false'`, the pipeline execution block must cease instantly, returning an `HTTP 403 Forbidden` response header.
* **Req 4.4.5 — Baseline Host Provisioning:** Since registration is initially locked down by default upon first-time compilation, the stack deployment framework must provide a safe method to create the root system owner profile. The container instance initialization step will detect explicit configuration strings passed down through environment variables inside the `docker-compose.yml` file structure (`BOOKBINDER_ADMIN_EMAIL`, `BOOKBINDER_ADMIN_PASS`). If detected on boot, it will construct an initial system profile mapped directly to the `'admin'` system role string, allowing immediate system configuration access.

---

## 5. Non-Functional Requirements (NFRs)

* **NFR 5.1 — Portability:** The entire application stack must compile successfully on multiple target host CPU frameworks (`amd64`, `arm64`) to guarantee effortless deployments across low-power home edge systems, standard server arrays, and common network-attached storage nodes (NAS).
* **NFR 5.2 — Data Resiliency:** The database storage directory must run completely out of a localized Docker container named volume mount (`/var/lib/postgresql/data`) to prevent data wipe occurrences during application upgrades or container service cycles.
* **NFR 5.3 — Latency Thresholds:** Internal data operations across localized book caching tables must evaluate in under 70 milliseconds. Downstream external ISBN resolution queries must gracefully handle dropouts, implementing an automated 12-second timeout parameter before reverting to manual user creation layouts.
* **NFR 5.4 — Client Security:** User session signatures must resolve using JSON Web Token (JWT) tracking payloads stored as an HttpOnly, Secure, SameSite Cookie to safeguard identity credentials against Cross-Site Scripting (XSS) vectors.