const recordingBadge = document.getElementById("recordingBadge");
const recordingSignal = document.getElementById("recordingSignal");
const recordingSignalText = document.getElementById("recordingSignalText");
const recordingTimer = document.getElementById("recordingTimer");
const statusText = document.getElementById("statusText");
const modeSelect = document.getElementById("modeSelect");
const sourceSelect = document.getElementById("sourceSelect");
const refreshSourcesBtn = document.getElementById("refreshSourcesBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const recentSessions = document.getElementById("recentSessions");
const rerunBtn = document.getElementById("rerunBtn");
const generateSummaryBtn = document.getElementById("generateSummaryBtn");
const replayBtn = document.getElementById("replayBtn");
const replayStatus = document.getElementById("replayStatus");
const replayPlayer = document.getElementById("replayPlayer");
const sessionSummary = document.getElementById("sessionSummary");
const filterAllBtn = document.getElementById("filterAllBtn");
const filterOcrBtn = document.getElementById("filterOcrBtn");
const filterTranscriptBtn = document.getElementById("filterTranscriptBtn");
const transcriptFilterAllBtn = document.getElementById("transcriptFilterAllBtn");
const transcriptFilterAudioBtn = document.getElementById("transcriptFilterAudioBtn");
const transcriptFilterVisualBtn = document.getElementById("transcriptFilterVisualBtn");
const copyTranscriptBtn = document.getElementById("copyTranscriptBtn");
const exportTranscriptBtn = document.getElementById("exportTranscriptBtn");
const sessionTranscript = document.getElementById("sessionTranscript");
const transcriptSearchInput = document.getElementById("transcriptSearchInput");
const transcriptPrevBtn = document.getElementById("transcriptPrevBtn");
const transcriptNextBtn = document.getElementById("transcriptNextBtn");
const transcriptClearBtn = document.getElementById("transcriptClearBtn");
const transcriptSearchStatus = document.getElementById("transcriptSearchStatus");
const sessionDetailTitle = document.getElementById("sessionDetailTitle");
const sessionDetailSubtitle = document.getElementById("sessionDetailSubtitle");
const processingJobs = document.getElementById("processingJobs");
const extractedChunks = document.getElementById("extractedChunks");
const grantScreenBtn = document.getElementById("grantScreenBtn");
const grantMicBtn = document.getElementById("grantMicBtn");
const screenPermissionStatus = document.getElementById("screenPermissionStatus");
const micPermissionStatus = document.getElementById("micPermissionStatus");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const searchResults = document.getElementById("searchResults");
const navButtons = Array.from(document.querySelectorAll(".nav-item[data-target]"));
const diagBridgeLoaded = document.getElementById("diagBridgeLoaded");
const diagSourceCount = document.getElementById("diagSourceCount");
const diagSelectedSource = document.getElementById("diagSelectedSource");
const diagLastError = document.getElementById("diagLastError");

const diagnostics = {
  bridgeLoaded: false,
  sourceCount: 0,
  selectedSource: "none",
  lastCaptureError: "none",
};

function refreshDiagnosticsUI() {
  if (diagBridgeLoaded) {
    diagBridgeLoaded.textContent = diagnostics.bridgeLoaded ? "true" : "false";
  }

  if (diagSourceCount) {
    diagSourceCount.textContent = String(diagnostics.sourceCount);
  }

  if (diagSelectedSource) {
    diagSelectedSource.textContent = diagnostics.selectedSource;
  }

  if (diagLastError) {
    diagLastError.textContent = diagnostics.lastCaptureError;
  }
}

function setupNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-target");
      const target = targetId ? document.getElementById(targetId) : null;

      navButtons.forEach((item) => item.classList.remove("nav-item--active"));
      button.classList.add("nav-item--active");

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function getMemoraApi() {
  if (window.memora) {
    diagnostics.bridgeLoaded = true;
    refreshDiagnosticsUI();
    return window.memora;
  }

  diagnostics.bridgeLoaded = false;
  diagnostics.lastCaptureError = "bridge-unavailable";
  refreshDiagnosticsUI();

  statusText.textContent = "Desktop bridge failed to load. Restart Memora from terminal with npm run dev.";

  if (startBtn) {
    startBtn.disabled = true;
  }

  if (stopBtn) {
    stopBtn.disabled = true;
  }

  if (sourceSelect) {
    sourceSelect.disabled = true;
    sourceSelect.innerHTML = "<option value=\"\">Bridge unavailable</option>";
  }

  return null;
}

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let selectedSessionId = null;
let detailPollInterval = null;
let recordingStartedMs = null;
let recordingTimerInterval = null;
let selectedDisplaySourceId = null;
let currentSessionDetail = null;
let activeChunkFilter = "all";
let currentTranscriptSegments = [];
let transcriptMatchIndexes = [];
let transcriptMatchCursor = -1;
let activeTranscriptSourceFilter = "all";
let replaySourceSessionId = null;

const permissionState = {
  screen: localStorage.getItem("memora-permission-screen") === "granted" ? "granted" : "unknown",
  mic: localStorage.getItem("memora-permission-mic") === "granted" ? "granted" : "unknown",
};

let pendingPickerHintTimeout = null;

const SYSTEM_PICKER_VALUE = "__system_picker__";

function persistPermissionState(key, state) {
  if (state === "granted") {
    localStorage.setItem(`memora-permission-${key}`, "granted");
    return;
  }

  // Do not persist negative states so users are not stuck in a stale "denied" UI.
  localStorage.removeItem(`memora-permission-${key}`);
}

function setPermissionStatus(element, state) {
  if (!element) {
    return;
  }

  element.classList.remove("status-inline--ok", "status-inline--warn", "status-inline--error");

  if (state === "granted") {
    element.textContent = "Granted";
    element.classList.add("status-inline--ok");
    return;
  }

  if (state === "denied") {
    element.textContent = "Denied";
    element.classList.add("status-inline--error");
    return;
  }

  element.textContent = "Unknown";
  element.classList.add("status-inline--warn");
}

function refreshPermissionUI() {
  setPermissionStatus(screenPermissionStatus, permissionState.screen);
  setPermissionStatus(micPermissionStatus, permissionState.mic);
}

async function refreshDisplaySources() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  if (!sourceSelect) {
    return;
  }

  const sources = await api.listDisplaySources();
  diagnostics.sourceCount = sources.length;

  const options = [
    `<option value="${SYSTEM_PICKER_VALUE}">Use system picker (manual choose each start)</option>`,
    ...sources.map((source) => {
      const prefix = source.type === "screen" ? "Screen" : "Window";
      const label = source.name?.trim() ? source.name : "Untitled";
      return `<option value="${source.id}">${prefix}: ${label}</option>`;
    }),
  ];

  sourceSelect.disabled = false;
  sourceSelect.innerHTML = options.join("");

  if (!sources.length) {
    statusText.textContent = "No screens/windows detected. Switch to system picker mode or click Refresh.";
  }

  const fallbackSourceId = sources[0]?.id ?? SYSTEM_PICKER_VALUE;
  const resolvedSourceId =
    selectedDisplaySourceId && sources.some((source) => source.id === selectedDisplaySourceId)
      ? selectedDisplaySourceId
      : fallbackSourceId;

  sourceSelect.value = resolvedSourceId;
  selectedDisplaySourceId = resolvedSourceId === SYSTEM_PICKER_VALUE ? null : resolvedSourceId;
  diagnostics.selectedSource = selectedDisplaySourceId ?? "system-picker";
  refreshDiagnosticsUI();
  await api.setPreferredDisplaySource(selectedDisplaySourceId);
}

