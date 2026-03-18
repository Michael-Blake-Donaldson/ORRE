import { contextBridge, ipcRenderer } from "electron";

type RecordingMode = "idle" | "session" | "clip" | "always-on";

type SessionRow = {
  id: string;
  mode: string;
  started_at: string;
  stopped_at: string | null;
  file_path: string | null;
  status: "recording" | "stopped" | "saved" | "discarded";
  category_id?: string | null;
  category_name?: string | null;
  created_at: string;
};

type CategoryRow = {
  id: string;
  name: string;
  created_at: string;
};

type ProcessingJobRow = {
  id: string;
  session_id: string;
  job_type: "ocr" | "transcript";
  status: "queued" | "running" | "completed" | "failed";
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type ExtractedChunkRow = {
  id: string;
  session_id: string;
  chunk_type: "ocr" | "transcript";
  content: string;
  confidence: number;
  source_job_type: "ocr" | "transcript";
  created_at: string;
};

type SessionDetail = {
  session: SessionRow | null;
  jobs: ProcessingJobRow[];
  chunks: ExtractedChunkRow[];
  health: SessionHealthSummary | null;
};

type SessionHealthSummary = {
  status: "healthy" | "partial" | "degraded" | "pending" | "unsaved";
  status_label: string;
  coverage_label: string;
  summary: string;
  has_saved_file: boolean;
  has_audio_evidence: boolean;
  has_visual_evidence: boolean;
  ocr_chunk_count: number;
  transcript_chunk_count: number;
  audio_segment_count: number;
  visual_segment_count: number;
  queued_job_count: number;
  running_job_count: number;
  completed_job_count: number;
  failed_job_count: number;
  latest_error: string | null;
};

type SearchResultRow = {
  chunk_id: string;
  session_id: string;
  session_mode: string;
  session_started_at: string;
  chunk_type: "ocr" | "transcript";
  content: string;
  confidence: number;
  rank: number;
};

type DisplaySourceRow = {
  id: string;
  name: string;
  type: "screen" | "window";
};

type AppSettings = {
  defaultMode: "session" | "clip" | "always-on";
  sourceStrategy: "remember-last" | "system-picker";
  askLimit: number;
  benchmarkQuestions: string;
  benchmarkLimit: number;
};

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

const api = {
  getCurrentUser: async () => {
    return ipcRenderer.invoke("auth:getCurrentUser") as Promise<AuthUser | null>;
  },
  registerUser: async (payload: { email: string; password: string; displayName: string }) => {
    return ipcRenderer.invoke("auth:register", payload) as Promise<
      | { ok: true; user: AuthUser }
      | { ok: false; reason: string }
    >;
  },
  loginUser: async (payload: { email: string; password: string }) => {
    return ipcRenderer.invoke("auth:login", payload) as Promise<
      | { ok: true; user: AuthUser }
      | { ok: false; reason: string }
    >;
  },
  logoutUser: async () => {
    return ipcRenderer.invoke("auth:logout") as Promise<{ ok: true }>;
  },
  getRecordingState: async () => {
    return ipcRenderer.invoke("recording:getState") as Promise<{
      mode: RecordingMode;
      isRecording: boolean;
    }>;
  },
  startRecording: async (mode: Exclude<RecordingMode, "idle">) => {
    return ipcRenderer.invoke("recording:start", mode) as Promise<{
      ok: boolean;
      sessionId: string;
      mode: RecordingMode;
      startedAt: string;
    }>;
  },
  stopRecording: async () => {
    return ipcRenderer.invoke("recording:stop") as Promise<{
      ok: boolean;
      sessionId: string | null;
      stoppedAt: string;
      startedAt: string | null;
    }>;
  },
  saveRecording: async (sessionId: string, bytes: number[], suggestedName: string) => {
    return ipcRenderer.invoke("recording:save", { sessionId, bytes, suggestedName }) as Promise<
      | { ok: true; filePath: string }
      | { ok: false; reason: string }
    >;
  },
  listSessions: async () => {
    return ipcRenderer.invoke("sessions:list") as Promise<SessionRow[]>;
  },
  listSessionsByCategory: async (categoryId: string | null, limit = 200) => {
    return ipcRenderer.invoke("sessions:listByCategory", { categoryId, limit }) as Promise<SessionRow[]>;
  },
  getSessionDetail: async (sessionId: string) => {
    return ipcRenderer.invoke("sessions:getDetail", sessionId) as Promise<SessionDetail>;
  },
  rerunProcessing: async (sessionId: string) => {
    return ipcRenderer.invoke("processing:rerun", sessionId) as Promise<{ ok: boolean; reason?: string }>;
  },
  assignSessionCategory: async (sessionId: string, categoryId: string | null) => {
    return ipcRenderer.invoke("sessions:assignCategory", { sessionId, categoryId }) as Promise<{ ok: boolean; reason?: string }>;
  },
  deleteSession: async (sessionId: string) => {
    return ipcRenderer.invoke("sessions:delete", sessionId) as Promise<{ ok: boolean; reason?: string }>;
  },
  listCategories: async () => {
    return ipcRenderer.invoke("categories:list") as Promise<CategoryRow[]>;
  },
  createCategory: async (name: string) => {
    return ipcRenderer.invoke("categories:create", name) as Promise<
      | { ok: true; category: CategoryRow }
      | { ok: false; reason: string }
    >;
  },
  deleteCategory: async (categoryId: string) => {
    return ipcRenderer.invoke("categories:delete", categoryId) as Promise<{ ok: boolean; reason?: string }>;
  },
  searchContent: async (query: string, limit = 25) => {
    return ipcRenderer.invoke("search:content", { query, limit }) as Promise<SearchResultRow[]>;
  },
  askMemora: async (question: string, limit = 60) => {
    return ipcRenderer.invoke("ask:query", { question, limit }) as Promise<{
      answer: string;
      confidenceScore: number;
      confidenceLabel: "low" | "medium" | "high";
      citations: Array<{
        chunkId: string;
        sessionId: string;
        chunkType: "ocr" | "transcript";
        modality: "audio" | "visual-transcript" | "ocr";
        content: string;
        confidence: number;
        timestampSeconds: number | null;
        timestampLabel: string | null;
      }>;
    }>;
  },
  generateSessionSummary: async (sessionId: string) => {
    return ipcRenderer.invoke("sessions:generateSummary", sessionId) as Promise<{
      overview: string;
      keyPoints: string[];
      actionItems: string[];
    }>;
  },
  getSessionReplaySource: async (sessionId: string) => {
    return ipcRenderer.invoke("sessions:getReplaySource", sessionId) as Promise<
      | { ok: true; fileUrl: string }
      | { ok: false; reason: string }
    >;
  },
  prepareDisplayPicker: async () => {
    return ipcRenderer.invoke("ui:prepareDisplayPicker") as Promise<void>;
  },
  restoreAfterDisplayPicker: async () => {
    return ipcRenderer.invoke("ui:restoreAfterDisplayPicker") as Promise<void>;
  },
  listDisplaySources: async () => {
    return ipcRenderer.invoke("ui:listDisplaySources") as Promise<DisplaySourceRow[]>;
  },
  setPreferredDisplaySource: async (sourceId: string | null) => {
    return ipcRenderer.invoke("ui:setPreferredDisplaySource", sourceId) as Promise<{ ok: boolean }>;
  },
  getSettings: async () => {
    return ipcRenderer.invoke("settings:get") as Promise<AppSettings>;
  },
  updateSettings: async (updates: Partial<AppSettings>) => {
    return ipcRenderer.invoke("settings:update", updates) as Promise<{ ok: boolean; settings: AppSettings }>;
  },
  runBenchmark: async (questions: string[], limit: number) => {
    return ipcRenderer.invoke("benchmark:run", { questions, limit }) as Promise<{
      questionCount: number;
      avgConfidence: number;
      lowConfidenceCount: number;
      lowCoverageCount: number;
      results: Array<{
        question: string;
        confidenceScore: number;
        confidenceLabel: "low" | "medium" | "high";
        citationCount: number;
        modalityCoverage: Array<"audio" | "visual-transcript" | "ocr">;
        hasAudioEvidence: boolean;
        hasVisualEvidence: boolean;
      }>;
    }>;
  },
};

contextBridge.exposeInMainWorld("memora", api);
