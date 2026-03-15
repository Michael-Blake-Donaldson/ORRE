import { app, BrowserWindow, desktopCapturer, ipcMain, session } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { dialog } from "electron";
import { createDb, type MemoraStore, type SessionRow } from "./db.js";
import { ProcessingQueue } from "./processing.js";
import { buildAskMemoraAnswer } from "./qa.js";
import { buildSessionSummary } from "./summary.js";

type RecordingMode = "idle" | "session" | "clip" | "always-on";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let recordingMode: RecordingMode = "idle";
let recordingStartedAt: string | null = null;
let activeSessionId: string | null = null;
let preferredDisplaySourceId: string | null = null;
const store = createDb(app.getPath("userData")) as MemoraStore;
const processingQueue = new ProcessingQueue(store);

type AppSettings = {
  defaultMode: "session" | "clip" | "always-on";
  sourceStrategy: "remember-last" | "system-picker";
  askLimit: number;
  benchmarkQuestions: string;
  benchmarkLimit: number;
};

const DEFAULT_SETTINGS: AppSettings = {
  defaultMode: "session",
  sourceStrategy: "remember-last",
  askLimit: 60,
  benchmarkQuestions: [
    "What were the top 3 action items discussed?",
    "What apps or tools were used most recently?",
    "Summarize the latest decision that was made.",
  ].join("\n"),
  benchmarkLimit: 80,
};

function parseSettings(raw: Record<string, unknown>): AppSettings {
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...raw,
  } as AppSettings;

  if (!["session", "clip", "always-on"].includes(merged.defaultMode)) {
    merged.defaultMode = DEFAULT_SETTINGS.defaultMode;
  }

  if (!["remember-last", "system-picker"].includes(merged.sourceStrategy)) {
    merged.sourceStrategy = DEFAULT_SETTINGS.sourceStrategy;
  }

  merged.askLimit = Number.isFinite(Number(merged.askLimit)) ? Math.min(120, Math.max(20, Number(merged.askLimit))) : 60;
  merged.benchmarkLimit = Number.isFinite(Number(merged.benchmarkLimit))
    ? Math.min(140, Math.max(20, Number(merged.benchmarkLimit)))
    : 80;

  if (typeof merged.benchmarkQuestions !== "string") {
    merged.benchmarkQuestions = DEFAULT_SETTINGS.benchmarkQuestions;
  }

  return merged;
}

function runBenchmark(questionList: string[], limit: number) {
  const questions = questionList.map((q) => q.trim()).filter((q) => q.length >= 4);

  const results = questions.map((question) => {
    const primaryRows = store.searchExtractedContent(question, limit);
    const transcriptRows = store.listRecentExtractedRows(limit * 2, "transcript");
    const ocrRows = store.listRecentExtractedRows(limit * 2, "ocr");

    const mergedMap = new Map<string, (typeof primaryRows)[number]>();
    for (const row of [...primaryRows, ...transcriptRows, ...ocrRows]) {
      if (!mergedMap.has(row.chunk_id)) {
        mergedMap.set(row.chunk_id, row);
      }
    }

    const answer = buildAskMemoraAnswer(question, [...mergedMap.values()]);
    const modalities = [...new Set(answer.citations.map((citation) => citation.modality))];

    return {
      question,
      confidenceScore: answer.confidenceScore,
      confidenceLabel: answer.confidenceLabel,
      citationCount: answer.citations.length,
      modalityCoverage: modalities,
      hasAudioEvidence: modalities.includes("audio"),
      hasVisualEvidence: modalities.includes("visual-transcript") || modalities.includes("ocr"),
    };
  });

  const avgConfidence =
    results.length > 0
      ? results.reduce((total, result) => total + result.confidenceScore, 0) / results.length
      : 0;

  const lowConfidenceCount = results.filter((result) => result.confidenceLabel === "low").length;
  const lowCoverageCount = results.filter((result) => !result.hasAudioEvidence || !result.hasVisualEvidence).length;

  return {
    questionCount: questions.length,
    avgConfidence,
    lowConfidenceCount,
    lowCoverageCount,
    results,
  };
}

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
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (request.videoRequested) {
        const sources = await getAvailableDisplaySources();

        const preferredSource =
          (preferredDisplaySourceId ? sources.find((source) => source.id === preferredDisplaySourceId) : null) ??
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
    },
  );

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

