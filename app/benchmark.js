const benchmarkQuestions = document.getElementById("benchmarkQuestions");
const benchmarkLimit = document.getElementById("benchmarkLimit");
const runBenchmarkBtn = document.getElementById("runBenchmarkBtn");
const benchmarkOutput = document.getElementById("benchmarkOutput");
const benchmarkStatus = document.getElementById("benchmarkStatus");
const navButtons = Array.from(document.querySelectorAll(".nav-item[data-page]"));
const backToTopBtn = document.getElementById("backToTopBtn");

const DEFAULT_QUESTIONS = [
  "What were the top 3 action items discussed?",
  "What apps or tools were used most recently?",
  "Summarize the latest decision that was made.",
].join("\n");

function getMemoraApi() {
  if (window.memora) {
    return window.memora;
  }

  if (benchmarkStatus) {
    benchmarkStatus.textContent = "Desktop bridge unavailable. Restart Memora with npm run dev.";
  }
  return null;
}

function setStatus(text) {
  if (benchmarkStatus) {
    benchmarkStatus.textContent = text;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseIntOrFallback(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(parsed, min, max);
}

function renderBenchmarkResult(result) {
  if (!benchmarkOutput) {
    return;
  }

  if (!result.questionCount) {
    benchmarkOutput.textContent = "No benchmark questions were provided.";
    return;
  }

  const avgPercent = Math.round(result.avgConfidence * 100);
  const lines = [
    `Questions: ${result.questionCount}`,
    `Average confidence: ${avgPercent}%`,
    `Low confidence answers: ${result.lowConfidenceCount}`,
    `Low modality coverage: ${result.lowCoverageCount}`,
    "",
    "Per question:",
  ];

  result.results.forEach((item, index) => {
    const confidencePct = Math.round(item.confidenceScore * 100);
    const modalities = item.modalityCoverage.length ? item.modalityCoverage.join(", ") : "none";
    lines.push(
      `${index + 1}. ${item.question}`,
      `   - ${item.confidenceLabel.toUpperCase()} (${confidencePct}%), citations: ${item.citationCount}, modalities: ${modalities}`,
    );
  });

  benchmarkOutput.textContent = lines.join("\n");
}

async function loadDefaults() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const settings = await api.getSettings();
  if (benchmarkQuestions) {
    benchmarkQuestions.value = settings.benchmarkQuestions || DEFAULT_QUESTIONS;
  }
  if (benchmarkLimit) {
    benchmarkLimit.value = String(settings.benchmarkLimit || 80);
  }
}

async function runBenchmark() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const questions = (benchmarkQuestions?.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!questions.length) {
    renderBenchmarkResult({ questionCount: 0, results: [], avgConfidence: 0, lowConfidenceCount: 0, lowCoverageCount: 0 });
    setStatus("Add at least one benchmark question.");
    return;
  }

  const limit = parseIntOrFallback(benchmarkLimit?.value, 80, 20, 140);

  runBenchmarkBtn.disabled = true;
  benchmarkOutput.textContent = "Running benchmark...";

  try {
    await api.updateSettings({
      benchmarkQuestions: questions.join("\n"),
      benchmarkLimit: limit,
    });

    const result = await api.runBenchmark(questions, limit);
    renderBenchmarkResult(result);
    setStatus("Benchmark completed.");
  } catch {
    benchmarkOutput.textContent = "Benchmark failed. Try again after processing completes.";
    setStatus("Benchmark failed.");
  } finally {
    runBenchmarkBtn.disabled = false;
  }
}

function setupNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.getAttribute("data-page");
      if (!page) {
        return;
      }

      const pageMap = {
        dashboard: "./index.html",
        library: "./library.html",
        settings: "./settings.html",
        benchmarks: "./benchmark.html",
      };

      const nextHref = pageMap[page];
      if (nextHref) {
        window.location.href = nextHref;
      }
    });
  });
}

function setupBackToTop() {
  if (!backToTopBtn) {
    return;
  }

  const syncVisibility = () => {
    backToTopBtn.classList.toggle("back-to-top--visible", window.scrollY > 260);
  };

  window.addEventListener("scroll", syncVisibility, { passive: true });
  backToTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  syncVisibility();
}

runBenchmarkBtn?.addEventListener("click", async () => {
  await runBenchmark();
});

setupNavigation();
setupBackToTop();
loadDefaults().catch((error) => {
  setStatus("Could not load benchmark defaults.");
  console.error(error);
});