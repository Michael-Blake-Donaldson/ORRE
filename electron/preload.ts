import { contextBridge, ipcRenderer } from "electron";

type RecordingMode = "idle" | "session" | "clip" | "always-on";

type SessionRow = {
  id: string;
  mode: string;
  started_at: string;
  stopped_at: string | null;
  file_path: string | null;
  status: "recording" | "stopped" | "saved" | "discarded";
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
};

const api = {
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
  getSessionDetail: async (sessionId: string) => {
    return ipcRenderer.invoke("sessions:getDetail", sessionId) as Promise<SessionDetail>;
  },
  rerunProcessing: async (sessionId: string) => {
    return ipcRenderer.invoke("processing:rerun", sessionId) as Promise<{ ok: boolean; reason?: string }>;
  },
};

contextBridge.exposeInMainWorld("memora", api);
