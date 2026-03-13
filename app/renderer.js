const recordingBadge = document.getElementById("recordingBadge");
const statusText = document.getElementById("statusText");
const modeSelect = document.getElementById("modeSelect");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

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
  const response = await window.memora.startRecording(mode);

  setRecordingUI(true, response.mode);
  statusText.textContent = `Recording started at ${new Date(response.startedAt).toLocaleTimeString()}.`;
});

stopBtn.addEventListener("click", async () => {
  const response = await window.memora.stopRecording();

  setRecordingUI(false, "idle");
  statusText.textContent = `Recording stopped at ${new Date(response.stoppedAt).toLocaleTimeString()}.`;
});

refreshState().catch((error) => {
  statusText.textContent = "Failed to load recording state.";
  console.error(error);
});
