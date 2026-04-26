// js/ui/ranking.js
//version no. 1.4

export class RankingMenu {
  constructor(containerEl) {
    this.container = containerEl;
    if (!this.container) return;

    // THE FIX: Pull historical state from localStorage on boot
    this.currentTopIterations =
      JSON.parse(localStorage.getItem("savedNestingResults")) || [];
    this.activeResult =
      JSON.parse(localStorage.getItem("savedActiveResult")) || null;
    this.retainedResults =
      JSON.parse(localStorage.getItem("savedRetainedResults")) || [];

    this.initDOM();
    this.initHeaderProgress();

    // THE FIX: If we booted up with saved data, immediately render it!
    if (
      this.currentTopIterations.length > 0 ||
      this.retainedResults.length > 0
    ) {
      this.renderLeaderboard();
    }

    document.addEventListener("RUN_NESTING", () => {
      this.snapshotHistoricalElites();
      this.currentTopIterations = [];
      this.saveState();
      this.renderLeaderboard();
    });

    document.addEventListener("NESTING_LEADERBOARD_UPDATE", (e) => {
      this.currentTopIterations = e.detail.topIterations || e.detail;
      this.saveState();
      this.renderLeaderboard();

      if (e.detail.progress) {
        this.updateProgress(e.detail.progress);
      }
    });
  }

  // THE FIX: Helper to save the entire leaderboard state to the browser
  saveState() {
    localStorage.setItem(
      "savedNestingResults",
      JSON.stringify(this.currentTopIterations),
    );
    localStorage.setItem(
      "savedRetainedResults",
      JSON.stringify(this.retainedResults),
    );
    localStorage.setItem(
      "savedActiveResult",
      JSON.stringify(this.activeResult),
    );
  }

  initDOM() {
    this.container.innerHTML = `
      <div id="ranking-list" style="display: flex; flex-direction: column; gap: 4px;">
        <div style="color: var(--text-muted); font-size: 10px; font-style: italic; padding: 4px;">
          Awaiting Genetic Algorithm...
        </div>
      </div>
    `;
    this.listContainer = this.container.querySelector("#ranking-list");
  }

  initHeaderProgress() {
    const winEl = this.container.closest(".window");
    if (!winEl) return;
    const header = winEl.querySelector(".window-header");
    if (!header) return;

    header.style.position = "relative";
    header.style.overflow = "hidden";

    const titleArea = header.querySelector(".window-title-area");
    const controls = header.querySelector(".window-controls");
    if (titleArea) titleArea.style.zIndex = "1";
    if (controls) controls.style.zIndex = "1";

    this.totalProgressBar = document.createElement("div");
    this.totalProgressBar.style.cssText =
      "position: absolute; top: 0; left: 0; height: 100%; background: rgba(74, 144, 226, 0.2); z-index: 0; transition: width 0.3s ease; width: 0%; pointer-events: none;";

    this.genProgressBar = document.createElement("div");
    this.genProgressBar.style.cssText =
      "position: absolute; top: 0; left: 0; height: 100%; background: rgba(43, 234, 100, 0.15); z-index: 0; transition: width 0.1s linear; width: 0%; pointer-events: none;";

    header.insertBefore(this.totalProgressBar, header.firstChild);
    header.insertBefore(this.genProgressBar, header.firstChild);
  }

  updateProgress(progress) {
    if (!this.totalProgressBar || !this.genProgressBar) return;

    const totalPct = (progress.currentGen / progress.totalGens) * 100;
    this.totalProgressBar.style.width = `${totalPct}%`;
    this.genProgressBar.style.width = `${progress.genProgress}%`;

    const statusText = this.container
      .closest(".window")
      ?.querySelector(".status-text");
    if (statusText) {
      statusText.innerText = `GEN ${progress.currentGen}/${progress.totalGens}`;
      statusText.style.color = "var(--text-main)";
    }
  }

  snapshotHistoricalElites() {
    if (this.currentTopIterations.length === 0) return;

    let keepers = [];
    const top3 = this.currentTopIterations.slice(0, 3);

    if (this.activeResult) {
      const isActiveInTop3 = top3.some(
        (r) =>
          r.id === this.activeResult.id && r.score === this.activeResult.score,
      );
      if (!isActiveInTop3) {
        keepers.push(this.activeResult);
        keepers.push(...this.currentTopIterations.slice(0, 2));
      } else {
        keepers.push(...top3);
      }
    } else {
      keepers.push(...top3);
    }

    this.retainedResults = keepers.map((r, i) => ({
      ...r,
      isRetained: true,
      displayId: `Prev-${i + 1}`,
    }));
  }

  renderRow(result, isRetainedSection) {
    const row = document.createElement("div");

    const isActive =
      this.activeResult &&
      this.activeResult.score === result.score &&
      this.activeResult.id === result.id;

    row.className = `hud-iteration ${isActive ? "active" : ""}`;

    const barAlpha = isRetainedSection ? "0.15" : "0.25";
    const displayId = result.isRetained ? result.displayId : result.id;

    row.innerHTML = `
        <div class="hud-iteration-bar" style="width: ${result.score}%; background: rgba(74, 144, 226, ${barAlpha});"></div>
        <div class="hud-iteration-content" style="padding: 4px 10px;">
            <span class="iter-number" style="font-family: monospace;">ID: ${displayId}</span>
            <span class="iter-score">${result.score.toFixed(2)}% Yield</span>
        </div>
      `;

    row.onclick = () => {
      this.activeResult = result;
      this.saveState();

      document
        .querySelectorAll(".hud-iteration")
        .forEach((el) => el.classList.remove("active"));
      row.classList.add("active");

      // THE FIX: Send the whole result object so the G-Code compiler gets the cutLine!
      document.dispatchEvent(
        new CustomEvent("PREVIEW_ITERATION", { detail: result }),
      );
    };

    row.onmouseenter = () => {
      document.dispatchEvent(
        new CustomEvent("HOVER_PREVIEW_START", { detail: result }),
      );
    };

    row.onmouseleave = () => {
      document.dispatchEvent(new CustomEvent("HOVER_PREVIEW_END"));
    };

    return row;
  }

  renderLeaderboard() {
    this.listContainer.innerHTML = "";

    if (
      this.currentTopIterations.length === 0 &&
      this.retainedResults.length === 0
    ) {
      this.listContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 10px; padding: 4px;">Running initial sweeps...</div>`;
      return;
    }

    // 1. Render Live Stream
    this.currentTopIterations.forEach((result) => {
      this.listContainer.appendChild(this.renderRow(result, false));
    });

    // 2. Render Historical Snapshots
    if (this.retainedResults.length > 0) {
      const divider = document.createElement("div");
      divider.style.cssText =
        "font-size: 9px; color: var(--text-muted); text-transform: uppercase; margin: 8px 0 4px 4px; border-bottom: 1px solid rgba(74, 144, 226, 0.2); padding-bottom: 2px; font-weight: bold;";
      divider.innerText = "Previous Run Elites";
      this.listContainer.appendChild(divider);

      this.retainedResults.forEach((result) => {
        this.listContainer.appendChild(this.renderRow(result, true));
      });
    }
  }
}
