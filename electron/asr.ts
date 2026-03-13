import ffmpegPathImport from "ffmpeg-static";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

type TranscriptChunk = {
  content: string;
  confidence: number;
};

type WhisperChunk = {
  text?: string;
  timestamp?: [number | null, number | null] | { start?: number | null; end?: number | null };
};

type WhisperResult = {
  text?: string;
  chunks?: WhisperChunk[];
};

const ffmpegPath = ffmpegPathImport as unknown as string | null;
let cachedTranscriber: ((audio: Float32Array, options?: Record<string, unknown>) => Promise<WhisperResult>) | null = null;

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary not available."));
      return;
    }

    const ffmpeg = spawn(ffmpegPath, args, { stdio: "ignore" });

    ffmpeg.on("error", (error: Error) => {
      reject(error);
    });

    ffmpeg.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code ?? -1}`));
    });
  });
}

function toTimestamp(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function normalizeLine(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function parseSecondsFromTimestamp(input: WhisperChunk["timestamp"]): number {
  if (!input) {
    return 0;
  }

  if (Array.isArray(input)) {
    return typeof input[0] === "number" ? input[0] : 0;
  }

  return typeof input.start === "number" ? input.start : 0;
}

function parseWavPcm16Mono(wavBuffer: Buffer): Float32Array {
  if (wavBuffer.length < 44) {
    throw new Error("Invalid WAV file: too small.");
  }

  if (wavBuffer.toString("ascii", 0, 4) !== "RIFF" || wavBuffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV file header.");
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = wavBuffer.readUInt16LE(payloadStart);
      channels = wavBuffer.readUInt16LE(payloadStart + 2);
      bitsPerSample = wavBuffer.readUInt16LE(payloadStart + 14);
    } else if (chunkId === "data") {
      dataStart = payloadStart;
      dataSize = chunkSize;
      break;
    }

    offset = payloadStart + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || dataStart < 0 || dataSize <= 0) {
    throw new Error("Unsupported WAV format. Expected 16-bit mono PCM.");
  }

  const sampleCount = Math.floor(dataSize / 2);
  const output = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const value = wavBuffer.readInt16LE(dataStart + index * 2);
    output[index] = value / 32768;
  }

  return output;
}

async function getTranscriber() {
  if (cachedTranscriber) {
    return cachedTranscriber;
  }

  const transformers = await import("@xenova/transformers");
  transformers.env.allowLocalModels = true;
  transformers.env.allowRemoteModels = true;

  // Tiny model keeps first-run and inference time reasonable for local desktop usage.
  const pipeline = await transformers.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
    quantized: true,
  });

  cachedTranscriber = pipeline as (audio: Float32Array, options?: Record<string, unknown>) => Promise<WhisperResult>;
  return cachedTranscriber;
}

function mapWhisperResultToChunks(result: WhisperResult): TranscriptChunk[] {
  const chunks = Array.isArray(result.chunks) ? result.chunks : [];

  if (!chunks.length) {
    const text = normalizeLine(result.text ?? "");
    return text
      ? [
          {
            content: `[AUDIO 00:00] ${text}`,
            confidence: 0.7,
          },
        ]
      : [];
  }

  return chunks
    .map((chunk) => {
      const text = normalizeLine(chunk.text ?? "");
      if (!text) {
        return null;
      }

      const seconds = parseSecondsFromTimestamp(chunk.timestamp);
      return {
        content: `[AUDIO ${toTimestamp(seconds)}] ${text}`,
        confidence: 0.74,
      };
    })
    .filter((row): row is TranscriptChunk => Boolean(row));
}

export async function transcribeVideoAudio(videoPath: string, sessionId: string): Promise<TranscriptChunk[]> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `memora-audio-${sessionId}-`));
  const wavPath = path.join(tempDir, "audio-16k.wav");

  try {
    await runFfmpeg(["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wavPath]);

    const wavBuffer = await fs.readFile(wavPath);
    const monoAudio = parseWavPcm16Mono(wavBuffer);

    if (!monoAudio.length) {
      return [];
    }

    const transcriber = await getTranscriber();
    const result = await transcriber(monoAudio, {
      chunk_length_s: 20,
      stride_length_s: 4,
      return_timestamps: true,
    });

    return mapWhisperResultToChunks(result);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
