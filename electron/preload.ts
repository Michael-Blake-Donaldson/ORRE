import { contextBridge, ipcRenderer } from "electron";

type RecordingMode = "idle" | "session" | "clip" | "always-on";

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
      mode: RecordingMode;
      startedAt: string;
    }>;
  },
  stopRecording: async () => {
    return ipcRenderer.invoke("recording:stop") as Promise<{
      ok: boolean;
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
};

contextBridge.exposeInMainWorld("memora", api);
