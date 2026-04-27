CREATE TABLE IF NOT EXISTS psychologists (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  age_category TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS slots (
  id BIGSERIAL PRIMARY KEY,
  psychologist_id BIGINT NOT NULL REFERENCES psychologists(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('available', 'booked', 'deleted')),
  booking_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  slot_id BIGINT NOT NULL REFERENCES slots(id),
  psychologist_id BIGINT NOT NULL REFERENCES psychologists(id),
  age_category TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  parent_email TEXT NOT NULL,
  parent_phone TEXT NOT NULL,
  parent_telegram TEXT NOT NULL,
  child_name TEXT NOT NULL,
  child_age INTEGER NOT NULL,
  country TEXT NOT NULL,
  request_text TEXT NOT NULL,
  preferred_contact_method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'confirmed', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_psychologists_category_active
  ON psychologists(age_category, is_active);

CREATE INDEX IF NOT EXISTS idx_slots_listing
  ON slots(psychologist_id, starts_at, status);

CREATE INDEX IF NOT EXISTS idx_bookings_filters
  ON bookings(status, psychologist_id, created_at);