async function requestScreenPermission() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    stream.getTracks().forEach((track) => track.stop());
    permissionState.screen = "granted";
    persistPermissionState("screen", "granted");
    refreshPermissionUI();
    return { granted: true, reason: "granted" };
  } catch (error) {
    diagnostics.lastCaptureError = error?.name ?? "capture-start-failed";
    refreshDiagnosticsUI();

    permissionState.screen = error?.name === "NotAllowedError" ? "denied" : "unknown";
    persistPermissionState("screen", permissionState.screen);
    refreshPermissionUI();
    return { granted: false, reason: error?.name ?? "unknown" };
  }

  diagnostics.lastCaptureError = "none";
  refreshDiagnosticsUI();
}

async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
    permissionState.mic = "granted";
    persistPermissionState("mic", "granted");
    refreshPermissionUI();
    return { granted: true, reason: "granted" };
  } catch (error) {
    permissionState.mic = error?.name === "NotAllowedError" ? "denied" : "unknown";
    persistPermissionState("mic", permissionState.mic);
    refreshPermissionUI();
    return { granted: false, reason: error?.name ?? "unknown" };
  }
}

function makeSuggestedFilename(startedAt) {
  const safeDate = new Date(startedAt).toISOString().replaceAll(":", "-");
  return `memora-session-${safeDate}.webm`;
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function setRecordingSignal(state, text) {
  if (!recordingSignal || !recordingSignalText) {
    return;
  }

  recordingSignal.classList.remove("recording-signal--idle", "recording-signal--pending", "recording-signal--recording");
  recordingSignal.classList.add(`recording-signal--${state}`);
  recordingSignalText.textContent = text;
}

function stopRecordingTimer() {
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }

  recordingStartedMs = null;
  if (recordingTimer) {
    recordingTimer.textContent = "00:00";
  }
}

