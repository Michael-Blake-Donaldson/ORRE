import { contextBridge, ipcRenderer } from "electron";
const api = {
    getCurrentUser: async () => {
        return ipcRenderer.invoke("auth:getCurrentUser");
    },
    registerUser: async (payload) => {
        return ipcRenderer.invoke("auth:register", payload);
    },
    loginUser: async (payload) => {
        return ipcRenderer.invoke("auth:login", payload);
    },
    logoutUser: async () => {
        return ipcRenderer.invoke("auth:logout");
    },
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
    listSessionsByCategory: async (categoryId, limit = 200) => {
        return ipcRenderer.invoke("sessions:listByCategory", { categoryId, limit });
    },
    getSessionDetail: async (sessionId) => {
        return ipcRenderer.invoke("sessions:getDetail", sessionId);
    },
    rerunProcessing: async (sessionId) => {
        return ipcRenderer.invoke("processing:rerun", sessionId);
    },
    assignSessionCategory: async (sessionId, categoryId) => {
        return ipcRenderer.invoke("sessions:assignCategory", { sessionId, categoryId });
    },
    deleteSession: async (sessionId) => {
        return ipcRenderer.invoke("sessions:delete", sessionId);
    },
    listCategories: async () => {
        return ipcRenderer.invoke("categories:list");
    },
    createCategory: async (name) => {
        return ipcRenderer.invoke("categories:create", name);
    },
    deleteCategory: async (categoryId) => {
        return ipcRenderer.invoke("categories:delete", categoryId);
    },
    searchContent: async (query, limit = 25) => {
        return ipcRenderer.invoke("search:content", { query, limit });
    },
    askMemora: async (question, limit = 60) => {
        return ipcRenderer.invoke("ask:query", { question, limit });
    },
    generateSessionSummary: async (sessionId) => {
        return ipcRenderer.invoke("sessions:generateSummary", sessionId);
    },
    getSessionReplaySource: async (sessionId) => {
        return ipcRenderer.invoke("sessions:getReplaySource", sessionId);
    },
    prepareDisplayPicker: async () => {
        return ipcRenderer.invoke("ui:prepareDisplayPicker");
    },
    restoreAfterDisplayPicker: async () => {
        return ipcRenderer.invoke("ui:restoreAfterDisplayPicker");
    },
    listDisplaySources: async () => {
        return ipcRenderer.invoke("ui:listDisplaySources");
    },
    setPreferredDisplaySource: async (sourceId) => {
        return ipcRenderer.invoke("ui:setPreferredDisplaySource", sourceId);
    },
    getSettings: async () => {
        return ipcRenderer.invoke("settings:get");
    },
    updateSettings: async (updates) => {
        return ipcRenderer.invoke("settings:update", updates);
    },
    runBenchmark: async (questions, limit) => {
        return ipcRenderer.invoke("benchmark:run", { questions, limit });
    },
};
contextBridge.exposeInMainWorld("memora", api);
