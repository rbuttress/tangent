// js/ui/ranking.js
//version no. 1.3

export class RankingMenu {
  constructor(containerEl) {
    this.container = containerEl;
    if (!this.container) return;

    this.currentTopIterations = [];
    this.activeResult = null; // Tracks whichever layout the user clicked last
    this.retainedResults = []; // Holds the snapshots from the previous run

    this.initDOM();
    this.initHeaderProgress();

    // THE FIX: Snapshot the old leaderboard the moment a new run starts
    document.addEventListener("RUN_NESTING", () => {
      this.snapshotHistoricalElites();
      this.currentTopIterations = [];
      this.renderLeaderboard();
    });

    document.addEventListener("NESTING_LEADERBOARD_UPDATE", (e) => {
      this.currentTopIterations = e.detail.topIterations || e.detail;
      this.renderLeaderboard();

      if (e.detail.progress) {
        this.updateProgress(e.detail.progress);
      }
    });
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

  // THE FIX: Determines which 3 layouts to preserve before wiping the board
  snapshotHistoricalElites() {
    if (this.currentTopIterations.length === 0) return;

    let keepers = [];
    const top3 = this.currentTopIterations.slice(0, 3);

    if (this.activeResult) {
      // Did the user click something outside the top 3?
      const isActiveInTop3 = top3.some(
        (r) =>
          r.id === this.activeResult.id && r.score === this.activeResult.score,
      );
      if (!isActiveInTop3) {
        // Keep the active out-of-bounds one, plus the true top 2
        keepers.push(this.activeResult);
        keepers.push(...this.currentTopIterations.slice(0, 2));
      } else {
        // It's in the top 3 anyway, just keep the top 3
        keepers.push(...top3);
      }
    } else {
      // No active selection, keep standard top 3
      keepers.push(...top3);
    }

    // Remap them so they render with a distinct visual ID
    this.retainedResults = keepers.map((r, i) => ({
      ...r,
      isRetained: true,
      displayId: `Prev-${i + 1}`,
    }));
  }

  renderRow(result, isRetainedSection) {
    const row = document.createElement("div");

    // Determine if this exact layout is the one currently active/selected
    const isActive =
      this.activeResult &&
      this.activeResult.score === result.score &&
      this.activeResult.id === result.id;

    row.className = `hud-iteration ${isActive ? "active" : ""}`;

    // Mute the blue progress bar slightly if it's an old retained result
    const barAlpha = isRetainedSection ? "0.15" : "0.25";
    const displayId = result.isRetained ? result.displayId : result.id;

    row.innerHTML = `
        <div class="hud-iteration-bar" style="width: ${result.score}%; background: rgba(74, 144, 226, ${barAlpha});"></div>
        <div class="hud-iteration-content" style="padding: 4px 10px;">
            <span class="iter-number" style="font-family: monospace;"> ${displayId}</span>
            <span class="iter-score">${result.score.toFixed(2)}% Yield</span>
        </div>
      `;

    row.onclick = () => {
      // Store this as the globally active result so snapshotting remembers it next time
      this.activeResult = result;

      document
        .querySelectorAll(".hud-iteration")
        .forEach((el) => el.classList.remove("active"));
      row.classList.add("active");

      document.dispatchEvent(
        new CustomEvent("PREVIEW_ITERATION", { detail: result.layout }),
      );
    };

    row.onmouseenter = () => {
      document.dispatchEvent(
        new CustomEvent("HOVER_PREVIEW_START", { detail: result.layout }),
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
      divider.innerText = "Previous Run";
      this.listContainer.appendChild(divider);

      this.retainedResults.forEach((result) => {
        this.listContainer.appendChild(this.renderRow(result, true));
      });
    }
  }
}