function startRecordingTimer() {
  stopRecordingTimer();
  recordingStartedMs = Date.now();

  const tick = () => {
    if (!recordingTimer || !recordingStartedMs) {
      return;
    }
    recordingTimer.textContent = formatElapsed(Date.now() - recordingStartedMs);
  };

  tick();
  recordingTimerInterval = setInterval(tick, 1000);
}

function stopDetailPolling() {
  if (detailPollInterval) {
    clearInterval(detailPollInterval);
    detailPollInterval = null;
  }
}

function startDetailPolling() {
  stopDetailPolling();

  // Poll only for active jobs to avoid unnecessary IPC chatter.
  detailPollInterval = setInterval(() => {
    void refreshSelectedSessionDetail();
  }, 1500);
}

function createStatusChip(status) {
  const className = `chip chip--${status}`;
  return `<span class="${className}">${status}</span>`;
}

function setActiveTranscriptSourceFilter(nextFilter) {
  activeTranscriptSourceFilter = nextFilter;

  const filterMap = [
    [transcriptFilterAllBtn, "all"],
    [transcriptFilterAudioBtn, "audio"],
    [transcriptFilterVisualBtn, "visual"],
  ];

  filterMap.forEach(([button, value]) => {
    if (!button) {
      return;
    }

    button.classList.toggle("button--primary", value === nextFilter);
  });
}

function setActiveChunkFilter(nextFilter) {
  activeChunkFilter = nextFilter;

  const filterMap = [
    [filterAllBtn, "all"],
    [filterOcrBtn, "ocr"],
    [filterTranscriptBtn, "transcript"],
  ];

  filterMap.forEach(([button, value]) => {
    if (!button) {
      return;
    }

    button.classList.toggle("button--primary", value === nextFilter);
  });
}

function buildTranscriptText(chunks) {
  const transcriptLines = extractTranscriptSegments(chunks)
    .filter((segment) => activeTranscriptSourceFilter === "all" || segment.source === activeTranscriptSourceFilter)
    .map((segment) => `[${segment.source.toUpperCase()} ${segment.timestamp}] ${segment.text}`);

  if (!transcriptLines.length) {
    return "Transcript is not ready yet. Save a recording and wait for processing to complete.";
  }

  return transcriptLines.join("\n");
}

function extractTranscriptSegments(chunks) {
  return chunks
    .filter((chunk) => chunk.chunk_type === "transcript")
    .map((chunk) => chunk.content.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const typedMatch = line.match(/^\[(AUDIO|VISUAL)\s+(\d{2}:\d{2})\]\s*(.*)$/i);
      if (typedMatch) {
        return {
          lineIndex: index,
          source: typedMatch[1].toLowerCase(),
          timestamp: typedMatch[2],
          text: typedMatch[3] || "",
        };
      }

      const genericMatch = line.match(/^\[(\d{2}:\d{2})\]\s*(.*)$/);
      if (genericMatch) {
        return {
          lineIndex: index,
          source: "visual",
          timestamp: genericMatch[1],
          text: genericMatch[2] || "",
        };
      }

      return {
        lineIndex: index,
        source: "visual",
        timestamp: "00:00",
        text: line,
      };
    });
}

function setTranscriptSearchStatus(text) {
  if (transcriptSearchStatus) {
    transcriptSearchStatus.textContent = text;
  }
}

function jumpToTranscriptLine(lineIndex, reason = "jump") {
  if (!sessionTranscript) {
    return;
  }

  const target = sessionTranscript.querySelector(`[data-line-index="${lineIndex}"]`);
  if (!target) {
    return;
  }

  sessionTranscript.querySelectorAll(".transcript-line--current").forEach((node) => {
    node.classList.remove("transcript-line--current");
  });

  target.classList.add("transcript-line--current");
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const segment = currentTranscriptSegments.find((item) => item.lineIndex === lineIndex);
  if (segment) {
    if (reason === "search") {
      setTranscriptSearchStatus(`Jumped to ${segment.timestamp}.`);
      return;
    }

    statusText.textContent = `Transcript jump: ${segment.timestamp}`;
  }
}

