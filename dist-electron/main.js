import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let recordingMode = "idle";
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
    return {
        ok: true,
        mode: recordingMode,
        startedAt: new Date().toISOString(),
    };
});
ipcMain.handle("recording:stop", async () => {
    recordingMode = "idle";
    return {
        ok: true,
        stoppedAt: new Date().toISOString(),
    };
});
