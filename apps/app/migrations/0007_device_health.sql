CREATE TABLE device_health (
  device_id TEXT PRIMARY KEY NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  last_contact_at INTEGER NOT NULL,
  report TEXT NOT NULL CHECK (json_valid(report))
);
