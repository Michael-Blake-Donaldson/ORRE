type ChunkRow = {
  chunk_type: "ocr" | "transcript";
  content: string;
  confidence: number;
};

export function buildSessionSummary(chunks: ChunkRow[]) {
  if (!chunks.length) {
    return {
      overview: "No extracted content is available for this session yet.",
      keyPoints: [] as string[],
      actionItems: [] as string[],
    };
  }

  const ranked = [...chunks].sort((a, b) => b.confidence - a.confidence);
  const topChunks = ranked.slice(0, 8);

  const keyPoints = topChunks
    .map((chunk) => chunk.content.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 20)
    .slice(0, 5);

  const actionCandidates = topChunks
    .map((chunk) => chunk.content)
    .filter((line) => /\b(todo|fix|next|implement|review|test|ship|deploy|refactor)\b/i.test(line))
    .slice(0, 3);

  const actionItems = actionCandidates.length
    ? actionCandidates
    : ["Review the extracted key points and convert them into tasks."];

  const transcriptCount = chunks.filter((chunk) => chunk.chunk_type === "transcript").length;
  const ocrCount = chunks.filter((chunk) => chunk.chunk_type === "ocr").length;

  return {
    overview: `Session includes ${ocrCount} OCR chunks and ${transcriptCount} transcript chunks. The most confident extracted content is summarized below.`,
    keyPoints,
    actionItems,
  };
}
