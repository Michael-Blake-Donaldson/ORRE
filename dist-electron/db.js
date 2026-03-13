import Database from "better-sqlite3";
import path from "node:path";
// MemoraStore centralizes DB access and prepared statements for speed and maintainability.
export class MemoraStore {
    db;
    ftsEnabled = false;
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

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

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
        this.ensureSessionCategoryColumn();
        this.ftsEnabled = this.initializeFtsSafely();
        if (this.ftsEnabled) {
            // Backfill FTS rows when upgrading from previous schema versions.
            this.db.exec(`
        INSERT INTO extracted_chunks_fts (chunk_id, session_id, content)
        SELECT ec.id, ec.session_id, ec.content
        FROM extracted_chunks ec
        LEFT JOIN extracted_chunks_fts fts ON fts.chunk_id = ec.id
        WHERE fts.chunk_id IS NULL;
      `);
        }
    }
    initializeFtsSafely() {
        try {
            this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS extracted_chunks_fts
        USING fts5(chunk_id UNINDEXED, session_id UNINDEXED, content);
      `);
            return true;
        }
        catch {
            return false;
        }
    }
    ensureSessionCategoryColumn() {
        try {
            this.db.exec(`ALTER TABLE sessions ADD COLUMN category_id TEXT;`);
        }
        catch {
            // Column already exists on upgraded databases.
        }
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_category_id ON sessions(category_id);`);
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
            .prepare(`SELECT s.id, s.mode, s.started_at, s.stopped_at, s.file_path, s.status, s.category_id, c.name AS category_name, s.created_at
         FROM sessions s
         LEFT JOIN categories c ON c.id = s.category_id
         ORDER BY started_at DESC
         LIMIT ?`)
            .all(limit);
    }
    getSessionById(id) {
        return (this.db
            .prepare(`SELECT s.id, s.mode, s.started_at, s.stopped_at, s.file_path, s.status, s.category_id, c.name AS category_name, s.created_at
           FROM sessions s
           LEFT JOIN categories c ON c.id = s.category_id
           WHERE s.id = ?`)
            .get(id) ?? null);
    }
    listCategories() {
        return this.db
            .prepare(`SELECT id, name, created_at
         FROM categories
         ORDER BY LOWER(name) ASC`)
            .all();
    }
    createCategory(name) {
        const normalized = name.trim().slice(0, 64);
        if (!normalized) {
            throw new Error("Category name is required.");
        }
        const existing = this.db
            .prepare(`SELECT id, name, created_at FROM categories WHERE LOWER(name) = LOWER(?)`)
            .get(normalized);
        if (existing) {
            return existing;
        }
        const row = {
            id: crypto.randomUUID(),
            name: normalized,
            created_at: new Date().toISOString(),
        };
        this.db
            .prepare(`INSERT INTO categories (id, name, created_at) VALUES (@id, @name, @created_at)`)
            .run(row);
        return row;
    }
    deleteCategory(categoryId) {
        const tx = this.db.transaction(() => {
            this.db.prepare(`UPDATE sessions SET category_id = NULL WHERE category_id = ?`).run(categoryId);
            this.db.prepare(`DELETE FROM categories WHERE id = ?`).run(categoryId);
        });
        tx();
    }
    assignSessionCategory(sessionId, categoryId) {
        if (categoryId) {
            const categoryExists = this.db.prepare(`SELECT id FROM categories WHERE id = ?`).get(categoryId);
            if (!categoryExists) {
                throw new Error("Category not found.");
            }
        }
        this.db
            .prepare(`UPDATE sessions SET category_id = @category_id WHERE id = @id`)
            .run({ id: sessionId, category_id: categoryId });
    }
    deleteSession(sessionId) {
        const tx = this.db.transaction(() => {
            this.db.prepare(`DELETE FROM extracted_chunks WHERE session_id = ?`).run(sessionId);
            if (this.ftsEnabled) {
                this.db.prepare(`DELETE FROM extracted_chunks_fts WHERE session_id = ?`).run(sessionId);
            }
            this.db.prepare(`DELETE FROM processing_jobs WHERE session_id = ?`).run(sessionId);
            this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
        });
        tx();
    }
    listSessionsByCategory(categoryId, limit = 200) {
        if (!categoryId) {
            return this.db
                .prepare(`SELECT s.id, s.mode, s.started_at, s.stopped_at, s.file_path, s.status, s.category_id, c.name AS category_name, s.created_at
           FROM sessions s
           LEFT JOIN categories c ON c.id = s.category_id
           ORDER BY s.started_at DESC
           LIMIT ?`)
                .all(limit);
        }
        return this.db
            .prepare(`SELECT s.id, s.mode, s.started_at, s.stopped_at, s.file_path, s.status, s.category_id, c.name AS category_name, s.created_at
         FROM sessions s
         LEFT JOIN categories c ON c.id = s.category_id
         WHERE s.category_id = ?
         ORDER BY s.started_at DESC
         LIMIT ?`)
            .all(categoryId, limit);
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
        const clearFts = this.ftsEnabled
            ? this.db.prepare(`DELETE FROM extracted_chunks_fts
           WHERE chunk_id GLOB @chunk_id_pattern`)
            : null;
        const insert = this.db.prepare(`INSERT INTO extracted_chunks
       (id, session_id, chunk_type, content, confidence, source_job_type, created_at)
       VALUES (@id, @session_id, @chunk_type, @content, @confidence, @source_job_type, @created_at)`);
        const insertFts = this.ftsEnabled
            ? this.db.prepare(`INSERT INTO extracted_chunks_fts (chunk_id, session_id, content)
           VALUES (@chunk_id, @session_id, @content)`)
            : null;
        const createdAt = new Date().toISOString();
        const transaction = this.db.transaction(() => {
            clear.run({ session_id: sessionId, source_job_type: jobType });
            if (clearFts) {
                clearFts.run({ chunk_id_pattern: `${sessionId}:${jobType}:*` });
            }
            rows.forEach((row, index) => {
                const chunkId = `${sessionId}:${jobType}:${index}`;
                insert.run({
                    id: chunkId,
                    session_id: sessionId,
                    chunk_type: jobType,
                    content: row.content,
                    confidence: row.confidence,
                    source_job_type: jobType,
                    created_at: createdAt,
                });
                if (insertFts) {
                    insertFts.run({
                        chunk_id: chunkId,
                        session_id: sessionId,
                        content: row.content,
                    });
                }
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
    searchExtractedContent(query, limit = 25) {
        const normalized = query.trim();
        if (!normalized) {
            return [];
        }
        if (this.ftsEnabled) {
            const ftsQuery = this.db.prepare(`SELECT
           ec.id AS chunk_id,
           ec.session_id AS session_id,
           s.mode AS session_mode,
           s.started_at AS session_started_at,
           ec.chunk_type AS chunk_type,
           ec.content AS content,
           ec.confidence AS confidence,
           bm25(extracted_chunks_fts) AS rank
         FROM extracted_chunks_fts
         JOIN extracted_chunks ec ON ec.id = extracted_chunks_fts.chunk_id
         JOIN sessions s ON s.id = ec.session_id
         WHERE extracted_chunks_fts MATCH ?
         ORDER BY rank ASC, ec.created_at DESC
         LIMIT ?`);
            try {
                return ftsQuery.all(normalized, limit);
            }
            catch {
                // Continue to LIKE fallback when query syntax is invalid for FTS.
            }
        }
        return this.db
            .prepare(`SELECT
           ec.id AS chunk_id,
           ec.session_id AS session_id,
           s.mode AS session_mode,
           s.started_at AS session_started_at,
           ec.chunk_type AS chunk_type,
           ec.content AS content,
           ec.confidence AS confidence,
           9999.0 AS rank
         FROM extracted_chunks ec
         JOIN sessions s ON s.id = ec.session_id
         WHERE ec.content LIKE '%' || ? || '%'
         ORDER BY ec.created_at DESC
         LIMIT ?`)
            .all(normalized, limit);
    }
}
export function createDb(userDataPath) {
    return new MemoraStore(userDataPath);
}
