import { cleanupExtractedFrames, extractFramesFromVideo, runOcrOnFrames } from "./ocr.js";
import { buildTranscriptFromOcr } from "./transcript.js";
export class ProcessingQueue {
    store;
    queue = [];
    activeSessions = new Set();
    isRunning = false;
    constructor(store) {
        this.store = store;
    }
    enqueue(task) {
        if (this.activeSessions.has(task.sessionId) || this.queue.some((item) => item.sessionId === task.sessionId)) {
            return;
        }
        this.queue.push(task);
        this.activeSessions.add(task.sessionId);
        void this.processNext();
    }
    // Serial processing keeps CPU predictable on low-end systems.
    async processNext() {
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
            }
            finally {
                this.activeSessions.delete(task.sessionId);
            }
        }
        this.isRunning = false;
    }
    async runPipeline(task) {
        this.store.queueProcessingJobs(task.sessionId);
        let latestOcrChunks = [];
        await this.runSingleJob(task.sessionId, "ocr", async () => {
            let framePaths = [];
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
                    return;
                }
                this.store.replaceExtractedChunks(task.sessionId, "ocr", ocrChunks);
            }
            finally {
                await cleanupExtractedFrames(framePaths);
            }
        });
        await this.runSingleJob(task.sessionId, "transcript", async () => {
            const transcriptChunks = buildTranscriptFromOcr(latestOcrChunks);
            this.store.replaceExtractedChunks(task.sessionId, "transcript", transcriptChunks);
        });
    }
    async runSingleJob(sessionId, jobType, callback) {
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
        }
        catch (error) {
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
