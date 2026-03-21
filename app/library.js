const categoryFilter = document.getElementById("libraryCategoryFilter");
const newCategoryInput = document.getElementById("libraryNewCategoryInput");
const addCategoryBtn = document.getElementById("libraryAddCategoryBtn");
const deleteCategoryBtn = document.getElementById("libraryDeleteCategoryBtn");
const refreshBtn = document.getElementById("libraryRefreshBtn");
const statusText = document.getElementById("libraryStatus");
const sessionGrid = document.getElementById("librarySessionGrid");
const navButtons = Array.from(document.querySelectorAll(".nav-item[data-page], .nav-item[data-action]"));
const backToTopBtn = document.getElementById("backToTopBtn");

function parseTimestampToSeconds(timestamp) {
  const match = timestamp.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return 0;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return minutes * 60 + seconds;
}

function extractTranscriptCues(chunks) {
  return chunks
    .filter((chunk) => chunk.chunk_type === "transcript")
    .map((chunk) => chunk.content.trim())
    .map((line) => {
      const typed = line.match(/^\[(AUDIO|VISUAL)\s+(\d{2}:\d{2})\]\s*(.*)$/i);
      if (typed) {
        return {
          source: typed[1].toLowerCase(),
          timestamp: typed[2],
          text: typed[3] || "",
        };
      }

      const basic = line.match(/^\[(\d{2}:\d{2})\]\s*(.*)$/);
      if (basic) {
        return {
          source: "visual",
          timestamp: basic[1],
          text: basic[2] || "",
        };
      }

      return null;
    })
    .filter((cue) => Boolean(cue) && cue.text.length > 0)
    .slice(0, 8);
}

function getMemoraApi() {
  if (window.memora) {
    return window.memora;
  }

  statusText.textContent = "Desktop bridge unavailable. Restart app with npm run dev.";
  return null;
}

async function ensureAuthenticated() {
  const api = getMemoraApi();
  if (!api) {
    return false;
  }

  const user = await api.getCurrentUser();
  if (!user) {
    window.location.href = "./auth.html";
    return false;
  }

  return true;
}

function renderCategoryFilter(categories, selectedCategoryId) {
  if (!categoryFilter) {
    return;
  }

  const options = [
    `<option value="">All Categories</option>`,
    `<option value="__uncategorized__">Uncategorized</option>`,
    ...categories.map((category) => `<option value="${category.id}">${category.name}</option>`),
  ];

  categoryFilter.innerHTML = options.join("");
  if (selectedCategoryId === null) {
    categoryFilter.value = "__uncategorized__";
    return;
  }

  categoryFilter.value = selectedCategoryId ?? "";
}

function buildCategoryOptions(categories, selectedCategoryId) {
  return [
    `<option value="">Uncategorized</option>`,
    ...categories.map((category) => {
      const selected = selectedCategoryId === category.id ? "selected" : "";
      return `<option value="${category.id}" ${selected}>${category.name}</option>`;
    }),
  ].join("");
}

function stopOtherLibraryPlayers(exceptSessionId = null) {
  if (!sessionGrid) {
    return;
  }

  sessionGrid.querySelectorAll("video[data-role='session-player']").forEach((player) => {
    const card = player.closest(".session-card");
    const sessionId = card?.getAttribute("data-session-id");

    if (exceptSessionId && sessionId === exceptSessionId) {
      return;
    }

    player.pause();
  });
}

async function ensureCardReplayPlayerLoaded(api, sessionId, card, autoplay = false) {
  const status = card?.querySelector("[data-role='player-status']");
  const player = card?.querySelector("video[data-role='session-player']");

  if (!status || !player) {
    return null;
  }

  const replayResponse = await api.getSessionReplaySource(sessionId);
  if (!replayResponse.ok) {
    status.textContent = "Replay file unavailable.";
    return null;
  }

  stopOtherLibraryPlayers(sessionId);

  if (player.src !== replayResponse.fileUrl) {
    player.src = replayResponse.fileUrl;
  }

  if (autoplay) {
    await player.play();
  }

  return { player, status };
}

