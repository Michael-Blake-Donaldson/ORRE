type SearchRow = {
  chunk_id: string;
  session_id: string;
  session_mode: string;
  session_started_at: string;
  chunk_type: "ocr" | "transcript";
  content: string;
  confidence: number;
  rank: number;
};

type Citation = {
  chunkId: string;
  sessionId: string;
  chunkType: "ocr" | "transcript";
  content: string;
  confidence: number;
  timestampSeconds: number | null;
  timestampLabel: string | null;
};

export type AskMemoraResult = {
  answer: string;
  citations: Citation[];
};

function extractTimestamp(content: string) {
  const match = content.match(/\[(?:AUDIO|VISUAL)?\s*(\d{2}:\d{2})\]/i);
  if (!match) {
    return { timestampSeconds: null, timestampLabel: null };
  }

  const [minutes, seconds] = match[1].split(":").map((value) => Number(value));
  return {
    timestampSeconds: minutes * 60 + seconds,
    timestampLabel: match[1],
  };
}

function tokenize(input: string) {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function scoreRow(row: SearchRow, queryTokens: string[]) {
  let score = row.confidence * 3;

  const haystack = row.content.toLowerCase();
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += 1.4;
    }
  }

  if (row.chunk_type === "transcript") {
    score += 0.5;
  }

  if (Number.isFinite(row.rank)) {
    score += 1 / (1 + Math.max(0, row.rank));
  }

  return score;
}

function buildAnswerText(question: string, citations: Citation[]) {
  if (!citations.length) {
    return `I could not find confident evidence for: "${question}". Try a more specific question or rerun processing on recent sessions.`;
  }

  const keyLines = citations.slice(0, 3).map((item) => item.content.replace(/\s+/g, " ").trim());
  return [
    `Based on your recordings, here is the best supported answer for: "${question}".`,
    ...keyLines.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n");
}

export function buildAskMemoraAnswer(question: string, rows: SearchRow[]): AskMemoraResult {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) {
    return {
      answer: "Ask a question to search your recordings.",
      citations: [],
    };
  }

  const queryTokens = tokenize(normalizedQuestion);

  const ranked = [...rows]
    .map((row) => ({ row, score: scoreRow(row, queryTokens) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row);

  const uniqueByChunk = new Set<string>();
  const citations: Citation[] = [];

  for (const row of ranked) {
    if (uniqueByChunk.has(row.chunk_id)) {
      continue;
    }

    uniqueByChunk.add(row.chunk_id);
    const ts = extractTimestamp(row.content);

    citations.push({
      chunkId: row.chunk_id,
      sessionId: row.session_id,
      chunkType: row.chunk_type,
      content: row.content,
      confidence: row.confidence,
      timestampSeconds: ts.timestampSeconds,
      timestampLabel: ts.timestampLabel,
    });

    if (citations.length >= 5) {
      break;
    }
  }

  return {
    answer: buildAnswerText(normalizedQuestion, citations),
    citations,
  };
}
