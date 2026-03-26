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
const MIN_CONFIDENCE_THRESHOLD = 0.45;
const MIN_CONTENT_LENGTH = 8;
const MAX_CONTENT_LENGTH = 180;

// Common UI patterns, metadata, and navigation words that should be filtered out
const METADATA_PATTERNS = [
  /^(sign in|log in|sign up|register|create account|forgot password|remember me)$/i,
  /^(search|search\.\.\.|\/search|find)$/i,
  /^(home|about|contact|help|support|faq|terms|privacy|cookies)$/i,
  /^(next|previous|back|forward|skip|continue|cancel|close|dismiss)$/i,
  /^(1|2|3|4|5|6|7|8|9|10)$/,
  /^(follow|like|share|subscribe|unsubscribe|download|save)$/i,
  /^(loading\.\.\.|please wait|processing|error|warning|success)$/i,
  /^(click here|click to|tap to|press|enter)$/i,
  /^(results|more results|view all|show more|load more|no results)$/i,
  /^(\d+:\d+|\d+ comments|\d+ likes|\d+ shares|posted)$/i,
  /^([a-z]{1,2})$/,
  /^(ads? space|advertisement|sponsored|promoted)$/i,
  /^(www\.|https?:|\.com|\.org|\.net|\.[a-z]{2,})$/i,
  /^(edit|delete|update|settings|preferences)$/i,
  /^(language|english|theme|dark|light|mode)$/i,
  /^(menu|navbar|sidebar|footer|header)$/i,
];

function isLikelyMetadata(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return METADATA_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isHighQualityContent(content: string, confidence: number): boolean {
  if (confidence < MIN_CONFIDENCE_THRESHOLD) {
    return false;
  }

  if (content.length < MIN_CONTENT_LENGTH || content.length > MAX_CONTENT_LENGTH) {
    return false;
  }

  if (isLikelyMetadata(content)) {
    return false;
  }

  // Filter out mostly symbols or numbers
  const alphaCount = (content.match(/[a-z]/gi) ?? []).length;
  if (alphaCount < Math.max(4, Math.floor(content.length * 0.3))) {
    return false;
  }

  return true;
}
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
          const lineConfidence = Math.max(0, Math.min(1, Number(line.confidence ?? result.data.confidence ?? 50) / 100));

          if (!isHighQualityContent(text, lineConfidence)) {
            continue;
          }

          chunks.push({
            content: text,
            confidence: lineConfidence,
          });
        }

        continue;
      }

      const text = result.data.text.trim();
      if (!text) {
        continue;
      }

      const normalizedText = text.replace(/\s+/g, " ").trim();
      const confidence = Math.max(0, Math.min(1, result.data.confidence / 100));

      if (!isHighQualityContent(normalizedText, confidence)) {
        continue;
      }

      chunks.push({
        content: normalizedText,
        confidence,
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