function renderSessions(sessions, categories) {
  if (!sessionGrid) {
    return;
  }

  if (!sessions.length) {
    sessionGrid.innerHTML = "<div class=\"session-card\">No recordings found for this filter.</div>";
    return;
  }

  sessionGrid.innerHTML = sessions
    .map((session) => {
      const started = new Date(session.started_at).toLocaleString();
      const categoryName = session.category_name ?? "Uncategorized";
      const fileInfo = session.file_path ? session.file_path : "No saved file path";
      return `
        <article class="session-card" data-session-id="${session.id}">
          <div class="session-card__title">${session.mode} • ${session.id.slice(0, 8)}</div>
          <div class="session-card__meta">Started: ${started}</div>
          <div class="session-card__meta">Category: ${categoryName}</div>
          <div class="session-card__meta">${fileInfo}</div>
          <div class="session-card__row">
            <select class="inline-select" data-role="assign-category">
              ${buildCategoryOptions(categories, session.category_id ?? null)}
            </select>
            <button class="button button--mini" data-role="save-category">Save</button>
          </div>
          <div class="session-card__row">
            <div></div>
            <button class="button button--mini" data-role="delete-session">Delete</button>
          </div>
          <div class="session-card__player-shell">
            <div class="session-card__row">
              <button class="button button--mini" data-role="play-session" ${session.file_path ? "" : "disabled"}>Play</button>
              <span class="session-card__meta" data-role="player-status">${session.file_path ? "Replay ready." : "No saved video file."}</span>
            </div>
            <video class="session-card__player" data-role="session-player" controls preload="metadata"></video>
          </div>
          <div class="session-card__transcript-shell">
            <div class="session-card__row">
              <button class="button button--mini" data-role="load-cues" ${session.file_path ? "" : "disabled"}>Load Transcript Cues</button>
              <span class="session-card__meta">Click a cue to seek video</span>
            </div>
            <div class="cue-list" data-role="cue-list">No cues loaded.</div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadLibrary() {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const categories = await api.listCategories();

  const filterValue = categoryFilter?.value ?? "";
  const normalizedCategoryId = filterValue === "__uncategorized__" ? null : filterValue || null;
  renderCategoryFilter(categories, filterValue || "");

  let sessions;
  if (filterValue === "") {
    sessions = await api.listSessionsByCategory(null, 400);
  } else if (filterValue === "__uncategorized__") {
    const all = await api.listSessionsByCategory(null, 400);
    sessions = all.filter((item) => !item.category_id);
  } else {
    sessions = await api.listSessionsByCategory(normalizedCategoryId, 400);
  }

  renderSessions(sessions, categories);

  sessionGrid.querySelectorAll("[data-role='save-category']").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".session-card");
      const sessionId = card?.getAttribute("data-session-id");
      const select = card?.querySelector("select[data-role='assign-category']");

      if (!sessionId || !select) {
        return;
      }

      const nextCategoryId = select.value || null;
      const result = await api.assignSessionCategory(sessionId, nextCategoryId);
      if (!result.ok) {
        statusText.textContent = "Could not update session category.";
        return;
      }

      statusText.textContent = "Session category updated.";
      await loadLibrary();
    });
  });

  sessionGrid.querySelectorAll("[data-role='delete-session']").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".session-card");
      const sessionId = card?.getAttribute("data-session-id");
      if (!sessionId) {
        return;
      }

      const confirmed = window.confirm("Delete this session from the library? This cannot be undone.");
      if (!confirmed) {
        return;
      }

      const result = await api.deleteSession(sessionId);
      if (!result.ok) {
        statusText.textContent = "Could not delete session.";
        return;
      }

      statusText.textContent = "Session deleted.";
      await loadLibrary();
    });
  });

  sessionGrid.querySelectorAll("[data-role='play-session']").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".session-card");
      const sessionId = card?.getAttribute("data-session-id");
      if (!sessionId || !card) {
        return;
      }

      try {
        const loaded = await ensureCardReplayPlayerLoaded(api, sessionId, card, true);
        if (!loaded) {
          return;
        }

        loaded.status.textContent = "Playing.";
      } catch {
        const status = card.querySelector("[data-role='player-status']");
        if (status) {
          status.textContent = "Could not start playback.";
        }
      }
    });
  });

  sessionGrid.querySelectorAll("[data-role='load-cues']").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".session-card");
      const sessionId = card?.getAttribute("data-session-id");
      const cueList = card?.querySelector("[data-role='cue-list']");

      if (!sessionId || !card || !cueList) {
        return;
      }

      cueList.textContent = "Loading transcript cues...";

      const detail = await api.getSessionDetail(sessionId);
      const cues = extractTranscriptCues(detail.chunks || []);

      if (!cues.length) {
        cueList.textContent = "No transcript cues found yet. Run processing first.";
        return;
      }

      cueList.innerHTML = cues
        .map((cue) => {
          const sourceLabel = cue.source === "audio" ? "Audio" : "Visual";
          return `<button class="cue-item" data-role="cue-item" data-ts="${cue.timestamp}"><span class="cue-item__ts">${cue.timestamp}</span><span class="cue-item__source">${sourceLabel}</span><span class="cue-item__text">${cue.text}</span></button>`;
        })
        .join("");

      cueList.querySelectorAll("[data-role='cue-item']").forEach((cueButton) => {
        cueButton.addEventListener("click", async () => {
          const timestamp = cueButton.getAttribute("data-ts") || "00:00";
          const seconds = parseTimestampToSeconds(timestamp);

          try {
            const loaded = await ensureCardReplayPlayerLoaded(api, sessionId, card, false);
            if (!loaded) {
              return;
            }

            loaded.player.currentTime = seconds;
            await loaded.player.play();
            loaded.status.textContent = `Playing from ${timestamp}.`;
          } catch {
            const status = card.querySelector("[data-role='player-status']");
            if (status) {
              status.textContent = "Could not jump to transcript cue.";
            }
          }
        });
      });
    });
  });
}

categoryFilter?.addEventListener("change", async () => {
  await loadLibrary();
});

addCategoryBtn?.addEventListener("click", async () => {
  const api = getMemoraApi();
  if (!api) {
    return;
  }

  const name = (newCategoryInput?.value ?? "").trim();
  if (!name) {
    statusText.textContent = "Enter a category name first.";
    return;
  }

  const result = await api.createCategory(name);
  if (!result.ok) {
    statusText.textContent = `Could not create category: ${result.reason}`;
    return;
  }

  newCategoryInput.value = "";
  statusText.textContent = "Category created.";
  await loadLibrary();
});

deleteCategoryBtn?.addEventListener("click", async () => {
  const api = getMemoraApi();
  if (!api || !categoryFilter) {
    return;
  }

  const selectedValue = categoryFilter.value;
  if (!selectedValue || selectedValue === "__uncategorized__") {
    statusText.textContent = "Select a named category to delete.";
    return;
  }

  const confirmed = window.confirm("Delete this category? Sessions will be moved to Uncategorized.");
  if (!confirmed) {
    return;
  }

  const result = await api.deleteCategory(selectedValue);
  if (!result.ok) {
    statusText.textContent = "Could not delete category.";
    return;
  }

  categoryFilter.value = "";
  statusText.textContent = "Category deleted.";
  await loadLibrary();
});

refreshBtn?.addEventListener("click", async () => {
  await loadLibrary();
  statusText.textContent = "Library refreshed.";
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.getAttribute("data-action");
    if (action === "logout") {
      const api = getMemoraApi();
      if (api) {
        api.logoutUser().catch(() => {
          // Continue logout flow on navigation.
        });
      }
      window.location.href = "./auth.html";
      return;
    }

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

if (backToTopBtn) {
  const syncVisibility = () => {
    backToTopBtn.classList.toggle("back-to-top--visible", window.scrollY > 260);
  };

  window.addEventListener("scroll", syncVisibility, { passive: true });
  backToTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  syncVisibility();
}

ensureAuthenticated()
  .then((authenticated) => {
    if (!authenticated) {
      return;
    }

    loadLibrary().catch((error) => {
      statusText.textContent = "Could not load library data.";
      console.error(error);
    });
  })
  .catch((error) => {
    statusText.textContent = "Could not verify account session.";
    console.error(error);
  });
