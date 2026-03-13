import { MemoraStore } from "./db.js";

type ProcessingTask = {
  sessionId: string;
  filePath: string;
};

export class ProcessingQueue {
  private readonly queue: ProcessingTask[] = [];
  private readonly activeSessions = new Set<string>();
  private isRunning = false;

  constructor(private readonly store: MemoraStore) {}

  enqueue(task: ProcessingTask) {
    if (this.activeSessions.has(task.sessionId) || this.queue.some((item) => item.sessionId === task.sessionId)) {
      return;
    }

    this.queue.push(task);
    this.activeSessions.add(task.sessionId);
    void this.processNext();
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
    this.store.queueProcessingJobs(task.sessionId);

    await this.runSingleJob(task.sessionId, "ocr", async () => {
      // Placeholder output until OCR engine is integrated in the next step.
      this.store.replaceExtractedChunks(task.sessionId, "ocr", [
        {
          content: `OCR placeholder: Indexed visual content from ${task.filePath}`,
          confidence: 0.62,
        },
      ]);
    });

    await this.runSingleJob(task.sessionId, "transcript", async () => {
      // Placeholder output until ASR engine is integrated in the next step.
      this.store.replaceExtractedChunks(task.sessionId, "transcript", [
        {
          content: "Transcript placeholder: Audio extraction pipeline scaffold is active.",
          confidence: 0.58,
        },
      ]);
    });
  }

  private async runSingleJob(sessionId: string, jobType: "ocr" | "transcript", callback: () => Promise<void> | void) {
    this.store.updateProcessingJob({
      sessionId,
      jobType,
      status: "running",
      startedAt: new Date().toISOString(),
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await callback();

      this.store.updateProcessingJob({
        sessionId,
        jobType,
        status: "completed",
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.store.updateProcessingJob({
        sessionId,
        jobType,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown processing failure",
        finishedAt: new Date().toISOString(),
      });
    }
  }
}
