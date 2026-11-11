CREATE TABLE settings (
  installation_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE link_codes (
  code TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL,
  account TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX link_codes_installation ON link_codes (installation_id, expires_at);

CREATE TABLE reverts (
  target TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX reverts_target ON reverts (target, at);

CREATE TABLE rewrites (
  target TEXT NOT NULL,
  before_sha TEXT NOT NULL,
  after_sha TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX rewrites_target ON rewrites (target, after_sha, at);
