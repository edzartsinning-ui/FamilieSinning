-- Die bestehende Veranstaltung hat die ID 1 und bleibt in den bisherigen Tabellen.
CREATE TABLE IF NOT EXISTS future_events (
  id INTEGER PRIMARY KEY CHECK(id > 1),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  place TEXT NOT NULL,
  activity TEXT NOT NULL,
  deadline TEXT NOT NULL,
  rest_from TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS future_invitees (
  event_id INTEGER NOT NULL REFERENCES future_events(id),
  name TEXT NOT NULL,
  invite_token_hash TEXT UNIQUE,
  PRIMARY KEY(event_id, name)
);

CREATE TABLE IF NOT EXISTS future_rsvps (
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  answer TEXT NOT NULL CHECK(answer IN ('yes','no')),
  message TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(event_id, name),
  FOREIGN KEY(event_id, name) REFERENCES future_invitees(event_id, name) ON UPDATE CASCADE
);
