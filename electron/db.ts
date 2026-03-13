import Database from "better-sqlite3";
import path from "node:path";

export type SessionRow = {
  id: string;
  mode: string;
  started_at: string;
  stopped_at: string | null;
  file_path: string | null;
  status: "recording" | "stopped" | "saved" | "discarded";
  created_at: string;
};

export type ProcessingJobRow = {
  id: string;
  session_id: string;
  job_type: "ocr" | "transcript";
  status: "queued" | "running" | "completed" | "failed";
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type ExtractedChunkRow = {
  id: string;
  session_id: string;
  chunk_type: "ocr" | "transcript";
  content: string;
  confidence: number;
  source_job_type: "ocr" | "transcript";
  created_at: string;
};

export type SessionDetail = {
  session: SessionRow | null;
  jobs: ProcessingJobRow[];
  chunks: ExtractedChunkRow[];
};

export type SearchResultRow = {
  chunk_id: string;
  session_id: string;
  session_mode: string;
  session_started_at: string;
  chunk_type: "ocr" | "transcript";
  content: string;
  confidence: number;
  rank: number;
};

// MemoraStore centralizes DB access and prepared statements for speed and maintainability.
export class MemoraStore {
  private readonly db: Database.Database;

  constructor(userDataPath: string) {
    const dbPath = path.join(userDataPath, "memora.db");
    this.db = new Database(dbPath);

    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
  }

  private initializeSchema() {
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

      CREATE VIRTUAL TABLE IF NOT EXISTS extracted_chunks_fts
      USING fts5(chunk_id UNINDEXED, session_id UNINDEXED, content, tokenize = 'unicode61 porter');
    `);

    // Backfill FTS rows when upgrading from previous schema versions.
    this.db.exec(`
      INSERT INTO extracted_chunks_fts (chunk_id, session_id, content)
      SELECT ec.id, ec.session_id, ec.content
      FROM extracted_chunks ec
      LEFT JOIN extracted_chunks_fts fts ON fts.chunk_id = ec.id
      WHERE fts.chunk_id IS NULL;
    `);
  }

  createSession(input: { id: string; mode: string; startedAt: string }) {
    this.db
      .prepare(
        `INSERT INTO sessions (id, mode, started_at, status, created_at)
         VALUES (@id, @mode, @started_at, @status, @created_at)`,
      )
      .run({
        id: input.id,
        mode: input.mode,
        started_at: input.startedAt,
        status: "recording",
        created_at: input.startedAt,
      });
  }

  stopSession(input: { id: string; stoppedAt: string }) {
    this.db
      .prepare(
        `UPDATE sessions
         SET stopped_at = @stopped_at, status = @status
         WHERE id = @id`,
      )
      .run({
        id: input.id,
        stopped_at: input.stoppedAt,
        status: "stopped",
      });
  }

  markSessionSaved(input: { id: string; filePath: string }) {
    this.db
      .prepare(
        `UPDATE sessions
         SET file_path = @file_path, status = @status
         WHERE id = @id`,
      )
      .run({
        id: input.id,
        file_path: input.filePath,
        status: "saved",
      });
  }

  listSessions(limit = 20): SessionRow[] {
    return this.db
      .prepare(
        `SELECT id, mode, started_at, stopped_at, file_path, status, created_at
         FROM sessions
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(limit) as SessionRow[];
  }

  getSessionById(id: string): SessionRow | null {
    return (
      (this.db
        .prepare(
          `SELECT id, mode, started_at, stopped_at, file_path, status, created_at
           FROM sessions
           WHERE id = ?`,
        )
        .get(id) as SessionRow | undefined) ?? null
    );
  }

  queueProcessingJobs(sessionId: string) {
    const createdAt = new Date().toISOString();
    const upsert = this.db.prepare(
      `INSERT OR REPLACE INTO processing_jobs
       (id, session_id, job_type, status, error_message, started_at, finished_at, created_at)
       VALUES (@id, @session_id, @job_type, @status, @error_message, @started_at, @finished_at, @created_at)`,
    );

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

  updateProcessingJob(
    input: {
      sessionId: string;
      jobType: "ocr" | "transcript";
      status: "queued" | "running" | "completed" | "failed";
      errorMessage?: string | null;
    } & {
      startedAt?: string | null;
      finishedAt?: string | null;
    },
  ) {
    this.db
      .prepare(
        `UPDATE processing_jobs
         SET status = @status,
             error_message = @error_message,
             started_at = COALESCE(@started_at, started_at),
             finished_at = COALESCE(@finished_at, finished_at)
         WHERE id = @id`,
      )
      .run({
        id: `${input.sessionId}:${input.jobType}`,
        status: input.status,
        error_message: input.errorMessage ?? null,
        started_at: input.startedAt ?? null,
        finished_at: input.finishedAt ?? null,
      });
  }

  replaceExtractedChunks(sessionId: string, jobType: "ocr" | "transcript", rows: Array<{ content: string; confidence: number }>) {
    const clear = this.db.prepare(
      `DELETE FROM extracted_chunks
       WHERE session_id = @session_id AND source_job_type = @source_job_type`,
    );

    const clearFts = this.db.prepare(
      `DELETE FROM extracted_chunks_fts
       WHERE chunk_id GLOB @chunk_id_pattern`,
    );

    const insert = this.db.prepare(
      `INSERT INTO extracted_chunks
       (id, session_id, chunk_type, content, confidence, source_job_type, created_at)
       VALUES (@id, @session_id, @chunk_type, @content, @confidence, @source_job_type, @created_at)`,
    );

    const insertFts = this.db.prepare(
      `INSERT INTO extracted_chunks_fts (chunk_id, session_id, content)
       VALUES (@chunk_id, @session_id, @content)`,
    );

    const createdAt = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      clear.run({ session_id: sessionId, source_job_type: jobType });
      clearFts.run({ chunk_id_pattern: `${sessionId}:${jobType}:*` });

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

        insertFts.run({
          chunk_id: chunkId,
          session_id: sessionId,
          content: row.content,
        });
      });
    });

    transaction();
  }

  getSessionDetail(sessionId: string): SessionDetail {
    const session = this.getSessionById(sessionId);
    const jobs = this.db
      .prepare(
        `SELECT id, session_id, job_type, status, error_message, started_at, finished_at, created_at
         FROM processing_jobs
         WHERE session_id = ?
         ORDER BY job_type ASC`,
      )
      .all(sessionId) as ProcessingJobRow[];

    const chunks = this.db
      .prepare(
        `SELECT id, session_id, chunk_type, content, confidence, source_job_type, created_at
         FROM extracted_chunks
         WHERE session_id = ?
         ORDER BY created_at DESC`,
      )
      .all(sessionId) as ExtractedChunkRow[];

    return { session, jobs, chunks };
  }

  searchExtractedContent(query: string, limit = 25): SearchResultRow[] {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    const ftsQuery = this.db.prepare(
      `SELECT
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
       LIMIT ?`,
    );

    try {
      return ftsQuery.all(normalized, limit) as SearchResultRow[];
    } catch {
      // Fallback keeps search usable when users type unsupported FTS syntax.
      return this.db
        .prepare(
          `SELECT
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
           LIMIT ?`,
        )
        .all(normalized, limit) as SearchResultRow[];
    }
  }
}

export function createDb(userDataPath: string) {
  return new MemoraStore(userDataPath);
}
