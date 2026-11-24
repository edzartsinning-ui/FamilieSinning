CREATE TABLE IF NOT EXISTS event_websites (event_id INTEGER PRIMARY KEY, url TEXT NOT NULL);
INSERT INTO event_websites(event_id,url) SELECT id,'https://www.funxperience.de/kassel/cube-challenges/' FROM events WHERE id=1 ON CONFLICT(event_id) DO NOTHING;
