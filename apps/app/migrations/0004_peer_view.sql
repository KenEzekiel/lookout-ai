CREATE TABLE peer_source (
  device_id TEXT PRIMARY KEY REFERENCES device(id),
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('camera','file')),
  expires_at INTEGER NOT NULL
);
CREATE TABLE peer_session (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE REFERENCES device(id),
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  offer TEXT,
  answer TEXT,
  expires_at INTEGER NOT NULL
);
