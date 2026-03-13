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
  saveRecording: async (bytes: number[], suggestedName: string) => {
    return ipcRenderer.invoke("recording:save", { bytes, suggestedName }) as Promise<
      | { ok: true; filePath: string }
      | { ok: false; reason: string }
    >;
  },
  listSessions: async () => {
    return ipcRenderer.invoke("sessions:list") as Promise<SessionRow[]>;
  },
};

contextBridge.exposeInMainWorld("memora", api);
