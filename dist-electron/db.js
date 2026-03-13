import Database from "better-sqlite3";
import path from "node:path";
export function createDb(userDataPath) {
    const dbPath = path.join(userDataPath, "memora.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      file_path TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  `);
    return db;
}
