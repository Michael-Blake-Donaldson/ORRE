const recordingBadge = document.getElementById("recordingBadge");
const statusText = document.getElementById("statusText");
const modeSelect = document.getElementById("modeSelect");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];

function makeSuggestedFilename(startedAt) {
  const safeDate = new Date(startedAt).toISOString().replaceAll(":", "-");
  return `memora-session-${safeDate}.webm`;
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

  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 15,
      },
      audio: true,
    });

    recordedChunks = [];

    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: "video/webm;codecs=vp9,opus",
    });

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

  const buffer = await finalizedBlob.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));

  const saveResponse = await window.memora.saveRecording(
    bytes,
    makeSuggestedFilename(stopResponse.startedAt ?? stopResponse.stoppedAt),
  );

  setRecordingUI(false, "idle");

  if (saveResponse.ok) {
    statusText.textContent = `Saved recording at ${new Date(stopResponse.stoppedAt).toLocaleTimeString()} to ${saveResponse.filePath}.`;
    return;
  }

  statusText.textContent = "Recording stopped. Save cancelled.";
});

refreshState().catch((error) => {
  statusText.textContent = "Failed to load recording state.";
  console.error(error);
});
