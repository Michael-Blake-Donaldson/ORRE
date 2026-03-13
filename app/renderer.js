const recordingBadge = document.getElementById("recordingBadge");
const statusText = document.getElementById("statusText");
const modeSelect = document.getElementById("modeSelect");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const recentSessions = document.getElementById("recentSessions");
const rerunBtn = document.getElementById("rerunBtn");
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

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let selectedSessionId = null;
let detailPollInterval = null;

const permissionState = {
  screen: localStorage.getItem("memora-permission-screen") ?? "unknown",
  mic: localStorage.getItem("memora-permission-mic") ?? "unknown",
};

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

async function requestScreenPermission() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    stream.getTracks().forEach((track) => track.stop());
    permissionState.screen = "granted";
    localStorage.setItem("memora-permission-screen", "granted");
    refreshPermissionUI();
    return true;
  } catch {
    permissionState.screen = "denied";
    localStorage.setItem("memora-permission-screen", "denied");
    refreshPermissionUI();
    return false;
  }
}

async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
    permissionState.mic = "granted";
    localStorage.setItem("memora-permission-mic", "granted");
    refreshPermissionUI();
    return true;
  } catch {
    permissionState.mic = "denied";
    localStorage.setItem("memora-permission-mic", "denied");
    refreshPermissionUI();
    return false;
  }
}

async function ensureScreenPermission() {
  if (permissionState.screen === "granted") {
    return true;
  }

  statusText.textContent = "Memora needs screen permission. Please allow the prompt.";
  return requestScreenPermission();
}

function makeSuggestedFilename(startedAt) {
  const safeDate = new Date(startedAt).toISOString().replaceAll(":", "-");
  return `memora-session-${safeDate}.webm`;
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
  const rows = await window.memora.listSessions();
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
  if (!searchInput || !searchResults) {
    return;
  }

  const query = searchInput.value.trim();
  if (!query) {
    searchResults.innerHTML = "<li>Type a query to search OCR and transcript memory.</li>";
    return;
  }

  const rows = await window.memora.searchContent(query, 25);
  renderSearchResults(rows);
}

function renderSessionDetail(detail) {
  if (!detail.session) {
    sessionDetailTitle.textContent = "Session Detail";
    sessionDetailSubtitle.textContent = "Session not found.";
    processingJobs.innerHTML = "<li>No jobs found.</li>";
    extractedChunks.innerHTML = "<li>No extracted chunks found.</li>";
    rerunBtn.disabled = true;
    stopDetailPolling();
    return;
  }

  const started = new Date(detail.session.started_at).toLocaleString();
  sessionDetailTitle.textContent = `Session ${detail.session.id.slice(0, 8)}`;
  sessionDetailSubtitle.textContent = `${detail.session.mode} started ${started}`;
  rerunBtn.disabled = !detail.session.file_path;

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

  if (!detail.chunks.length) {
    extractedChunks.innerHTML = "<li>No extracted text yet.</li>";
  } else {
    extractedChunks.innerHTML = detail.chunks
      .map((chunk) => {
        const confidence = Math.round(chunk.confidence * 100);
        return `<li><div class="meta">${chunk.chunk_type} • ${confidence}% confidence</div><div>${chunk.content}</div></li>`;
      })
      .join("");
  }

  const hasActiveJobs = detail.jobs.some((job) => job.status === "queued" || job.status === "running");
  if (hasActiveJobs) {
    startDetailPolling();
  } else {
    stopDetailPolling();
  }
}

async function refreshSelectedSessionDetail() {
  if (!selectedSessionId) {
    return;
  }

  const detail = await window.memora.getSessionDetail(selectedSessionId);
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
  } else {
    recordingBadge.textContent = "Not Recording";
    recordingBadge.classList.add("badge--idle");
    recordingBadge.classList.remove("badge--recording");
  }

  startBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;
}

async function refreshState() {
  const state = await window.memora.getRecordingState();
  setRecordingUI(state.isRecording, state.mode);
}

startBtn.addEventListener("click", async () => {
  const mode = modeSelect.value;

  const hasPermission = await ensureScreenPermission();
  if (!hasPermission) {
    statusText.textContent = "Screen permission denied. Recording did not start.";
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 15,
      },
      audio: true,
    });

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

    mediaRecorder.start(1000);
  } catch (error) {
    statusText.textContent = "Could not start screen capture. Please grant permission and try again.";
    console.error(error);
    return;
  }

  const response = await window.memora.startRecording(mode);

  setRecordingUI(true, response.mode);
  statusText.textContent = `Recording started at ${new Date(response.startedAt).toLocaleTimeString()}.`;
  await refreshSessions();
  await selectSession(response.sessionId);
});

stopBtn.addEventListener("click", async () => {
  if (!mediaRecorder) {
    statusText.textContent = "No active recorder found.";
    return;
  }

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

  const stopResponse = await window.memora.stopRecording();

  if (!stopResponse.sessionId) {
    setRecordingUI(false, "idle");
    statusText.textContent = "Recording stopped, but no session ID was returned.";
    await refreshSessions();
    return;
  }

  const buffer = await finalizedBlob.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));

  // For long recordings we will stream chunks to disk in a later phase.
  const saveResponse = await window.memora.saveRecording(
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
});

grantScreenBtn.addEventListener("click", async () => {
  const granted = await requestScreenPermission();
  statusText.textContent = granted ? "Screen permission granted." : "Screen permission denied.";
});

grantMicBtn.addEventListener("click", async () => {
  const granted = await requestMicPermission();
  statusText.textContent = granted ? "Microphone permission granted." : "Microphone permission denied.";
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
  if (!selectedSessionId) {
    return;
  }

  const response = await window.memora.rerunProcessing(selectedSessionId);
  if (!response.ok) {
    statusText.textContent = "Could not rerun processing for this session.";
    return;
  }

  statusText.textContent = "Processing rerun queued.";
  await refreshSelectedSessionDetail();
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

if (searchResults) {
  searchResults.innerHTML = "<li>Type a query to search OCR and transcript memory.</li>";
}

window.addEventListener("beforeunload", () => {
  stopDetailPolling();
});
