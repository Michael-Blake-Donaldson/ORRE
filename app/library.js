const categoryFilter = document.getElementById("libraryCategoryFilter");
const newCategoryInput = document.getElementById("libraryNewCategoryInput");
const addCategoryBtn = document.getElementById("libraryAddCategoryBtn");
const deleteCategoryBtn = document.getElementById("libraryDeleteCategoryBtn");
const refreshBtn = document.getElementById("libraryRefreshBtn");
const statusText = document.getElementById("libraryStatus");
const sessionGrid = document.getElementById("librarySessionGrid");
const dashboardNavBtn = document.querySelector(".nav-item[data-page='dashboard']");

function getMemoraApi() {
  if (window.memora) {
    return window.memora;
  }

  statusText.textContent = "Desktop bridge unavailable. Restart app with npm run dev.";
  return null;
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

dashboardNavBtn?.addEventListener("click", () => {
  window.location.href = "./index.html";
});

loadLibrary().catch((error) => {
  statusText.textContent = "Could not load library data.";
  console.error(error);
});
