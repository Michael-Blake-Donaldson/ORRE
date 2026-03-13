import { contextBridge, ipcRenderer } from "electron";
const api = {
    getRecordingState: async () => {
        return ipcRenderer.invoke("recording:getState");
    },
    startRecording: async (mode) => {
        return ipcRenderer.invoke("recording:start", mode);
    },
    stopRecording: async () => {
        return ipcRenderer.invoke("recording:stop");
    },
    saveRecording: async (sessionId, bytes, suggestedName) => {
        return ipcRenderer.invoke("recording:save", { sessionId, bytes, suggestedName });
    },
    listSessions: async () => {
        return ipcRenderer.invoke("sessions:list");
    },
    getSessionDetail: async (sessionId) => {
        return ipcRenderer.invoke("sessions:getDetail", sessionId);
    },
    rerunProcessing: async (sessionId) => {
        return ipcRenderer.invoke("processing:rerun", sessionId);
    },
    searchContent: async (query, limit = 25) => {
        return ipcRenderer.invoke("search:content", { query, limit });
    },
};
contextBridge.exposeInMainWorld("memora", api);
