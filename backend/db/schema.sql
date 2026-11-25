CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'citizen',
  points INT NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'Citizen',
  created_at TIMESTAMPTZ DEFAULT now()
);

UPDATE users
SET level=CASE
  WHEN points >= 500 THEN 'Hero'
  WHEN points >= 200 THEN 'Champion'
  WHEN points >= 50 THEN 'Guardian'
  ELSE 'Citizen'
END
WHERE level IS DISTINCT FROM CASE
  WHEN points >= 500 THEN 'Hero'
  WHEN points >= 200 THEN 'Champion'
  WHEN points >= 50 THEN 'Guardian'
  ELSE 'Citizen'
END;

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  categories TEXT[] NOT NULL,
  contact TEXT
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  report_number TEXT,
  user_id INT REFERENCES users(id),
  image_url TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  category TEXT,
  severity INT,
  status TEXT NOT NULL DEFAULT 'pending',
  description TEXT,
  department_id INT REFERENCES departments(id),
  duplicate_of INT REFERENCES reports(id),
  upvotes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_number TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE reports
SET report_number = 'SK-' ||
  to_char(COALESCE(created_at, now()) AT TIME ZONE 'UTC', 'YYYY') || '-' ||
  upper(replace(gen_random_uuid()::text, '-', ''))
WHERE report_number IS NULL;

UPDATE reports
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE reports ALTER COLUMN report_number DROP DEFAULT;
ALTER TABLE reports ALTER COLUMN report_number SET NOT NULL;
ALTER TABLE reports ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE reports ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS reports_department_status_idx ON reports (department_id, status);
CREATE INDEX IF NOT EXISTS reports_category_status_idx ON reports (category, status);
CREATE UNIQUE INDEX IF NOT EXISTS reports_report_number_uidx ON reports (report_number);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'reports'::regclass
      AND conname = 'reports_report_number_uidx'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_report_number_uidx
      UNIQUE USING INDEX reports_report_number_uidx;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION set_report_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.report_number =
    'SK-' ||
    to_char(COALESCE(NEW.created_at, now()) AT TIME ZONE 'UTC', 'YYYY') ||
    '-' ||
    lpad(NEW.id::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reports_set_report_number ON reports;
CREATE TRIGGER reports_set_report_number
  BEFORE INSERT ON reports
  FOR EACH ROW
  EXECUTE FUNCTION set_report_number();

CREATE OR REPLACE FUNCTION set_report_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reports_set_updated_at ON reports;
CREATE TRIGGER reports_set_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION set_report_updated_at();

CREATE TABLE IF NOT EXISTS agent_logs (
  id SERIAL PRIMARY KEY,
  report_id INT REFERENCES reports(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  input JSONB,
  output JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS point_events (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  reason TEXT,
  points INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_votes (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id INT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, report_id)
);

CREATE TABLE IF NOT EXISTS report_jobs (
  report_id INT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_jobs_ready_idx ON report_jobs (available_at, created_at)
  WHERE status IN ('queued', 'processing');

CREATE TABLE IF NOT EXISTS report_messages (
  id SERIAL PRIMARY KEY,
  report_id INT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sender_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_messages_report_created_idx ON report_messages (report_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS badges (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id INT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS rewards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  points_cost INT NOT NULL CHECK (points_cost > 0),
  stock INT CHECK (stock IS NULL OR stock >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id SERIAL PRIMARY KEY,
  reward_id INT NOT NULL REFERENCES rewards(id),
  user_id INT NOT NULL REFERENCES users(id),
  points_spent INT NOT NULL CHECK (points_spent > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_redemptions_user_created_idx ON reward_redemptions (user_id, created_at DESC);

INSERT INTO badges (code, name, description) VALUES
  ('first_report', 'First Report', 'Submitted your first civic issue report.'),
  ('five_reports', 'Community Observer', 'Submitted five civic issue reports.'),
  ('first_resolution', 'Issue Resolver', 'Had your first report marked resolved.'),
  ('helpful_neighbor', 'Helpful Neighbor', 'Upvoted five distinct community reports.'),
  ('century_club', 'Century Club', 'Earned 100 community points.')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO departments (name, categories, contact)
SELECT v.name, v.categories, v.contact
FROM (VALUES
  ('K-Electric', ARRAY['street_light','electricity_issue'], 'ke@example.com'),
  ('Karachi Water Board', ARRAY['water_leakage','water_supply','sewerage_drainage'], 'kwsb@example.com'),
  ('KMC Roads', ARRAY['pothole','broken_road','damaged_footpath'], 'roads@example.com'),
  ('KMC Sanitation', ARRAY['garbage','overflowing_dustbin','waste_collection','dirty_street'], 'kmc@example.com')
) AS v(name, categories, contact)
WHERE NOT EXISTS (SELECT 1 FROM departments department WHERE department.name=v.name);

UPDATE departments AS department
SET categories=v.categories, contact=v.contact
FROM (VALUES
  ('K-Electric', ARRAY['street_light','electricity_issue'], 'ke@example.com'),
  ('Karachi Water Board', ARRAY['water_leakage','water_supply','sewerage_drainage'], 'kwsb@example.com'),
  ('KMC Roads', ARRAY['pothole','broken_road','damaged_footpath'], 'roads@example.com'),
  ('KMC Sanitation', ARRAY['garbage','overflowing_dustbin','waste_collection','dirty_street'], 'kmc@example.com')
) AS v(name, categories, contact)
WHERE department.name=v.name;

UPDATE reports
SET category = CASE category
  WHEN 'streetlight' THEN 'street_light'
  WHEN 'electric' THEN 'electricity_issue'
  WHEN 'water_leak' THEN 'water_leakage'
  WHEN 'drain' THEN 'sewerage_drainage'
  WHEN 'sewage' THEN 'sewerage_drainage'
  WHEN 'road_damage' THEN 'broken_road'
  ELSE category
END
WHERE category IN ('streetlight','electric','water_leak','drain','sewage','road_damage');

UPDATE reports AS report
SET department_id=department.id
FROM departments AS department
WHERE report.category=ANY(department.categories)
  AND report.department_id IS DISTINCT FROM department.id;
