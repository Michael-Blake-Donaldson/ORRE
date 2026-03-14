const STOP_WORDS = new Set([
    "about",
    "after",
    "again",
    "against",
    "also",
    "been",
    "before",
    "being",
    "between",
    "both",
    "could",
    "does",
    "doing",
    "from",
    "have",
    "having",
    "into",
    "just",
    "more",
    "most",
    "only",
    "other",
    "ours",
    "over",
    "same",
    "some",
    "such",
    "than",
    "that",
    "their",
    "there",
    "these",
    "they",
    "this",
    "those",
    "very",
    "what",
    "when",
    "where",
    "which",
    "while",
    "with",
    "would",
]);
const MIN_CONFIDENT_SCORE = 2.35;
function isAppVisualQuestion(question) {
    return /\b(app|apps|application|icon|icons|favorite|favourites|favorites|home tab|shown|visible|screen|video)\b/i.test(question);
}
function normalizeTokenForDisplay(token) {
    if (!token) {
        return token;
    }
    if (token.length <= 3) {
        return token.toUpperCase();
    }
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}
function extractLikelyAppNames(rows) {
    const blacklist = new Set([
        "home",
        "tab",
        "video",
        "apps",
        "app",
        "favorites",
        "favourites",
        "google",
        "search",
        "settings",
        "account",
        "more",
        "show",
        "shown",
        "open",
        "play",
        "pause",
        "time",
        "date",
    ]);
    const scores = new Map();
    for (const row of rows) {
        if (row.chunk_type !== "ocr") {
            continue;
        }
        const words = row.content.match(/[A-Za-z][A-Za-z0-9.+-]{1,24}/g) ?? [];
        for (const word of words) {
            const normalized = word.toLowerCase();
            if (normalized.length < 3 || blacklist.has(normalized)) {
                continue;
            }
            const current = scores.get(normalized) ?? 0;
            scores.set(normalized, current + row.confidence + 0.2);
        }
    }
    return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([token]) => normalizeTokenForDisplay(token));
}
function extractTimestamp(content) {
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
function tokenize(input) {
    return input
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3)
        .filter((token) => !STOP_WORDS.has(token));
}
function buildTermFrequency(tokens) {
    const map = new Map();
    for (const token of tokens) {
        map.set(token, (map.get(token) ?? 0) + 1);
    }
    return map;
}
function computeCosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const value of a.values()) {
        normA += value * value;
    }
    for (const value of b.values()) {
        normB += value * value;
    }
    for (const [term, valueA] of a.entries()) {
        const valueB = b.get(term);
        if (valueB) {
            dot += valueA * valueB;
        }
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dot / Math.sqrt(normA * normB);
}
function scoreRow(row, queryTokens, queryTf) {
    const rowTokens = tokenize(row.content);
    const rowTokenSet = new Set(rowTokens);
    const rowTf = buildTermFrequency(rowTokens);
    const cosine = computeCosineSimilarity(queryTf, rowTf);
    let exactTokenHits = 0;
    for (const token of queryTokens) {
        if (rowTokenSet.has(token)) {
            exactTokenHits += 1;
        }
    }
    const tokenCoverage = queryTokens.length > 0 ? exactTokenHits / queryTokens.length : 0;
    let score = row.confidence * 2.2;
    score += exactTokenHits * 0.7;
    score += tokenCoverage * 2.0;
    score += cosine * 2.0;
    const haystack = row.content.toLowerCase();
    if (haystack.includes("decision") || haystack.includes("agreed") || haystack.includes("next step")) {
        score += 0.25;
    }
    if (row.chunk_type === "transcript") {
        score += 0.5;
    }
    if (Number.isFinite(row.rank)) {
        score += 1 / (1 + Math.max(0, row.rank));
    }
    return score;
}
function buildAnswerText(question, citations) {
    if (!citations.length) {
        return `I could not find confident evidence for: "${question}". Try a more specific question or rerun processing on recent sessions.`;
    }
    const keyLines = citations.slice(0, 3).map((item) => item.content.replace(/\s+/g, " ").trim());
    const citedSessions = new Set(citations.map((item) => item.sessionId)).size;
    return [
        `Based on ${citedSessions} recording session(s), here is the best supported answer for: "${question}".`,
        ...keyLines.map((line, index) => `${index + 1}. ${line}`),
    ].join("\n");
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function deriveConfidence(topScore, citationCount) {
    // Normalize score into a 0..1 range and blend with citation count signal.
    const scoreSignal = clamp((topScore - 1.6) / 3.6, 0, 1);
    const citationSignal = clamp(citationCount / 5, 0, 1);
    const confidenceScore = clamp(scoreSignal * 0.75 + citationSignal * 0.25, 0, 1);
    if (confidenceScore >= 0.7) {
        return { confidenceScore, confidenceLabel: "high" };
    }
    if (confidenceScore >= 0.45) {
        return { confidenceScore, confidenceLabel: "medium" };
    }
    return { confidenceScore, confidenceLabel: "low" };
}
export function buildAskMemoraAnswer(question, rows) {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
        return {
            answer: "Ask a question to search your recordings.",
            confidenceScore: 0,
            confidenceLabel: "low",
            citations: [],
        };
    }
    const queryTokens = tokenize(normalizedQuestion);
    const queryTf = buildTermFrequency(queryTokens);
    const appVisualQuestion = isAppVisualQuestion(normalizedQuestion);
    const ranked = [...rows]
        .map((row) => ({ row, score: scoreRow(row, queryTokens, queryTf) }))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry);
    if (!ranked.length || ranked[0].score < MIN_CONFIDENT_SCORE) {
        if (appVisualQuestion) {
            const appNames = extractLikelyAppNames(rows);
            if (appNames.length > 0) {
                const ocrCitations = rows.filter((row) => row.chunk_type === "ocr").slice(0, 4);
                const mapped = ocrCitations.map((row) => {
                    const ts = extractTimestamp(row.content);
                    return {
                        chunkId: row.chunk_id,
                        sessionId: row.session_id,
                        chunkType: row.chunk_type,
                        content: row.content,
                        confidence: row.confidence,
                        timestampSeconds: ts.timestampSeconds,
                        timestampLabel: ts.timestampLabel,
                    };
                });
                const confidence = deriveConfidence(ranked[0]?.score ?? 2.2, mapped.length);
                return {
                    answer: `From visible on-screen text, likely apps shown include: ${appNames.join(", ")}. Verify with the cited frames below.`,
                    confidenceScore: Math.max(confidence.confidenceScore, 0.45),
                    confidenceLabel: confidence.confidenceLabel === "low" ? "medium" : confidence.confidenceLabel,
                    citations: mapped,
                };
            }
        }
        const weakScore = ranked.length ? ranked[0].score : 0;
        const weakConfidence = deriveConfidence(weakScore, 0);
        return {
            answer: `I found weak evidence for: "${normalizedQuestion}". Try a clearer query, or run processing on more sessions for stronger citations.`,
            confidenceScore: weakConfidence.confidenceScore,
            confidenceLabel: weakConfidence.confidenceLabel,
            citations: [],
        };
    }
    const uniqueByChunk = new Set();
    const perSessionCount = new Map();
    const citations = [];
    for (const { row } of ranked) {
        if (uniqueByChunk.has(row.chunk_id)) {
            continue;
        }
        const existingPerSession = perSessionCount.get(row.session_id) ?? 0;
        if (existingPerSession >= 2) {
            continue;
        }
        uniqueByChunk.add(row.chunk_id);
        perSessionCount.set(row.session_id, existingPerSession + 1);
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
    const finalConfidence = deriveConfidence(ranked[0]?.score ?? 0, citations.length);
    return {
        answer: buildAnswerText(normalizedQuestion, citations),
        confidenceScore: finalConfidence.confidenceScore,
        confidenceLabel: finalConfidence.confidenceLabel,
        citations,
    };
}
