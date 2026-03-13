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
    saveRecording: async (bytes, suggestedName) => {
        return ipcRenderer.invoke("recording:save", { bytes, suggestedName });
    },
    listSessions: async () => {
        return ipcRenderer.invoke("sessions:list");
    },
};
contextBridge.exposeInMainWorld("memora", api);