function refreshTranscriptMatches(query) {
  transcriptMatchIndexes = [];
  transcriptMatchCursor = -1;

  if (!sessionTranscript) {
    return;
  }

  const normalized = query.trim().toLowerCase();
  const rows = Array.from(sessionTranscript.querySelectorAll(".transcript-line"));

  rows.forEach((row, visualIndex) => {
    row.classList.remove("transcript-line--match", "transcript-line--current");

    if (!normalized) {
      return;
    }

    const segment = currentTranscriptSegments[visualIndex];
    if (!segment) {
      return;
    }

    const haystack = `${segment.source} ${segment.timestamp} ${segment.text}`.toLowerCase();
    if (haystack.includes(normalized)) {
      row.classList.add("transcript-line--match");
      transcriptMatchIndexes.push(segment.lineIndex);
    }
  });

  if (!normalized) {
    setTranscriptSearchStatus("No active transcript search.");
    return;
  }

  if (!transcriptMatchIndexes.length) {
    setTranscriptSearchStatus("No transcript matches found.");
    return;
  }

  transcriptMatchCursor = 0;
  jumpToTranscriptLine(transcriptMatchIndexes[0], "search");
  setTranscriptSearchStatus(`Match 1 of ${transcriptMatchIndexes.length}.`);
}

function stepTranscriptMatch(direction) {
  if (!transcriptMatchIndexes.length) {
    setTranscriptSearchStatus("No transcript matches to navigate.");
    return;
  }

  transcriptMatchCursor = (transcriptMatchCursor + direction + transcriptMatchIndexes.length) % transcriptMatchIndexes.length;
  const nextLineIndex = transcriptMatchIndexes[transcriptMatchCursor];
  jumpToTranscriptLine(nextLineIndex, "search");
  setTranscriptSearchStatus(`Match ${transcriptMatchCursor + 1} of ${transcriptMatchIndexes.length}.`);
}

function renderExtractedChunksList(chunks) {
  if (!extractedChunks) {
    return;
  }

  const filtered =
    activeChunkFilter === "all" ? chunks : chunks.filter((chunk) => chunk.chunk_type === activeChunkFilter);

  if (!filtered.length) {
    extractedChunks.innerHTML = "<li>No chunks match the selected filter yet.</li>";
    return;
  }

  extractedChunks.innerHTML = filtered
    .map((chunk) => {
      const confidence = Math.round(chunk.confidence * 100);
      return `<li><div class="meta">${chunk.chunk_type} • ${confidence}% confidence</div><div>${chunk.content}</div></li>`;
    })
    .join("");
}

function renderTranscript(detail) {
  if (!sessionTranscript) {
    return;
  }

  currentTranscriptSegments = extractTranscriptSegments(detail.chunks);

  const visibleTranscriptSegments = currentTranscriptSegments.filter(
    (segment) => activeTranscriptSourceFilter === "all" || segment.source === activeTranscriptSourceFilter,
  );

  if (!visibleTranscriptSegments.length) {
    sessionTranscript.textContent = "Transcript is not ready yet. Save a recording and wait for processing to complete.";
    if (currentTranscriptSegments.length) {
      setTranscriptSearchStatus("No transcript lines for the selected source filter.");
    } else {
      setTranscriptSearchStatus("No transcript lines available yet.");
    }
    return;
  }

  sessionTranscript.innerHTML = visibleTranscriptSegments
    .map((segment) => {
      const sourceClass = segment.source === "audio" ? "transcript-source--audio" : "transcript-source--visual";
      const sourceLabel = segment.source === "audio" ? "Audio" : "Visual";
      return `<div class="transcript-line" data-line-index="${segment.lineIndex}"><span class="transcript-source ${sourceClass}">${sourceLabel}</span><span class="transcript-ts">[${segment.timestamp}]</span><span>${segment.text}</span></div>`;
    })
    .join("");

  sessionTranscript.querySelectorAll(".transcript-line").forEach((node) => {
    node.addEventListener("click", () => {
      const indexText = node.getAttribute("data-line-index");
      if (indexText) {
        jumpToTranscriptLine(Number(indexText), "click");
      }
    });
  });

  const activeQuery = transcriptSearchInput?.value?.trim() ?? "";
  if (activeQuery) {
    refreshTranscriptMatches(activeQuery);
    return;
  }

  setTranscriptSearchStatus("No active transcript search.");
}

function renderSessions(rows) {
  if (!recentSessions) {
    return;
  }

  if (!rows.length) {
    recentSessions.innerHTML = "<li>No sessions yet. Start your first recording.</li>";
    return;
  }

  recentSessions.innerHTML = rows
    .map((row) => {
      const started = new Date(row.started_at).toLocaleString();
      const mode = row.mode;
      const status = row.status;
      const file = row.file_path ? `Saved: ${row.file_path}` : "No file saved yet";
      const isActiveClass = selectedSessionId === row.id ? "active" : "";

      return `<li class="${isActiveClass}" data-session-id="${row.id}"><div class="meta">${mode} • ${started} ${createStatusChip(status)}</div><div>${file}</div></li>`;
    })
    .join("");

  recentSessions.querySelectorAll("li[data-session-id]").forEach((item) => {
    item.addEventListener("click", () => {
      const sessionId = item.getAttribute("data-session-id");
      if (sessionId) {
        void selectSession(sessionId);
      }
    });
  });
}

