const SEGMENT_SECONDS = 4;
function toTimestamp(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
}
function normalizeLine(value) {
    return value
        .replace(/\s+/g, " ")
        .replace(/[|]{2,}/g, "|")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim();
}
function isLikelyNoise(value) {
    if (value.length < 18) {
        return true;
    }
    const alphaCount = (value.match(/[a-z]/gi) ?? []).length;
    return alphaCount < Math.max(10, Math.floor(value.length * 0.4));
}
export function buildTranscriptFromOcr(ocrChunks) {
    const cleaned = ocrChunks
        .map((chunk) => ({
        content: normalizeLine(chunk.content),
        confidence: chunk.confidence,
    }))
        .filter((chunk) => chunk.content.length > 0)
        .filter((chunk) => !isLikelyNoise(chunk.content));
    if (!cleaned.length) {
        return [
            {
                content: "[VISUAL 00:00] No stable on-screen text segments detected. Try capturing larger, clearer text in the shared window.",
                confidence: 0.45,
            },
        ];
    }
    return cleaned.map((chunk, index) => {
        const timestamp = toTimestamp(index * SEGMENT_SECONDS);
        return {
            content: `[VISUAL ${timestamp}] ${chunk.content}`,
            confidence: chunk.confidence,
        };
    });
}
