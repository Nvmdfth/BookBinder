-- BookBinder Database Initialization Schema

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    avatar_url VARCHAR(255),
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Global Books Catalog Table
CREATE TABLE IF NOT EXISTS books (
    id SERIAL PRIMARY KEY,
    isbn VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255),
    publisher VARCHAR(255),
    cover_image_url TEXT,
    page_count INTEGER,
    publication_date VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bookshelves Table
CREATE TABLE IF NOT EXISTS bookshelves (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_wishlist BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. User Books Association Table (Maps a catalog book to a specific bookshelf)
CREATE TABLE IF NOT EXISTS user_books (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bookshelf_id INTEGER NOT NULL REFERENCES bookshelves(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    physical_location TEXT,
    notes TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Shelf Shares Junction Table
CREATE TABLE IF NOT EXISTS shelf_shares (
    id SERIAL PRIMARY KEY,
    bookshelf_id INTEGER NOT NULL REFERENCES bookshelves(id) ON DELETE CASCADE,
    shared_with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(50) NOT NULL CHECK (permission IN ('view', 'collaborator')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (bookshelf_id, shared_with_user_id)
);

-- 6. System Settings Key-Value Table
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(255) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Seed Initial System Settings
INSERT INTO system_settings (key, value)
VALUES 
    ('allow_open_registration', 'false'),
    ('enable_google_books', 'true'),
    ('enable_open_library', 'true')
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value;

-- 8. Migration: Add columns to existing databases safely
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT FALSE;
ALTER TABLE bookshelves ADD COLUMN IF NOT EXISTS is_wishlist BOOLEAN DEFAULT FALSE;
ALTER TABLE user_books ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;

-- 9. Migration: Add theme and palette columns to the users table safely
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(50) DEFAULT 'dark';
ALTER TABLE users ADD COLUMN IF NOT EXISTS palette VARCHAR(50) DEFAULT 'indigo';