async function refreshSessions() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const rows = await api.listSessions();
  renderSessions(rows);

  if (!selectedSessionId && rows.length > 0) {
    await selectSession(rows[0].id);
  }
}

function renderSearchResults(rows) {
  if (!searchResults) {
    return;
  }

  if (!rows.length) {
    searchResults.innerHTML = "<li>No matching extracted content found.</li>";
    return;
  }

  searchResults.innerHTML = rows
    .map((row) => {
      const started = new Date(row.session_started_at).toLocaleString();
      const confidence = Math.round(row.confidence * 100);

      return `<li data-search-session-id="${row.session_id}"><div class="meta">${row.session_mode} • ${row.chunk_type} • ${confidence}% • ${started}</div><div>${row.content}</div></li>`;
    })
    .join("");

  searchResults.querySelectorAll("li[data-search-session-id]").forEach((item) => {
    item.addEventListener("click", () => {
      const sessionId = item.getAttribute("data-search-session-id");
      if (sessionId) {
        void selectSession(sessionId);
      }
    });
  });
}

async function runSearch() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  if (!searchInput || !searchResults) {
    return;
  }

  const query = searchInput.value.trim();
  if (!query) {
    searchResults.innerHTML = "<li>Type a query to search OCR and transcript memory.</li>";
    return;
  }

  const rows = await api.searchContent(query, 25);
  renderSearchResults(rows);
}

function renderSessionDetail(detail) {
  currentSessionDetail = detail;

  if (!detail.session) {
    sessionDetailTitle.textContent = "Session Detail";
    sessionDetailSubtitle.textContent = "Session not found.";
    processingJobs.innerHTML = "<li>No jobs found.</li>";
    extractedChunks.innerHTML = "<li>No extracted chunks found.</li>";
    if (sessionTranscript) {
      sessionTranscript.textContent = "No transcript generated yet.";
    }
    currentTranscriptSegments = [];
    transcriptMatchIndexes = [];
    transcriptMatchCursor = -1;
    setTranscriptSearchStatus("No active transcript search.");
    rerunBtn.disabled = true;
    if (replayBtn) {
      replayBtn.disabled = true;
    }
    if (replayStatus) {
      replayStatus.textContent = "Replay not available for this session.";
    }
    if (replayPlayer) {
      replayPlayer.pause();
      replayPlayer.removeAttribute("src");
      replayPlayer.load();
    }
    replaySourceSessionId = null;
    stopDetailPolling();
    return;
  }

  const started = new Date(detail.session.started_at).toLocaleString();
  sessionDetailTitle.textContent = `Session ${detail.session.id.slice(0, 8)}`;
  sessionDetailSubtitle.textContent = `${detail.session.mode} started ${started}`;
  rerunBtn.disabled = !detail.session.file_path;
  if (replayBtn) {
    replayBtn.disabled = !detail.session.file_path;
  }

  if (replayStatus) {
    replayStatus.textContent = detail.session.file_path
      ? replaySourceSessionId === detail.session.id
        ? "Replay loaded. Use video controls to pause/seek/fullscreen."
        : "Replay ready. Click Play Replay to load this session video."
      : "No saved recording file for this session yet.";
  }

  if (replaySourceSessionId !== detail.session.id && replayPlayer) {
    replayPlayer.pause();
    replayPlayer.removeAttribute("src");
    replayPlayer.load();
  }

  if (!detail.jobs.length) {
    processingJobs.innerHTML = "<li>No processing jobs yet. Save a recording to enqueue processing.</li>";
  } else {
    processingJobs.innerHTML = detail.jobs
      .map((job) => {
        const timing = job.finished_at
          ? `Finished ${new Date(job.finished_at).toLocaleTimeString()}`
          : job.started_at
            ? `Started ${new Date(job.started_at).toLocaleTimeString()}`
            : "Waiting";

        const error = job.error_message ? `<div>${job.error_message}</div>` : "";
        return `<li><div class="meta">${job.job_type} ${createStatusChip(job.status)}</div><div>${timing}</div>${error}</li>`;
      })
      .join("");
  }

  renderExtractedChunksList(detail.chunks);
  renderTranscript(detail);

  const hasActiveJobs = detail.jobs.some((job) => job.status === "queued" || job.status === "running");
  if (hasActiveJobs) {
    startDetailPolling();
  } else {
    stopDetailPolling();
  }
}

