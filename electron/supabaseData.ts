import type { CategoryRow, ExtractedChunkRow, ProcessingJobRow, SearchResultRow, SessionDetail, SessionHealthSummary, SessionRow } from "./db.js";
import { getSupabaseClient, isSupabaseAuthConfigured } from "./supabase.js";

type CloudCategoryRow = {
  id: string;
  name: string;
  created_at: string;
};

type CloudSessionRow = {
  id: string;
  mode: string;
  started_at: string;
  stopped_at: string | null;
  local_file_path: string | null;
  local_file_name: string | null;
  status: SessionRow["status"];
  category_id: string | null;
  created_at: string;
  category?: CloudCategoryRow | CloudCategoryRow[] | null;
};

type CloudJobRow = {
  id: string;
  session_id: string;
  job_type: ProcessingJobRow["job_type"];
  status: ProcessingJobRow["status"];
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type CloudChunkRow = {
  id: string;
  session_id: string;
  chunk_type: ExtractedChunkRow["chunk_type"];
  content: string;
  confidence: number;
  source_job_type: ExtractedChunkRow["source_job_type"];
  created_at: string;
};

export type CloudSubscriptionTier = "free" | "premium";
export type CloudSubscriptionLifecycle = "inactive" | "active" | "past_due" | "canceled";

export type CloudSubscriptionStatus = {
  tier: CloudSubscriptionTier;
  status: CloudSubscriptionLifecycle;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
};

type CloudAiUsageRow = {
  period_key: string;
  total_tokens: number;
};

const DEFAULT_CLOUD_SUBSCRIPTION: CloudSubscriptionStatus = {
  tier: "free",
  status: "inactive",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
};

function mapSession(row: CloudSessionRow): SessionRow {
  const category = Array.isArray(row.category) ? (row.category[0] ?? null) : (row.category ?? null);

  return {
    id: row.id,
    mode: row.mode,
    started_at: row.started_at,
    stopped_at: row.stopped_at,
    file_path: row.local_file_path,
    status: row.status,
    category_id: row.category_id,
    category_name: category?.name ?? null,
    created_at: row.created_at,
  };
}

function buildSessionHealthSummary(session: SessionRow | null, jobs: ProcessingJobRow[], chunks: ExtractedChunkRow[]): SessionHealthSummary | null {
  if (!session) {
    return null;
  }

  const ocrChunks = chunks.filter((chunk) => chunk.chunk_type === "ocr");
  const transcriptChunks = chunks.filter((chunk) => chunk.chunk_type === "transcript");
  const audioSegments = transcriptChunks.filter((chunk) => /^\[AUDIO\s+\d{2}:\d{2}\]/i.test(chunk.content.trim()));
  const visualSegments = transcriptChunks.filter((chunk) => !/^\[AUDIO\s+\d{2}:\d{2}\]/i.test(chunk.content.trim()));

  const queuedJobCount = jobs.filter((job) => job.status === "queued").length;
  const runningJobCount = jobs.filter((job) => job.status === "running").length;
  const completedJobCount = jobs.filter((job) => job.status === "completed").length;
  const failedJobCount = jobs.filter((job) => job.status === "failed").length;

  const latestFailedJob = [...jobs]
    .filter((job) => job.status === "failed" && job.error_message)
    .sort((left, right) => (right.finished_at ?? right.created_at).localeCompare(left.finished_at ?? left.created_at))[0];

  const hasSavedFile = Boolean(session.file_path);
  const hasAudioEvidence = audioSegments.length > 0;
  const hasVisualEvidence = ocrChunks.length > 0 || visualSegments.length > 0;

  let status: SessionHealthSummary["status"] = "healthy";
  let statusLabel = "Healthy";
  let summary = "Audio and visual evidence are both available for this session.";

  if (!hasSavedFile) {
    status = "unsaved";
    statusLabel = "Unsaved";
    summary = "Recording metadata exists, but no saved replay file is attached yet.";
  } else if (queuedJobCount > 0 || runningJobCount > 0) {
    status = "pending";
    statusLabel = "Processing";
    summary = "Processing is still running. Coverage may improve when jobs finish.";
  } else if (failedJobCount > 0 && !hasAudioEvidence && !hasVisualEvidence) {
    status = "degraded";
    statusLabel = "Degraded";
    summary = "Processing failed and no usable evidence was extracted from this session.";
  } else if (failedJobCount > 0 || !hasAudioEvidence || !hasVisualEvidence) {
    status = "partial";
    statusLabel = "Partial";
    summary = hasAudioEvidence || hasVisualEvidence
      ? "Session has usable evidence, but one or more modalities are incomplete or failed."
      : "Session processing completed with weak evidence coverage.";
  }

  let coverageLabel = "Audio + Visual";
  if (hasAudioEvidence && !hasVisualEvidence) {
    coverageLabel = "Audio only";
  } else if (!hasAudioEvidence && hasVisualEvidence) {
    coverageLabel = "Visual only";
  } else if (!hasAudioEvidence && !hasVisualEvidence) {
    coverageLabel = "No extracted evidence";
  }

  return {
    status,
    status_label: statusLabel,
    coverage_label: coverageLabel,
    summary,
    has_saved_file: hasSavedFile,
    has_audio_evidence: hasAudioEvidence,
    has_visual_evidence: hasVisualEvidence,
    ocr_chunk_count: ocrChunks.length,
    transcript_chunk_count: transcriptChunks.length,
    audio_segment_count: audioSegments.length,
    visual_segment_count: visualSegments.length,
    queued_job_count: queuedJobCount,
    running_job_count: runningJobCount,
    completed_job_count: completedJobCount,
    failed_job_count: failedJobCount,
    latest_error: latestFailedJob?.error_message ?? null,
  };
}

async function getClientAndUser() {
  if (!isSupabaseAuthConfigured()) {
    return { ok: false as const, reason: "Supabase is not configured." };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { ok: false as const, reason: "Supabase client unavailable." };
  }

  const userResponse = await client.auth.getUser();
  if (userResponse.error || !userResponse.data.user) {
    return { ok: false as const, reason: userResponse.error?.message ?? "No authenticated cloud user." };
  }

  return { ok: true as const, client, userId: userResponse.data.user.id };
}

export async function listCloudSessions(limit = 20): Promise<SessionRow[]> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return [];
  }

  const response = await base.client
    .from("memora_sessions")
    .select("id, mode, started_at, stopped_at, local_file_path, local_file_name, status, category_id, created_at, category:memora_categories(id,name,created_at)")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (response.error) {
    return [];
  }

  return (response.data ?? []).map((row) => mapSession(row as CloudSessionRow));
}

