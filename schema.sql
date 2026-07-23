-- ============================================================
-- Marginalia Library — database schema (PostgreSQL)
-- Run with: psql "$DATABASE_URL" -f db/schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- bcrypt hash, never plain text
  role          TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader','librarian')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- BOOKS ----------
CREATE TABLE IF NOT EXISTS books (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  author        TEXT NOT NULL,
  cover_url     TEXT,
  call_number   TEXT,
  description   TEXT,
  book_type     TEXT NOT NULL CHECK (book_type IN ('free','sale')),
  price_cents   INTEGER NOT NULL DEFAULT 0,   -- store money as integer cents, never floats
  currency      TEXT NOT NULL DEFAULT 'USD',  -- e.g. USD for card price, TZS for mobile money price
  price_tzs     INTEGER,                      -- optional separate TZS price for mobile money buyers
  uploaded_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- LIBRARIAN NOTICE BOARD ----------
CREATE TABLE IF NOT EXISTS updates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  posted_by   UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- ORDERS / TRANSACTIONS ----------
-- One row per purchase attempt. Status moves pending -> paid / failed / cancelled.
CREATE TABLE IF NOT EXISTS orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id            UUID REFERENCES users(id),
  book_id             UUID REFERENCES books(id),
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL,                 -- 'USD' (card) or 'TZS' (mobile money)
  method              TEXT NOT NULL CHECK (method IN ('card','mpesa','airtel_money')),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  provider            TEXT NOT NULL,                  -- 'stripe' or 'clickpesa'
  provider_reference  TEXT,                           -- Stripe session id / ClickPesa transaction id
  payer_phone         TEXT,                            -- for mobile money orders
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_provider_reference ON orders(provider_reference);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);

-- ---------- PAYOUT SETTINGS ----------
-- This table is a reference record for YOU (the site owner), showing where you told
-- each payment provider to settle funds. It does NOT move money by itself — the actual
-- settlement account is configured directly inside the Stripe Dashboard and the
-- ClickPesa/Selcom merchant portal. Storing it here just keeps your own records straight
-- and lets your admin screen show "payouts go to ...".
CREATE TABLE IF NOT EXISTS payout_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID REFERENCES users(id) UNIQUE,
  card_payout_label   TEXT,   -- e.g. "Stripe -> CRDB Bank ****1234" (free text, just a note to self)
  mobile_money_number TEXT,   -- your M-Pesa/Airtel Money MSISDN, e.g. 2557XXXXXXXX
  mobile_money_network TEXT CHECK (mobile_money_network IN ('mpesa','airtel_money')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