async function refreshSelectedSessionDetail() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  if (!selectedSessionId) {
    return;
  }

  const detail = await api.getSessionDetail(selectedSessionId);
  renderSessionDetail(detail);
}

async function selectSession(sessionId) {
  selectedSessionId = sessionId;
  await refreshSessions();
  await refreshSelectedSessionDetail();
}

function setRecordingUI(isRecording, mode) {
  if (!recordingBadge) {
    return;
  }

  if (isRecording) {
    recordingBadge.textContent = `Recording: ${mode}`;
    recordingBadge.classList.add("badge--recording");
    recordingBadge.classList.remove("badge--idle");
    setRecordingSignal("recording", "Recording Live");
    startRecordingTimer();
  } else {
    recordingBadge.textContent = "Not Recording";
    recordingBadge.classList.add("badge--idle");
    recordingBadge.classList.remove("badge--recording");
    setRecordingSignal("idle", "Idle");
    stopRecordingTimer();
  }

  startBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;
}

async function refreshState() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const state = await api.getRecordingState();
  setRecordingUI(state.isRecording, state.mode);
}

startBtn.addEventListener("click", async () => {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const mode = modeSelect.value;
  startBtn.disabled = true;
  stopBtn.disabled = true;
  setRecordingSignal("pending", "Preparing capture");
  statusText.textContent = "Preparing capture source...";

  const isSystemPickerMode = sourceSelect && sourceSelect.value === SYSTEM_PICKER_VALUE;

  if (!isSystemPickerMode && !selectedDisplaySourceId) {
    statusText.textContent = "No capture source selected. Choose a source or switch to system picker mode.";
    setRecordingSignal("idle", "Idle");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }

  statusText.textContent = isSystemPickerMode
    ? "Waiting for system picker selection..."
    : "Requesting permission for selected source...";

  if (isSystemPickerMode) {
    // If picker is hidden or slow, provide concrete guidance.
    pendingPickerHintTimeout = setTimeout(() => {
      statusText.textContent = "Still waiting for the picker. Press Alt+Tab and choose the share dialog.";
    }, 3500);
  }

  try {
    // Keep this call directly in click flow so browser user activation is preserved.
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 15,
      },
      // Keep start path reliable. System-audio capture will be added as an explicit option.
      audio: false,
    });

    permissionState.screen = "granted";
    persistPermissionState("screen", "granted");
    refreshPermissionUI();

    recordedChunks = [];

    const supportedMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: supportedMimeType });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaStream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", async () => {
        // If user stops sharing from OS controls, reflect it in the app immediately.
        if (mediaRecorder && mediaRecorder.state === "recording") {
          statusText.textContent = "Screen sharing ended from system controls. Finalizing recording.";
          await stopRecordingFlow();
        }
      });
    });

    mediaRecorder.start(1000);
  } catch (error) {
    permissionState.screen = error?.name === "NotAllowedError" ? "denied" : "unknown";
    persistPermissionState("screen", permissionState.screen);
    refreshPermissionUI();
    if (error?.name === "NotAllowedError") {
      statusText.textContent = "Screen permission was denied. Recording did not start.";
    } else {
      statusText.textContent = "Could not start capture from selected source. Click Refresh and try again.";
    }
    setRecordingSignal("idle", "Idle");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    console.error(error);
    if (pendingPickerHintTimeout) {
      clearTimeout(pendingPickerHintTimeout);
      pendingPickerHintTimeout = null;
    }
    return;
  }

  if (pendingPickerHintTimeout) {
    clearTimeout(pendingPickerHintTimeout);
    pendingPickerHintTimeout = null;
  }

  const response = await api.startRecording(mode);

  setRecordingUI(true, response.mode);
  statusText.textContent = `Recording started at ${new Date(response.startedAt).toLocaleTimeString()}.`;
  await refreshSessions();
  await selectSession(response.sessionId);
});

sourceSelect.addEventListener("change", async () => {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  selectedDisplaySourceId = sourceSelect.value === SYSTEM_PICKER_VALUE ? null : sourceSelect.value || null;
  diagnostics.selectedSource = selectedDisplaySourceId ?? "system-picker";
  refreshDiagnosticsUI();
  await api.setPreferredDisplaySource(selectedDisplaySourceId);
});

refreshSourcesBtn.addEventListener("click", async () => {
  await refreshDisplaySources();
  statusText.textContent = "Capture source list refreshed.";
});

