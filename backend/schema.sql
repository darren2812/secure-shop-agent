-- Works on SQLite (local) and SingleStore/MySQL with minor type tweaks.
-- audit_events.canonical_text holds the exact hashed bytes; never store it as JSON.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128),
  per_purchase_limit DECIMAL(10,2) NOT NULL,
  monthly_cap DECIMAL(10,2) NOT NULL,
  allow_marketplace BOOLEAN NOT NULL DEFAULT 1,
  blocked_stores TEXT,
  preferences TEXT,
  persona_inquiry_id VARCHAR(128),
  verified BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stores (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(256) NOT NULL,
  domain VARCHAR(256),
  platform VARCHAR(32),
  seller_name VARCHAR(256),
  address VARCHAR(512),
  email VARCHAR(256),
  phone VARCHAR(64),
  is_seeded BOOLEAN NOT NULL DEFAULT 1,
  flagged BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS store_policies (
  store_id VARCHAR(64) PRIMARY KEY,
  return_policy TEXT,
  contact_address TEXT,
  accepted_payments TEXT,
  policy_text TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id VARCHAR(64) PRIMARY KEY,
  store_id VARCHAR(64) NOT NULL,
  product VARCHAR(256) NOT NULL,
  title TEXT,
  price DECIMAL(10,2) NOT NULL,
  advertised_discount DECIMAL(5,2),
  item_condition VARCHAR(32),
  url TEXT
);

CREATE TABLE IF NOT EXISTS store_signals (
  store_id VARCHAR(64) NOT NULL,
  signal VARCHAR(64) NOT NULL,
  params TEXT,
  source VARCHAR(128),
  evidence_url TEXT
);

CREATE TABLE IF NOT EXISTS reference_prices (
  product VARCHAR(256) PRIMARY KEY,
  typical_price DECIMAL(10,2) NOT NULL,
  price_history TEXT,
  source VARCHAR(32),
  fetched_at VARCHAR(40)
);

CREATE TABLE IF NOT EXISTS audit_events (
  request_id VARCHAR(64) NOT NULL,
  seq INT NOT NULL,
  canonical_text TEXT NOT NULL,
  prev_hash CHAR(64) NOT NULL,
  hash CHAR(64) NOT NULL,
  PRIMARY KEY (request_id, seq)
);

CREATE TABLE IF NOT EXISTS decisions (
  id VARCHAR(64) PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  listing_id VARCHAR(64) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  verification_id VARCHAR(128),
  used BOOLEAN NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id VARCHAR(64) PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  listing_id VARCHAR(64) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(16) NOT NULL,
  decision_id VARCHAR(64) NOT NULL UNIQUE,
  verification_id VARCHAR(128),
  created_at VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  user_id VARCHAR(64) NOT NULL,
  month VARCHAR(7) NOT NULL,
  spent DECIMAL(10,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
