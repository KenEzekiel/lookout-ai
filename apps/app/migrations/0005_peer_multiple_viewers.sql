CREATE TABLE peer_session_multiple (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES device(id),
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  offer TEXT,
  answer TEXT,
  expires_at INTEGER NOT NULL
);
INSERT INTO peer_session_multiple SELECT id,device_id,user_id,workspace_id,run_id,offer,answer,expires_at FROM peer_session;
DROP TABLE peer_session;
ALTER TABLE peer_session_multiple RENAME TO peer_session;
CREATE INDEX peer_session_device ON peer_session(device_id);