async function stopRecordingFlow() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  if (!mediaRecorder) {
    statusText.textContent = "No active recorder found.";
    return;
  }

  stopBtn.disabled = true;
  setRecordingSignal("pending", "Finalizing recording");
  statusText.textContent = "Finalizing recording...";

  const finalizedBlob = await new Promise((resolve) => {
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      resolve(blob);
    };

    mediaRecorder.stop();
  });

  mediaStream.getTracks().forEach((track) => track.stop());
  mediaRecorder = null;
  mediaStream = null;

  const stopResponse = await api.stopRecording();

  if (!stopResponse.sessionId) {
    setRecordingUI(false, "idle");
    statusText.textContent = "Recording stopped, but no session ID was returned.";
    await refreshSessions();
    return;
  }

  const buffer = await finalizedBlob.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));

  // For long recordings we will stream chunks to disk in a later phase.
  const saveResponse = await api.saveRecording(
    stopResponse.sessionId,
    bytes,
    makeSuggestedFilename(stopResponse.startedAt ?? stopResponse.stoppedAt),
  );

  setRecordingUI(false, "idle");

  if (saveResponse.ok) {
    statusText.textContent = `Saved recording at ${new Date(stopResponse.stoppedAt).toLocaleTimeString()} to ${saveResponse.filePath}.`;
    await refreshSessions();
    await selectSession(stopResponse.sessionId);
    return;
  }

  statusText.textContent = "Recording stopped. Save cancelled.";
  await refreshSessions();
  await selectSession(stopResponse.sessionId);
}

stopBtn.addEventListener("click", async () => {
  await stopRecordingFlow();
});

grantScreenBtn.addEventListener("click", async () => {
  const result = await requestScreenPermission();
  statusText.textContent = result.granted
    ? "Screen permission granted."
    : "Screen permission was not granted. You can still retry anytime.";
});

grantMicBtn.addEventListener("click", async () => {
  const result = await requestMicPermission();

  if (result.granted) {
    statusText.textContent = "Microphone permission granted.";
    return;
  }

  if (result.reason === "NotFoundError") {
    statusText.textContent = "No microphone device detected. This does not block screen recording.";
    return;
  }

  statusText.textContent = "Microphone access not granted. Screen recording still works without mic.";
});

searchBtn.addEventListener("click", async () => {
  await runSearch();
});

searchInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") {
    return;
  }

  await runSearch();
});

rerunBtn.addEventListener("click", async () => {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  if (!selectedSessionId) {
    return;
  }

  const response = await api.rerunProcessing(selectedSessionId);
  if (!response.ok) {
    statusText.textContent = "Could not rerun processing for this session.";
    return;
  }

  statusText.textContent = "Processing rerun queued.";
  await refreshSelectedSessionDetail();
});

filterAllBtn?.addEventListener("click", () => {
  setActiveChunkFilter("all");
  if (currentSessionDetail) {
    renderExtractedChunksList(currentSessionDetail.chunks);
  }
});

filterOcrBtn?.addEventListener("click", () => {
  setActiveChunkFilter("ocr");
  if (currentSessionDetail) {
    renderExtractedChunksList(currentSessionDetail.chunks);
  }
});

filterTranscriptBtn?.addEventListener("click", () => {
  setActiveChunkFilter("transcript");
  if (currentSessionDetail) {
    renderExtractedChunksList(currentSessionDetail.chunks);
  }
});

copyTranscriptBtn?.addEventListener("click", async () => {
  if (!currentSessionDetail) {
    statusText.textContent = "Select a session first to copy its transcript.";
    return;
  }

  const transcriptText = buildTranscriptText(currentSessionDetail.chunks);
  await navigator.clipboard.writeText(transcriptText);
  statusText.textContent = "Transcript copied to clipboard.";
});

