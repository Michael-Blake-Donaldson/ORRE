import { app, BrowserWindow, desktopCapturer, ipcMain, session } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { dialog } from "electron";
import { createDb } from "./db.js";
import { ProcessingQueue } from "./processing.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let recordingMode = "idle";
let recordingStartedAt = null;
let activeSessionId = null;
let preferredDisplaySourceId = null;
const store = createDb(app.getPath("userData"));
const processingQueue = new ProcessingQueue(store);
async function getAvailableDisplaySources() {
    const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 180 },
    });
    if (sources.length > 0) {
        return sources;
    }
    // Retry with screen-only for environments where window listing can fail.
    return desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 320, height: 180 },
    });
}
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 1100,
        minHeight: 700,
        title: "Memora",
        backgroundColor: "#0f1218",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    mainWindow.loadFile(path.resolve(__dirname, "../app/index.html"));
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
app.whenReady().then(() => {
    // Route display capture through an app-selected source when provided.
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        if (request.videoRequested) {
            const sources = await getAvailableDisplaySources();
            const preferredSource = (preferredDisplaySourceId ? sources.find((source) => source.id === preferredDisplaySourceId) : null) ??
                sources.find((source) => source.id.startsWith("screen:")) ??
                sources[0];
            if (!preferredSource) {
                callback({});
                return;
            }
            callback({
                video: preferredSource,
                audio: request.audioRequested ? "loopback" : undefined,
            });
            return;
        }
        callback({});
    });
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
ipcMain.handle("recording:getState", async () => {
    return {
        mode: recordingMode,
        isRecording: recordingMode !== "idle",
    };
});
ipcMain.handle("recording:start", async (_event, mode) => {
    recordingMode = mode;
    recordingStartedAt = new Date().toISOString();
    activeSessionId = crypto.randomUUID();
    store.createSession({
        id: activeSessionId,
        mode: mode,
        startedAt: recordingStartedAt,
    });
    return {
        ok: true,
        sessionId: activeSessionId,
        mode: recordingMode,
        startedAt: recordingStartedAt,
    };
});
ipcMain.handle("recording:stop", async () => {
    recordingMode = "idle";
    const stoppedAt = new Date().toISOString();
    const stoppedSessionId = activeSessionId;
    if (stoppedSessionId) {
        store.stopSession({
            id: stoppedSessionId,
            stoppedAt,
        });
    }
    const response = {
        ok: true,
        sessionId: stoppedSessionId,
        stoppedAt,
        startedAt: recordingStartedAt,
    };
    // Reset active pointers once stop is acknowledged.
    recordingStartedAt = null;
    activeSessionId = null;
    return response;
});
ipcMain.handle("recording:save", async (_event, payload) => {
    if (!mainWindow) {
        return { ok: false, reason: "window-unavailable" };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
        title: "Save Memora Recording",
        defaultPath: payload.suggestedName,
        filters: [{ name: "WebM Video", extensions: ["webm"] }],
    });
    if (result.canceled || !result.filePath) {
        return { ok: false, reason: "cancelled" };
    }
    await fs.writeFile(result.filePath, Buffer.from(payload.bytes));
    store.markSessionSaved({
        id: payload.sessionId,
        filePath: result.filePath,
    });
    // Queue asynchronous extraction work so UI is responsive.
    processingQueue.enqueue({ sessionId: payload.sessionId, filePath: result.filePath });
    return { ok: true, filePath: result.filePath };
});
ipcMain.handle("sessions:list", async () => {
    const rows = store.listSessions(20);
    return rows;
});
ipcMain.handle("sessions:getDetail", async (_event, sessionId) => {
    return store.getSessionDetail(sessionId);
});
ipcMain.handle("processing:rerun", async (_event, sessionId) => {
    const session = store.getSessionById(sessionId);
    if (!session?.file_path) {
        return { ok: false, reason: "missing-file" };
    }
    processingQueue.enqueue({ sessionId, filePath: session.file_path });
    return { ok: true };
});
ipcMain.handle("search:content", async (_event, payload) => {
    return store.searchExtractedContent(payload.query, payload.limit ?? 25);
});
ipcMain.handle("ui:listDisplaySources", async () => {
    const sources = await getAvailableDisplaySources();
    return sources.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.id.startsWith("screen:") ? "screen" : "window",
    }));
});
ipcMain.handle("ui:setPreferredDisplaySource", async (_event, sourceId) => {
    preferredDisplaySourceId = sourceId;
    return { ok: true };
});
ipcMain.handle("ui:prepareDisplayPicker", async () => {
    if (!mainWindow) {
        return;
    }
    // Minimizing helps ensure OS picker is visible and not hidden behind the app.
    mainWindow.minimize();
});
ipcMain.handle("ui:restoreAfterDisplayPicker", async () => {
    if (!mainWindow) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.focus();
});