export async function listCloudSessionsByCategory(categoryId: string | null, limit = 200): Promise<SessionRow[]> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return [];
  }

  let query = base.client
    .from("memora_sessions")
    .select("id, mode, started_at, stopped_at, local_file_path, local_file_name, status, category_id, created_at, category:memora_categories(id,name,created_at)")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }
  const response = await query;
  if (response.error) {
    return [];
  }

  return (response.data ?? []).map((row) => mapSession(row as CloudSessionRow));
}

export async function getCloudSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return null;
  }

  const sessionResponse = await base.client
    .from("memora_sessions")
    .select("id, mode, started_at, stopped_at, local_file_path, local_file_name, status, category_id, created_at, category:memora_categories(id,name,created_at)")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionResponse.error || !sessionResponse.data) {
    return {
      session: null,
      jobs: [],
      chunks: [],
      health: null,
    };
  }

  const jobsResponse = await base.client
    .from("memora_processing_jobs")
    .select("id, session_id, job_type, status, error_message, started_at, finished_at, created_at")
    .eq("session_id", sessionId)
    .order("job_type", { ascending: true });

  const chunksResponse = await base.client
    .from("memora_extracted_chunks")
    .select("id, session_id, chunk_type, content, confidence, source_job_type, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  const session = mapSession(sessionResponse.data as CloudSessionRow);
  const jobs = (jobsResponse.data ?? []) as ProcessingJobRow[];
  const chunks = (chunksResponse.data ?? []) as ExtractedChunkRow[];
  const health = buildSessionHealthSummary(session, jobs, chunks);
  return { session, jobs, chunks, health };
}

