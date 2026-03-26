import { MemoraStore } from "./db.js";
import { transcribeVideoAudio } from "./asr.js";
import { cleanupExtractedFrames, extractFramesFromVideo, runOcrOnFrames } from "./ocr.js";
import { buildTranscriptFromOcr } from "./transcript.js";

type ProcessingTask = {
  sessionId: string;
  filePath: string;
};

export class ProcessingQueue {
  private readonly queue: ProcessingTask[] = [];
  private readonly activeSessions = new Set<string>();
  private isRunning = false;

  constructor(
    private readonly store: MemoraStore,
    private readonly onSessionUpdated?: (sessionId: string) => Promise<void> | void,
  ) {}

  enqueue(task: ProcessingTask) {
    if (this.activeSessions.has(task.sessionId) || this.queue.some((item) => item.sessionId === task.sessionId)) {
      console.log("[PROCESSING] skip enqueue; already active", task.sessionId);
      return false;
    }

    console.log("[PROCESSING] enqueue", task.sessionId, task.filePath);
    this.store.queueProcessingJobs(task.sessionId);
    void this.onSessionUpdated?.(task.sessionId);
    this.queue.push(task);
    this.activeSessions.add(task.sessionId);
    void this.processNext();
    return true;
  }

  // Serial processing keeps CPU predictable on low-end systems.
  private async processNext() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();

      if (!task) {
        continue;
      }

      try {
        await this.runPipeline(task);
      } finally {
        this.activeSessions.delete(task.sessionId);
      }
    }

    this.isRunning = false;
  }

  private async runPipeline(task: ProcessingTask) {
    console.log("[PROCESSING] pipeline start", task.sessionId);
    let latestOcrChunks: Array<{ content: string; confidence: number }> = [];

    await this.runSingleJob(task.sessionId, "ocr", async () => {
      let framePaths: string[] = [];

      try {
        framePaths = await extractFramesFromVideo(task.filePath, task.sessionId);
        const ocrChunks = await runOcrOnFrames(framePaths);
        latestOcrChunks = ocrChunks;

        if (ocrChunks.length === 0) {
          latestOcrChunks = [
            {
              content: "OCR completed, but no readable on-screen text was detected in sampled frames.",
              confidence: 0.5,
            },
          ];
          this.store.replaceExtractedChunks(task.sessionId, "ocr", latestOcrChunks);
          void this.onSessionUpdated?.(task.sessionId);
          return;
        }

        this.store.replaceExtractedChunks(task.sessionId, "ocr", ocrChunks);
        void this.onSessionUpdated?.(task.sessionId);
      } finally {
        await cleanupExtractedFrames(framePaths);
      }
    });

    await this.runSingleJob(task.sessionId, "transcript", async () => {
      let audioTranscriptChunks: Array<{ content: string; confidence: number }> = [];

      try {
        audioTranscriptChunks = await transcribeVideoAudio(task.filePath, task.sessionId);
      } catch {
        // Continue with visual transcript if audio extraction or ASR fails.
      }

      const visualTranscriptChunks = buildTranscriptFromOcr(latestOcrChunks);
      const combinedTranscriptChunks = [...audioTranscriptChunks, ...visualTranscriptChunks];

      if (combinedTranscriptChunks.length === 0) {
        this.store.replaceExtractedChunks(task.sessionId, "transcript", [
          {
            content: "[VISUAL 00:00] No transcript data could be extracted from audio or on-screen text.",
            confidence: 0.35,
          },
        ]);
        void this.onSessionUpdated?.(task.sessionId);
        return;
      }

      this.store.replaceExtractedChunks(task.sessionId, "transcript", combinedTranscriptChunks);
      void this.onSessionUpdated?.(task.sessionId);
    });

    console.log("[PROCESSING] pipeline complete", task.sessionId);
  }

  private async runSingleJob(sessionId: string, jobType: "ocr" | "transcript", callback: () => Promise<void> | void) {
    console.log("[PROCESSING] job start", sessionId, jobType);
    this.store.updateProcessingJob({
      sessionId,
      jobType,
      status: "running",
      startedAt: new Date().toISOString(),
    });
    void this.onSessionUpdated?.(sessionId);

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await callback();

      this.store.updateProcessingJob({
        sessionId,
        jobType,
        status: "completed",
        finishedAt: new Date().toISOString(),
      });
      console.log("[PROCESSING] job complete", sessionId, jobType);
      void this.onSessionUpdated?.(sessionId);
    } catch (error) {
      console.error("[PROCESSING] job failed", sessionId, jobType, error);
      this.store.updateProcessingJob({
        sessionId,
        jobType,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown processing failure",
        finishedAt: new Date().toISOString(),
      });
      void this.onSessionUpdated?.(sessionId);
    }
  }
}