ipcMain.handle("recording:save", async (_event, payload: { sessionId: string; bytes: number[]; suggestedName: string }) => {
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
  const rows = store.listSessions(20) as SessionRow[];

  return rows;
});

ipcMain.handle("sessions:listByCategory", async (_event, payload: { categoryId: string | null; limit?: number }) => {
  return store.listSessionsByCategory(payload.categoryId ?? null, payload.limit ?? 200);
});

ipcMain.handle("sessions:getDetail", async (_event, sessionId: string) => {
  return store.getSessionDetail(sessionId);
});

ipcMain.handle("processing:rerun", async (_event, sessionId: string) => {
  const session = store.getSessionById(sessionId);

  if (!session?.file_path) {
    return { ok: false, reason: "missing-file" };
  }

  const enqueued = processingQueue.enqueue({ sessionId, filePath: session.file_path });
  if (!enqueued) {
    return { ok: false, reason: "already-processing" };
  }

  return { ok: true };
});

ipcMain.handle("settings:get", async () => {
  return parseSettings(store.getSettings());
});

ipcMain.handle("settings:update", async (_event, updates: Partial<AppSettings>) => {
  const current = parseSettings(store.getSettings());
  const next = parseSettings({ ...current, ...updates });
  store.updateSettings(next as Record<string, unknown>);
  return { ok: true, settings: next };
});

ipcMain.handle("benchmark:run", async (_event, payload: { questions: string[]; limit: number }) => {
  return runBenchmark(payload.questions, payload.limit);
});

ipcMain.handle("sessions:assignCategory", async (_event, payload: { sessionId: string; categoryId: string | null }) => {
  try {
    store.assignSessionCategory(payload.sessionId, payload.categoryId);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "assign-failed" };
  }
});

ipcMain.handle("sessions:delete", async (_event, sessionId: string) => {
  store.deleteSession(sessionId);
  return { ok: true };
});

ipcMain.handle("categories:list", async () => {
  return store.listCategories();
});

ipcMain.handle("categories:create", async (_event, name: string) => {
  try {
    const row = store.createCategory(name);
    return { ok: true, category: row };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "create-category-failed" };
  }
});

ipcMain.handle("categories:delete", async (_event, categoryId: string) => {
  store.deleteCategory(categoryId);
  return { ok: true };
});

ipcMain.handle("search:content", async (_event, payload: { query: string; limit?: number }) => {
  return store.searchExtractedContent(payload.query, payload.limit ?? 25);
});

ipcMain.handle("ask:query", async (_event, payload: { question: string; limit?: number }) => {
  const primaryRows = store.searchExtractedContent(payload.question, payload.limit ?? 80);
  const transcriptRows = store.listRecentExtractedRows(220, "transcript");
  const ocrRows = store.listRecentExtractedRows(220, "ocr");

  const mergedMap = new Map<string, (typeof primaryRows)[number]>();
  for (const row of [...primaryRows, ...transcriptRows, ...ocrRows]) {
    if (!mergedMap.has(row.chunk_id)) {
      mergedMap.set(row.chunk_id, row);
    }
  }

  const merged = [...mergedMap.values()];

  return buildAskMemoraAnswer(payload.question, merged);
});

ipcMain.handle("sessions:generateSummary", async (_event, sessionId: string) => {
  const detail = store.getSessionDetail(sessionId);
  const summary = buildSessionSummary(detail.chunks);
  return summary;
});

ipcMain.handle("sessions:getReplaySource", async (_event, sessionId: string) => {
  const sessionRow = store.getSessionById(sessionId);

  if (!sessionRow?.file_path) {
    return { ok: false, reason: "missing-file" };
  }

  try {
    await fs.access(sessionRow.file_path);
  } catch {
    return { ok: false, reason: "file-not-found" };
  }

  return {
    ok: true,
    fileUrl: pathToFileURL(sessionRow.file_path).toString(),
  };
});

ipcMain.handle("ui:listDisplaySources", async () => {
  const sources = await getAvailableDisplaySources();

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.id.startsWith("screen:") ? "screen" : "window",
  }));
});

ipcMain.handle("ui:setPreferredDisplaySource", async (_event, sourceId: string | null) => {
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
