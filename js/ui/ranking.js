// js/ui/ranking.js
//version no. 1.6

export class RankingMenu {
  constructor(containerEl) {
    this.container = containerEl;
    if (!this.container) return;

    this.currentTopIterations =
      JSON.parse(localStorage.getItem("savedNestingResults")) || [];
    this.activeResult =
      JSON.parse(localStorage.getItem("savedActiveResult")) || null;
    this.retainedResults =
      JSON.parse(localStorage.getItem("savedRetainedResults")) || [];

    this.initDOM();
    this.initHeaderProgress();

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
        <div id="ranking-list" style="display: flex; flex-direction: column; gap: 1px; width: 100%;">
            <span style="font-size: 10px; color: var(--text-muted); font-style: italic; padding: 4px;">Awaiting nesting data...</span>
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
      statusText.innerText = `${progress.currentGen}/${progress.totalGens}`;
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

  // THE FIX: Added 'index' parameter to explicitly display current rank
  renderRow(result, isRetainedSection, index) {
    const row = document.createElement("div");

    // Identity is now safely tracked by the permanent ID
    const isActive = this.activeResult && this.activeResult.id === result.id;

    row.style.cssText = `
        position: relative; 
        cursor: pointer; 
        height: 16px; 
        display: flex; 
        align-items: center; 
        padding: 0 4px; 
        font-family: monospace; 
        font-size: 10px;
        color: ${isActive ? "var(--text-main)" : "var(--text-muted)"};
    `;

    const barAlpha = isRetainedSection ? "0.15" : "0.3";
    const activeColor = "rgba(43, 234, 100, 0.35)";
    const barColor = isActive ? activeColor : `rgba(74, 144, 226, ${barAlpha})`;

    // Labeling Logic
    const rankStr = isRetainedSection ? "PREV" : `#${index + 1}`;
    const iterLabel =
      result.gen !== undefined && result.pop !== undefined
        ? `${result.gen}.${result.pop}`
        : result.displayId || result.id;

    row.innerHTML = `
        <div style="position: absolute; top: 0; left: 0; height: 100%; width: ${result.score}%; background: ${barColor}; z-index: 0; pointer-events: none;"></div>
        <div style="position: relative; z-index: 1; ${isActive ? "font-weight: bold; color: #2BEA64;" : ""} display: flex; justify-content: space-between; width: 100%;">
            <span>${rankStr} &nbsp; ${result.score.toFixed(2)}%</span>
            <span style="opacity: 0.6;">${iterLabel}</span>
        </div>
    `;

    row.onclick = () => {
      this.activeResult = result;
      this.saveState();
      this.renderLeaderboard();
      document.dispatchEvent(
        new CustomEvent("PREVIEW_ITERATION", { detail: result }),
      );
    };

    row.onmouseenter = () =>
      document.dispatchEvent(
        new CustomEvent("HOVER_PREVIEW_START", { detail: result }),
      );
    row.onmouseleave = () =>
      document.dispatchEvent(new CustomEvent("HOVER_PREVIEW_END"));

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
    this.currentTopIterations.forEach((result, index) => {
      this.listContainer.appendChild(this.renderRow(result, false, index));
    });

    // 2. Render Historical Snapshots
    if (this.retainedResults.length > 0) {
      const spacer = document.createElement("div");
      spacer.style.height = "8px";
      this.listContainer.appendChild(spacer);

      this.retainedResults.forEach((result, index) => {
        this.listContainer.appendChild(this.renderRow(result, true, index));
      });
    }
  }
}