export async function syncCloudSessionDetail(detail: SessionDetail) {
  const base = await getClientAndUser();
  if (!base.ok || !detail.session) {
    return { ok: false as const, reason: !detail.session ? "Missing session detail." : base.reason };
  }

  const pathValue = detail.session.file_path ?? null;
  const fileName = pathValue ? pathValue.split(/[/\\]/).pop() ?? null : null;

  const sessionUpsert = await base.client.from("memora_sessions").upsert({
    id: detail.session.id,
    user_id: base.userId,
    mode: detail.session.mode,
    started_at: detail.session.started_at,
    stopped_at: detail.session.stopped_at,
    local_file_path: detail.session.file_path,
    local_file_name: fileName,
    status: detail.session.status,
    category_id: detail.session.category_id ?? null,
    created_at: detail.session.created_at,
    updated_at: new Date().toISOString(),
  });

  if (sessionUpsert.error) {
    return { ok: false as const, reason: sessionUpsert.error.message };
  }

  await base.client.from("memora_processing_jobs").delete().eq("session_id", detail.session.id);
  if (detail.jobs.length > 0) {
    const jobsUpsert = await base.client.from("memora_processing_jobs").upsert(
      detail.jobs.map((job) => ({
        ...job,
        user_id: base.userId,
      })),
    );
    if (jobsUpsert.error) {
      return { ok: false as const, reason: jobsUpsert.error.message };
    }
  }

  await base.client.from("memora_extracted_chunks").delete().eq("session_id", detail.session.id);
  if (detail.chunks.length > 0) {
    const chunksUpsert = await base.client.from("memora_extracted_chunks").upsert(
      detail.chunks.map((chunk) => ({
        ...chunk,
        user_id: base.userId,
      })),
    );
    if (chunksUpsert.error) {
      return { ok: false as const, reason: chunksUpsert.error.message };
    }
  }

  return { ok: true as const };
}

export async function deleteCloudSession(sessionId: string) {
  const base = await getClientAndUser();
  if (!base.ok) {
    return { ok: false as const, reason: base.reason };
  }

  const response = await base.client.from("memora_sessions").delete().eq("id", sessionId);
  if (response.error) {
    return { ok: false as const, reason: response.error.message };
  }

  return { ok: true as const };
}

export async function listCloudCategories(): Promise<CategoryRow[]> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return [];
  }

  const response = await base.client.from("memora_categories").select("id, name, created_at").order("name", { ascending: true });
  if (response.error) {
    return [];
  }

  return (response.data ?? []) as CategoryRow[];
}

export async function createCloudCategory(name: string): Promise<{ ok: true; category: CategoryRow } | { ok: false; reason: string }> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return { ok: false, reason: base.reason };
  }

  const normalized = name.trim().slice(0, 64);
  if (!normalized) {
    return { ok: false, reason: "Category name is required." };
  }

  const existing = await base.client
    .from("memora_categories")
    .select("id, name, created_at")
    .ilike("name", normalized)
    .limit(1)
    .maybeSingle();

  if (existing.data) {
    return { ok: true, category: existing.data as CategoryRow };
  }

  const createdAt = new Date().toISOString();
  const response = await base.client
    .from("memora_categories")
    .insert({ user_id: base.userId, name: normalized, created_at: createdAt })
    .select("id, name, created_at")
    .single();

  if (response.error || !response.data) {
    return { ok: false, reason: response.error?.message ?? "Could not create category." };
  }

  return { ok: true, category: response.data as CategoryRow };
}

export async function deleteCloudCategory(categoryId: string) {
  const base = await getClientAndUser();
  if (!base.ok) {
    return { ok: false as const, reason: base.reason };
  }

  await base.client.from("memora_sessions").update({ category_id: null }).eq("category_id", categoryId);
  const response = await base.client.from("memora_categories").delete().eq("id", categoryId);
  if (response.error) {
    return { ok: false as const, reason: response.error.message };
  }

  return { ok: true as const };
}

export async function assignCloudSessionCategory(sessionId: string, categoryId: string | null) {
  const base = await getClientAndUser();
  if (!base.ok) {
    return { ok: false as const, reason: base.reason };
  }

  const response = await base.client.from("memora_sessions").update({ category_id: categoryId }).eq("id", sessionId);
  if (response.error) {
    return { ok: false as const, reason: response.error.message };
  }

  return { ok: true as const };
}

export async function getCloudSettings(): Promise<Record<string, unknown>> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return {};
  }

  const response = await base.client.from("memora_user_settings").select("key, value");
  if (response.error) {
    return {};
  }

  const out: Record<string, unknown> = {};
  for (const row of response.data ?? []) {
    out[String(row.key)] = row.value as unknown;
  }
  return out;
}

