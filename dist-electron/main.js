import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { dialog } from "electron";
import { createDb } from "./db.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let recordingMode = "idle";
let recordingStartedAt = null;
let activeSessionId = null;
const db = createDb(app.getPath("userData"));
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
        },
    });
    mainWindow.loadFile(path.resolve(__dirname, "../app/index.html"));
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
app.whenReady().then(() => {
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
    db.prepare(`INSERT INTO sessions (id, mode, started_at, status, created_at)
      VALUES (@id, @mode, @started_at, @status, @created_at)`).run({
        id: activeSessionId,
        mode,
        started_at: recordingStartedAt,
        status: "recording",
        created_at: recordingStartedAt,
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
    if (activeSessionId) {
        db.prepare(`UPDATE sessions
       SET stopped_at = @stopped_at, status = @status
       WHERE id = @id`).run({
            id: activeSessionId,
            stopped_at: stoppedAt,
            status: "stopped",
        });
    }
    const response = {
        ok: true,
        sessionId: activeSessionId,
        stoppedAt,
        startedAt: recordingStartedAt,
    };
    recordingStartedAt = null;
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
    if (activeSessionId) {
        db.prepare(`UPDATE sessions
       SET file_path = @file_path, status = @status
       WHERE id = @id`).run({
            id: activeSessionId,
            file_path: result.filePath,
            status: "saved",
        });
    }
    activeSessionId = null;
    return { ok: true, filePath: result.filePath };
});
ipcMain.handle("sessions:list", async () => {
    const rows = db.prepare(`SELECT id, mode, started_at, stopped_at, file_path, status, created_at
     FROM sessions
     ORDER BY started_at DESC
     LIMIT 20`).all();
    return rows;
});
