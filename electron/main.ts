import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { dialog } from "electron";

type RecordingMode = "idle" | "session" | "clip" | "always-on";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let recordingMode: RecordingMode = "idle";
let recordingStartedAt: string | null = null;

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

ipcMain.handle("recording:start", async (_event, mode: RecordingMode) => {
  recordingMode = mode;
  recordingStartedAt = new Date().toISOString();

  return {
    ok: true,
    mode: recordingMode,
    startedAt: recordingStartedAt,
  };
});

ipcMain.handle("recording:stop", async () => {
  recordingMode = "idle";
  const stoppedAt = new Date().toISOString();

  const response = {
    ok: true,
    stoppedAt,
    startedAt: recordingStartedAt,
  };

  recordingStartedAt = null;

  return response;
});

ipcMain.handle("recording:save", async (_event, payload: { bytes: number[]; suggestedName: string }) => {
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

  return { ok: true, filePath: result.filePath };
});
