CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);

CREATE TABLE IF NOT EXISTS resources (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  type              TEXT    NOT NULL CHECK (type IN ('room', 'lab', 'equipment')),
  location          TEXT    NOT NULL,
  capacity          INTEGER NOT NULL CHECK (capacity > 0),
  description       TEXT    NOT NULL DEFAULT '',
  requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0, 1)),
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (name, location)
);

-- start_time / end_time are always stored as UTC ISO strings with milliseconds
-- (YYYY-MM-DDTHH:MM:SS.sssZ). Fixed-width strings compare correctly as text.
CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users (id),
  resource_id   INTEGER NOT NULL REFERENCES resources (id),
  start_time    TEXT    NOT NULL,
  end_time      TEXT    NOT NULL,
  purpose       TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  decision_note TEXT,
  decided_by    INTEGER REFERENCES users (id),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_bookings_resource_time ON bookings (resource_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_user_time     ON bookings (user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status        ON bookings (status);

-- Last line of defence against double-booking. The service layer checks first
-- to give a friendly error, but this trigger guarantees that no code path
-- (including a second process or a manual SQL insert) can create two active
-- bookings that overlap on the same resource. Adjacent slots are fine because
-- the comparison is strict.
CREATE TRIGGER IF NOT EXISTS bookings_no_overlap_insert
BEFORE INSERT ON bookings
WHEN NEW.status IN ('pending', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'booking_overlap')
  WHERE EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.resource_id = NEW.resource_id
      AND b.status IN ('pending', 'confirmed')
      AND b.start_time < NEW.end_time
      AND b.end_time   > NEW.start_time
  );
END;

CREATE TRIGGER IF NOT EXISTS bookings_no_overlap_update
BEFORE UPDATE OF status, start_time, end_time, resource_id ON bookings
WHEN NEW.status IN ('pending', 'confirmed')
BEGIN
  SELECT RAISE(ABORT, 'booking_overlap')
  WHERE EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id <> NEW.id
      AND b.resource_id = NEW.resource_id
      AND b.status IN ('pending', 'confirmed')
      AND b.start_time < NEW.end_time
      AND b.end_time   > NEW.start_time
  );
END;
