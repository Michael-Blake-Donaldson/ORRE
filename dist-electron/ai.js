function getOpenAiApiKey() {
    return process.env.OPENAI_API_KEY?.trim() ?? "";
}
export function isOpenAiConfigured() {
    return Boolean(getOpenAiApiKey());
}
function resolveModel() {
    return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function estimateTokensFromText(input) {
    const normalized = input.trim();
    if (!normalized) {
        return 0;
    }
    return Math.ceil(normalized.length / 4);
}
async function runChatCompletion(messages, maxTokens) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
        throw new Error("OpenAI API key is not configured.");
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: resolveModel(),
            temperature: 0.2,
            max_tokens: clamp(maxTokens, 120, 1400),
            messages,
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 220)}`);
    }
    const payload = (await response.json());
    const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
        throw new Error("OpenAI response was empty.");
    }
    return {
        content,
        usageTokens: payload.usage?.total_tokens ?? estimateTokensFromText(content),
    };
}
function renderCitationContext(citations) {
    return citations
        .slice(0, 10)
        .map((citation, index) => {
        const confidence = Math.round(citation.confidence * 100);
        const timestamp = citation.timestampLabel ?? "--:--";
        return [
            `Citation C${index + 1}`,
            `session: ${citation.sessionId}`,
            `modality: ${citation.modality}`,
            `chunkType: ${citation.chunkType}`,
            `confidence: ${confidence}%`,
            `timestamp: ${timestamp}`,
            `text: ${citation.content}`,
        ].join("\n");
    })
        .join("\n\n");
}
export async function generateAiAskAnswer(question, citations, maxTokens = 520) {
    const context = renderCitationContext(citations);
    const system = "You are Memora, a factual assistant. Answer only from provided citations. If evidence is weak, say so clearly. Do not invent facts. Keep response concise and useful.";
    const user = [
        `Question: ${question}`,
        "",
        "Use these citations as evidence:",
        context || "No citations provided.",
        "",
        "Write a direct answer with 1 short caveat sentence when confidence is low.",
    ].join("\n");
    return runChatCompletion([
        { role: "system", content: system },
        { role: "user", content: user },
    ], maxTokens);
}
function normalizeBullets(raw) {
    return raw
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
        .filter((line) => line.length > 0)
        .slice(0, 8);
}
function parseSummaryJson(text) {
    try {
        const parsed = JSON.parse(text);
        return {
            overview: typeof parsed.overview === "string" ? parsed.overview.trim() : "",
            keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map((item) => String(item).trim()).filter(Boolean) : [],
            actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map((item) => String(item).trim()).filter(Boolean) : [],
        };
    }
    catch {
        const sections = text.split(/\n\n+/);
        const overview = sections[0]?.trim() ?? "";
        return {
            overview,
            keyPoints: normalizeBullets(sections[1] ?? ""),
            actionItems: normalizeBullets(sections[2] ?? ""),
        };
    }
}
export async function generateAiSessionSummary(chunks, maxTokens = 650) {
    const evidence = chunks
        .slice(0, 26)
        .map((chunk, index) => {
        const confidence = Math.round(chunk.confidence * 100);
        return `Chunk ${index + 1} (${chunk.chunk_type}, ${confidence}%): ${chunk.content}`;
    })
        .join("\n");
    const system = "You summarize meeting/session evidence. Return JSON only with keys overview, keyPoints, actionItems. Avoid fabrications.";
    const user = [
        "Summarize this session evidence.",
        "",
        "Required JSON shape:",
        '{"overview":"...","keyPoints":["..."],"actionItems":["..."]}',
        "",
        "Evidence:",
        evidence || "No evidence available.",
    ].join("\n");
    const completion = await runChatCompletion([
        { role: "system", content: system },
        { role: "user", content: user },
    ], maxTokens);
    const parsed = parseSummaryJson(completion.content);
    return {
        usageTokens: completion.usageTokens,
        summary: {
            overview: parsed.overview || "Summary generated from available evidence.",
            keyPoints: parsed.keyPoints.slice(0, 6),
            actionItems: parsed.actionItems.slice(0, 5),
        },
    };
}
