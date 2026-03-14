import ffmpegPathImport from "ffmpeg-static";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createWorker } from "tesseract.js";

type OcrChunk = {
  content: string;
  confidence: number;
};

const MAX_FRAMES = 18;
const UPSCALED_FRAME_INTERVAL_SECONDS = 2;
const ffmpegPath = ffmpegPathImport as unknown as string | null;

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

export async function extractFramesFromVideo(videoPath: string, sessionId: string): Promise<string[]> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `memora-${sessionId}-`));
  const outputPattern = path.join(tempDir, "frame-%03d.jpg");

  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=1/${UPSCALED_FRAME_INTERVAL_SECONDS},scale=iw*2:ih*2:flags=lanczos,eq=contrast=1.18:brightness=0.03,unsharp=5:5:1.0:5:5:0.0`,
    "-vframes",
    String(MAX_FRAMES),
    outputPattern,
  ]);

  const files = await fs.readdir(tempDir);
  return files.filter((file) => file.endsWith(".jpg")).sort().map((file) => path.join(tempDir, file));
}

export async function runOcrOnFrames(framePaths: string[]): Promise<OcrChunk[]> {
  if (framePaths.length === 0) {
    return [];
  }

  // Reuse one worker to keep memory and startup overhead lower.
  const worker = await createWorker("eng");

  try {
    const chunks: OcrChunk[] = [];

    for (const framePath of framePaths) {
      const result = await worker.recognize(framePath);
      const lines = Array.isArray((result.data as { lines?: unknown[] }).lines)
        ? ((result.data as { lines?: Array<{ text?: string; confidence?: number }> }).lines ?? [])
        : [];

      if (lines.length > 0) {
        for (const line of lines) {
          const text = String(line.text ?? "").replace(/\s+/g, " ").trim();
          if (text.length < 3 || text.length > 80) {
            continue;
          }

          chunks.push({
            content: text,
            confidence: Math.max(0, Math.min(1, Number(line.confidence ?? result.data.confidence ?? 50) / 100)),
          });
        }

        continue;
      }

      const text = result.data.text.trim();
      if (!text) {
        continue;
      }

      const normalizedText = text.replace(/\s+/g, " ").trim();
      if (normalizedText.length < 8) {
        continue;
      }

      chunks.push({
        content: normalizedText,
        confidence: Math.max(0, Math.min(1, result.data.confidence / 100)),
      });
    }

    // Deduplicate near-identical chunks from adjacent frames.
    const unique = new Map<string, OcrChunk>();
    for (const chunk of chunks) {
      const key = chunk.content.toLowerCase();
      if (!unique.has(key)) {
        unique.set(key, chunk);
      }
    }

    return Array.from(unique.values());
  } finally {
    await worker.terminate();
  }
}

export async function cleanupExtractedFrames(framePaths: string[]) {
  if (framePaths.length === 0) {
    return;
  }

  const dirPath = path.dirname(framePaths[0]);
  await fs.rm(dirPath, { recursive: true, force: true });
}
