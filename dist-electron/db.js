import Database from "better-sqlite3";
import path from "node:path";
// MemoraStore centralizes DB access and prepared statements for speed and maintainability.
export class MemoraStore {
    db;
    constructor(userDataPath) {
        const dbPath = path.join(userDataPath, "memora.db");
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS processing_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON processing_jobs(session_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status);

      CREATE TABLE IF NOT EXISTS extracted_chunks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        chunk_type TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL NOT NULL,
        source_job_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_session_id ON extracted_chunks(session_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_type ON extracted_chunks(chunk_type);
    `);
    }
    createSession(input) {
        this.db
            .prepare(`INSERT INTO sessions (id, mode, started_at, status, created_at)
         VALUES (@id, @mode, @started_at, @status, @created_at)`)
            .run({
            id: input.id,
            mode: input.mode,
            started_at: input.startedAt,
            status: "recording",
            created_at: input.startedAt,
        });
    }
    stopSession(input) {
        this.db
            .prepare(`UPDATE sessions
         SET stopped_at = @stopped_at, status = @status
         WHERE id = @id`)
            .run({
            id: input.id,
            stopped_at: input.stoppedAt,
            status: "stopped",
        });
    }
    markSessionSaved(input) {
        this.db
            .prepare(`UPDATE sessions
         SET file_path = @file_path, status = @status
         WHERE id = @id`)
            .run({
            id: input.id,
            file_path: input.filePath,
            status: "saved",
        });
    }
    listSessions(limit = 20) {
        return this.db
            .prepare(`SELECT id, mode, started_at, stopped_at, file_path, status, created_at
         FROM sessions
         ORDER BY started_at DESC
         LIMIT ?`)
            .all(limit);
    }
    getSessionById(id) {
        return (this.db
            .prepare(`SELECT id, mode, started_at, stopped_at, file_path, status, created_at
           FROM sessions
           WHERE id = ?`)
            .get(id) ?? null);
    }
    queueProcessingJobs(sessionId) {
        const createdAt = new Date().toISOString();
        const upsert = this.db.prepare(`INSERT OR REPLACE INTO processing_jobs
       (id, session_id, job_type, status, error_message, started_at, finished_at, created_at)
       VALUES (@id, @session_id, @job_type, @status, @error_message, @started_at, @finished_at, @created_at)`);
        upsert.run({
            id: `${sessionId}:ocr`,
            session_id: sessionId,
            job_type: "ocr",
            status: "queued",
            error_message: null,
            started_at: null,
            finished_at: null,
            created_at: createdAt,
        });
        upsert.run({
            id: `${sessionId}:transcript`,
            session_id: sessionId,
            job_type: "transcript",
            status: "queued",
            error_message: null,
            started_at: null,
            finished_at: null,
            created_at: createdAt,
        });
    }
    updateProcessingJob(input) {
        this.db
            .prepare(`UPDATE processing_jobs
         SET status = @status,
             error_message = @error_message,
             started_at = COALESCE(@started_at, started_at),
             finished_at = COALESCE(@finished_at, finished_at)
         WHERE id = @id`)
            .run({
            id: `${input.sessionId}:${input.jobType}`,
            status: input.status,
            error_message: input.errorMessage ?? null,
            started_at: input.startedAt ?? null,
            finished_at: input.finishedAt ?? null,
        });
    }
    replaceExtractedChunks(sessionId, jobType, rows) {
        const clear = this.db.prepare(`DELETE FROM extracted_chunks
       WHERE session_id = @session_id AND source_job_type = @source_job_type`);
        const insert = this.db.prepare(`INSERT INTO extracted_chunks
       (id, session_id, chunk_type, content, confidence, source_job_type, created_at)
       VALUES (@id, @session_id, @chunk_type, @content, @confidence, @source_job_type, @created_at)`);
        const createdAt = new Date().toISOString();
        const transaction = this.db.transaction(() => {
            clear.run({ session_id: sessionId, source_job_type: jobType });
            rows.forEach((row, index) => {
                insert.run({
                    id: `${sessionId}:${jobType}:${index}`,
                    session_id: sessionId,
                    chunk_type: jobType,
                    content: row.content,
                    confidence: row.confidence,
                    source_job_type: jobType,
                    created_at: createdAt,
                });
            });
        });
        transaction();
    }
    getSessionDetail(sessionId) {
        const session = this.getSessionById(sessionId);
        const jobs = this.db
            .prepare(`SELECT id, session_id, job_type, status, error_message, started_at, finished_at, created_at
         FROM processing_jobs
         WHERE session_id = ?
         ORDER BY job_type ASC`)
            .all(sessionId);
        const chunks = this.db
            .prepare(`SELECT id, session_id, chunk_type, content, confidence, source_job_type, created_at
         FROM extracted_chunks
         WHERE session_id = ?
         ORDER BY created_at DESC`)
            .all(sessionId);
        return { session, jobs, chunks };
    }
}
export function createDb(userDataPath) {
    return new MemoraStore(userDataPath);
}