exportTranscriptBtn?.addEventListener("click", () => {
  if (!currentSessionDetail?.session) {
    statusText.textContent = "Select a session first to export its transcript.";
    return;
  }

  const transcriptText = buildTranscriptText(currentSessionDetail.chunks);
  const blob = new Blob([transcriptText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `memora-transcript-${currentSessionDetail.session.id.slice(0, 8)}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  statusText.textContent = "Transcript exported as .txt.";
});

transcriptSearchInput?.addEventListener("input", () => {
  refreshTranscriptMatches(transcriptSearchInput.value);
});

transcriptSearchInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  stepTranscriptMatch(event.shiftKey ? -1 : 1);
});

transcriptPrevBtn?.addEventListener("click", () => {
  stepTranscriptMatch(-1);
});

transcriptNextBtn?.addEventListener("click", () => {
  stepTranscriptMatch(1);
});

transcriptClearBtn?.addEventListener("click", () => {
  if (transcriptSearchInput) {
    transcriptSearchInput.value = "";
  }

  refreshTranscriptMatches("");
});

transcriptFilterAllBtn?.addEventListener("click", () => {
  setActiveTranscriptSourceFilter("all");
  if (currentSessionDetail) {
    renderTranscript(currentSessionDetail);
  }
});

transcriptFilterAudioBtn?.addEventListener("click", () => {
  setActiveTranscriptSourceFilter("audio");
  if (currentSessionDetail) {
    renderTranscript(currentSessionDetail);
  }
});

transcriptFilterVisualBtn?.addEventListener("click", () => {
  setActiveTranscriptSourceFilter("visual");
  if (currentSessionDetail) {
    renderTranscript(currentSessionDetail);
  }
});

replayBtn?.addEventListener("click", async () => {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  if (!selectedSessionId) {
    statusText.textContent = "Select a session first to replay its recording.";
    return;
  }

  replayBtn.disabled = true;
  if (replayStatus) {
    replayStatus.textContent = "Loading replay video...";
  }

  try {
    const replaySource = await api.getSessionReplaySource(selectedSessionId);

    if (!replaySource.ok) {
      if (replayStatus) {
        replayStatus.textContent = "Replay file is unavailable for this session.";
      }
      statusText.textContent = "Could not load replay for this session.";
      return;
    }

    if (!replayPlayer) {
      return;
    }

    replayPlayer.src = replaySource.fileUrl;
    replayPlayer.currentTime = 0;
    replaySourceSessionId = selectedSessionId;

    await replayPlayer.play();

    if (replayStatus) {
      replayStatus.textContent = "Replay loaded. Use video controls to pause/seek/fullscreen.";
    }
    statusText.textContent = "Replay started.";
  } catch (error) {
    if (replayStatus) {
      replayStatus.textContent = "Replay failed to load. Verify the saved file still exists.";
    }
    statusText.textContent = "Replay playback failed.";
    diagnostics.lastCaptureError = error?.name ?? "replay-load-failed";
    refreshDiagnosticsUI();
  } finally {
    if (replayBtn && currentSessionDetail?.session?.file_path) {
      replayBtn.disabled = false;
    }
  }
});

generateSummaryBtn.addEventListener("click", async () => {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  if (!selectedSessionId) {
    statusText.textContent = "Select a session first, then generate its summary.";
    return;
  }

  generateSummaryBtn.disabled = true;
  sessionSummary.textContent = "Generating summary...";

  try {
    const summary = await api.generateSessionSummary(selectedSessionId);

    const keyPointsText = summary.keyPoints.length
      ? summary.keyPoints.map((point, index) => `${index + 1}. ${point}`).join("\n")
      : "No strong key points detected yet.";

    const actionItemsText = summary.actionItems.length
      ? summary.actionItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "No action items detected yet.";

    sessionSummary.textContent = [
      `Overview: ${summary.overview}`,
      "",
      "Key Points:",
      keyPointsText,
      "",
      "Action Items:",
      actionItemsText,
    ].join("\n");
  } catch (error) {
    sessionSummary.textContent = "Failed to generate summary for this session.";
    diagnostics.lastCaptureError = error?.name ?? "summary-failed";
    refreshDiagnosticsUI();
  } finally {
    generateSummaryBtn.disabled = false;
  }
});

refreshState().catch((error) => {
  statusText.textContent = "Failed to load recording state.";
  console.error(error);
});

refreshSessions().catch((error) => {
  if (recentSessions) {
    recentSessions.innerHTML = "<li>Could not load sessions.</li>";
  }
  console.error(error);
});

refreshPermissionUI();
refreshDiagnosticsUI();
setupNavigation();
setActiveChunkFilter("all");
setActiveTranscriptSourceFilter("all");
refreshDisplaySources().catch((error) => {
  statusText.textContent = "Could not load capture sources.";
  diagnostics.lastCaptureError = error?.name ?? "source-list-failed";
  refreshDiagnosticsUI();
  console.error(error);
});

if (searchResults) {
  searchResults.innerHTML = "<li>Type a query to search OCR and transcript memory.</li>";
}

window.addEventListener("beforeunload", () => {
  stopDetailPolling();

  if (replayPlayer) {
    replayPlayer.pause();
    replayPlayer.removeAttribute("src");
    replayPlayer.load();
  }

  if (pendingPickerHintTimeout) {
    clearTimeout(pendingPickerHintTimeout);
    pendingPickerHintTimeout = null;
  }
});
