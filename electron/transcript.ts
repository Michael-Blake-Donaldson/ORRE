type OcrChunk = {
  content: string;
  confidence: number;
};

type TranscriptChunk = {
  content: string;
  confidence: number;
};

const SEGMENT_SECONDS = 4;
const MIN_MEANINGFUL_LENGTH = 20;
const MIN_CONFIDENCE_FOR_AUDIO = 0.4;

function toTimestamp(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function normalizeLine(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[|]{2,}/g, "|")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function isLikelyNoise(value: string) {
  // Filter text that's too short for meaningful content
  if (value.length < MIN_MEANINGFUL_LENGTH) {
    return true;
  }

  const alphaCount = (value.match(/[a-z]/gi) ?? []).length;
  if (alphaCount < Math.max(10, Math.floor(value.length * 0.4))) {
    return true;
  }

  // Filter common UI/metadata phrases
  const lower = value.toLowerCase();
  const commonNoise = [
    /^(home|back|next|menu|search|sign in|log in|loading)\b/i,
    /^(\d+\s*)(views?|likes?|comments?|shares?)\b/i,
    /^(posted|edited|updated)\s+(today|yesterday|\d+\s*(hours?|days?|weeks?))\b/i,
    /^(follow|subscribe|like|subscribe now)\b/i,
    /^(cookie|notify|notification|popup|popup close)\b/i,
  ];

  return commonNoise.some((pattern) => pattern.test(lower));
}

function deduplicateChunks(chunks: TranscriptChunk[]): TranscriptChunk[] {
  const seen = new Set<string>();
  const result: TranscriptChunk[] = [];

  for (const chunk of chunks) {
    // Use a normalized key for deduplication
    const key = chunk.content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(chunk);
    }
  }

  return result;
}

export function buildTranscriptFromOcr(ocrChunks: OcrChunk[]): TranscriptChunk[] {
  const cleaned = ocrChunks
    .map((chunk) => ({
      content: normalizeLine(chunk.content),
      confidence: Math.max(0, Math.min(1, chunk.confidence || 0)),
    }))
    .filter((chunk) => chunk.content.length > 0)
    .filter((chunk) => chunk.confidence >= MIN_CONFIDENCE_FOR_AUDIO)
    .filter((chunk) => !isLikelyNoise(chunk.content));

  // Deduplicate to avoid repeated UI elements across frames
  const deduped = deduplicateChunks(cleaned);

  if (!deduped.length) {
    return [
      {
        content: "[VISUAL 00:00] No stable on-screen text segments detected. Try capturing larger, clearer text in the shared window.",
        confidence: 0.45,
      },
    ];
  }

  return deduped.map((chunk, index) => {
    const timestamp = toTimestamp(index * SEGMENT_SECONDS);
    return {
      content: `[VISUAL ${timestamp}] ${chunk.content}`,
      confidence: chunk.confidence,
    };
  });
}