export async function updateCloudSettings(updates: Record<string, unknown>) {
  const base = await getClientAndUser();
  if (!base.ok) {
    return { ok: false as const, reason: base.reason };
  }

  const now = new Date().toISOString();
  const payload = Object.entries(updates).map(([key, value]) => ({
    user_id: base.userId,
    key,
    value,
    updated_at: now,
  }));

  if (!payload.length) {
    return { ok: true as const };
  }

  const response = await base.client.from("memora_user_settings").upsert(payload);
  if (response.error) {
    return { ok: false as const, reason: response.error.message };
  }

  return { ok: true as const };
}

export async function getCloudSubscriptionStatus(): Promise<CloudSubscriptionStatus> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return DEFAULT_CLOUD_SUBSCRIPTION;
  }

  const response = await base.client
    .from("memora_subscriptions")
    .select("tier, status, stripe_customer_id, stripe_subscription_id, current_period_end")
    .maybeSingle();

  if (response.error || !response.data) {
    return DEFAULT_CLOUD_SUBSCRIPTION;
  }

  const tier = response.data.tier === "premium" ? "premium" : "free";
  const status = ["active", "past_due", "canceled", "inactive"].includes(String(response.data.status))
    ? (response.data.status as CloudSubscriptionLifecycle)
    : "inactive";

  return {
    tier,
    status,
    stripeCustomerId: response.data.stripe_customer_id ?? null,
    stripeSubscriptionId: response.data.stripe_subscription_id ?? null,
    currentPeriodEnd: response.data.current_period_end ?? null,
  };
}

export async function getCloudAiUsage(periodKey: string): Promise<number> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return 0;
  }

  const response = await base.client
    .from("memora_ai_usage")
    .select("period_key,total_tokens")
    .eq("period_key", periodKey)
    .maybeSingle();

  if (response.error || !response.data) {
    return 0;
  }

  return Number(response.data.total_tokens ?? 0);
}

export async function incrementCloudAiUsage(periodKey: string, tokenDelta: number) {
  const base = await getClientAndUser();
  if (!base.ok) {
    return { ok: false as const, reason: base.reason };
  }

  const safeDelta = Math.max(0, Math.floor(tokenDelta));
  if (safeDelta <= 0) {
    return { ok: true as const };
  }

  const currentTotal = await getCloudAiUsage(periodKey);
  const response = await base.client.from("memora_ai_usage").upsert(
    {
      user_id: base.userId,
      period_key: periodKey,
      total_tokens: currentTotal + safeDelta,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,period_key",
    },
  );

  if (response.error) {
    return { ok: false as const, reason: response.error.message };
  }

  return { ok: true as const };
}

export async function searchCloudExtractedContent(query: string, limit = 25): Promise<SearchResultRow[]> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return [];
  }

  const normalized = query.trim();
  if (!normalized) {
    return [];
  }

  const response = await base.client
    .from("memora_extracted_chunks")
    .select("id, session_id, chunk_type, content, confidence, created_at, source_job_type, session:memora_sessions(mode,started_at)")
    .ilike("content", `%${normalized}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (response.error) {
    return [];
  }

  return (response.data ?? []).map((row: any) => ({
    chunk_id: row.id,
    session_id: row.session_id,
    session_mode: row.session?.mode ?? "session",
    session_started_at: row.session?.started_at ?? row.created_at,
    chunk_type: row.chunk_type,
    content: row.content,
    confidence: row.confidence,
    rank: 9999,
  })) as SearchResultRow[];
}

export async function listRecentCloudExtractedRows(limit = 120, chunkType?: "ocr" | "transcript"): Promise<SearchResultRow[]> {
  const base = await getClientAndUser();
  if (!base.ok) {
    return [];
  }

  let query = base.client
    .from("memora_extracted_chunks")
    .select("id, session_id, chunk_type, content, confidence, created_at, source_job_type, session:memora_sessions(mode,started_at)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (chunkType) {
    query = query.eq("chunk_type", chunkType);
  }

  const response = await query;
  if (response.error) {
    return [];
  }

  return (response.data ?? []).map((row: any) => ({
    chunk_id: row.id,
    session_id: row.session_id,
    session_mode: row.session?.mode ?? "session",
    session_started_at: row.session?.started_at ?? row.created_at,
    chunk_type: row.chunk_type,
    content: row.content,
    confidence: row.confidence,
    rank: 9999,
  })) as SearchResultRow[];
}