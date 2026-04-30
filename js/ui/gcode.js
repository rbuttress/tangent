// js/ui/gcode.js
//version no. 8.0

import { Slicer } from "../core/slicer.js";

export class GCodeManager {
  constructor(win, canvasRef) {
    this.win = win;
    this.canvas = canvasRef;
    this.slicedJobs = [];

    this.activeJobId = null;
    this.isPaused = false;

    this.isAutoplaying = false;
    this.autoplayIndex = 0;
    this.waitingForNextJob = false;

    this.config = JSON.parse(localStorage.getItem("gcodeConfig")) || {
      zRapid: -10,
      zCut: -22,
      liftAngle: 15,
      globalStart: 0,
      globalEnd: 0,
      outOvercut: 2,
      inUndercut: 2,
      enableDedup: true,
      overlapTol: 0.5,
      angleTol: 0.2,
      pivotFeed: 1000,
      bandHeight: 350,
    };

    this.injectStyles();
    this.initDOM();

    document.addEventListener("SPAWN_INSTANCE", () => this.renderHeader());
    document.addEventListener("REMOVE_INSTANCE", () => this.renderHeader());
    document.addEventListener("SELECTION_CHANGED", () => this.renderHeader());
    document.addEventListener("TOOL_CHANGED", () => this.renderHeader());

    document.addEventListener("CUTS_CLEARED_UI_UPDATE", () => {
      this.refreshAllControls();
      this.renderHeader();
    });

    document.addEventListener("CLEAR_GCODE_ENTIRELY", () => {
      this.clearGCodeData();
    });

    // The Visualizer will broadcast this event smoothly as the physical machine moves
    document.addEventListener("JOB_PROGRESS", (e) => {
      this.updateGcodeTextHighlight(e.detail.jobId, e.detail.lineIndex);
    });

    document.addEventListener("ROUTINE_START", () => {
      if (!this.isAutoplaying && this.slicedJobs.length > 0)
        this.startPlayAll();
    });

    document.addEventListener("ROUTINE_NEXT", () => {
      if (this.isAutoplaying && this.waitingForNextJob) {
        this.waitingForNextJob = false;
        this.playNextSubJob();
      }
    });

    document.addEventListener("JOB_COMPLETED", () => {
      const finishedJobId = this.activeJobId;
      this.activeJobId = null;
      this.isPaused = false;

      if (finishedJobId) {
        document.dispatchEvent(
          new CustomEvent("SUBJOB_COMPLETED", { detail: finishedJobId }),
        );
      }

      this.refreshAllControls();
      this.renderHeader();

      if (this.isAutoplaying) {
        this.autoplayIndex++;
        if (this.autoplayIndex < this.slicedJobs.length) {
          console.log(
            `%c[G-CODE] Routine paused. Waiting to continue...`,
            "color: #ffaa00",
          );
          this.waitingForNextJob = true;
        } else {
          console.log(`%c[G-CODE] Routine Complete.`, "color: #2BEA64");
          this.isAutoplaying = false;
          this.waitingForNextJob = false;
        }
      }
    });

    document.addEventListener("ABORT_JOB", () => {
      this.isAutoplaying = false;
      clearTimeout(this.autoplayTimeout);
      this.activeJobId = null;
      document.dispatchEvent(new CustomEvent("JOB_STOPPED"));
      this.refreshAllControls();
    });
  }

  injectStyles() {
    if (!document.getElementById("gcode-dynamic-styles")) {
      const style = document.createElement("style");
      style.id = "gcode-dynamic-styles";
      style.innerHTML = `
            .gcode-job-group { display: flex; flex-direction: column; border: 1px solid var(--glass-border); border-radius: 4px; background: rgba(0,0,0,0.2); overflow: hidden; transition: flex 0.2s; }
            .gcode-job-group.expanded { flex: 1; min-height: 150px; }
            .gcode-job-summary { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; cursor: pointer; font-size: 11px; background: rgba(255,255,255,0.05); }
            .gcode-job-summary:hover { background: rgba(255,255,255,0.1); }
            .gcode-job-content { display: none; flex: 1; overflow-y: auto; background: rgba(0,0,0,0.4); font-size: 10px; padding: 4px 0; scroll-behavior: smooth; position: relative; }
            .gcode-job-group.expanded .gcode-job-content { display: block; }
            .gcl { display: flex; justify-content: space-between; align-items: center; padding: 0 8px; font-family: monospace; cursor: crosshair; transition: background 0.1s; min-height: 18px; }
            .gcl.executed { background: rgba(43, 234, 100, 0.1); color: rgba(43, 234, 100, 0.7); }
            .gcl.active-line { background: rgba(43, 234, 100, 0.3); color: #2BEA64; font-weight: bold; border-left: 2px solid #2BEA64; }
            .gcl-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
            .gcl-controls { display: none; gap: 4px; }
            .gcl:hover { background: rgba(255, 0, 255, 0.4); color: #fff; }
            .gcl:hover .gcl-controls { display: flex; }
            .gcl-btn { background: transparent; border: 1px solid rgba(255,255,255,0.3); color: white; cursor: pointer; border-radius: 3px; font-size: 9px; padding: 1px 4px; }
            .gcl-btn:hover { background: rgba(255,255,255,0.3); }
            .gcode-job-content::-webkit-scrollbar { width: 6px; }
            .gcode-job-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
        `;
      document.head.appendChild(style);
    }
  }

  initDOM() {
    this.win.content.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 100%;">
            <div class="gcode-header-controls" id="gc-header"></div>
            <div class="gcode-tree" id="gc-tree" style="display: flex; flex-direction: column; gap: 5px; flex: 1; overflow: hidden; margin-top: 5px;"></div>
        </div>
    `;
    this.headerEl = this.win.content.querySelector("#gc-header");
    this.treeEl = this.win.content.querySelector("#gc-tree");
    this.renderHeader();
  }

  updateGcodeTextHighlight(jobId, currentLineIdx) {
    const group = this.treeEl.querySelector(`[data-job-id="${jobId}"]`);
    if (!group || !group.classList.contains("expanded")) return;

    const lines = group.querySelectorAll(".gcl");
    let activeElement = null;

    lines.forEach((lineEl) => {
      const idx = parseInt(lineEl.dataset.idx);
      lineEl.classList.remove("active-line", "executed");

      if (idx < currentLineIdx) {
        lineEl.classList.add("executed");
      } else if (idx === currentLineIdx) {
        lineEl.classList.add("active-line");
        activeElement = lineEl;
      }
    });

    if (activeElement) {
      activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  expandJobAccordion(jobId) {
    this.win.content.querySelectorAll(".gcode-job-group").forEach((el) => {
      if (el.dataset.jobId === jobId) el.classList.add("expanded");
      else el.classList.remove("expanded");
    });
  }

  clearGCodeData() {
    this.slicedJobs = [];
    this.activeJobId = null;
    this.isPaused = false;
    this.isAutoplaying = false;
    clearTimeout(this.autoplayTimeout);
    this.treeEl.innerHTML = "";
    this.renderHeader();
    document.dispatchEvent(new CustomEvent("CLEAR_GCODE_PREVIEW"));
  }

  renderHeader() {
    const hasPieces = this.canvas && this.canvas.placedInstances.length > 0;
    if (!hasPieces) {
      this.headerEl.innerHTML = `<span style="font-size: 10px; color: var(--text-muted);">Add patterns or draw lines on the canvas to generate.</span>`;
      return;
    }

    const hasJobs = this.slicedJobs.length > 0;
    const isSelectionActive = this.canvas.selection.items.size > 0;
    const genBtnText = isSelectionActive
      ? "Generate Selection"
      : "Generate All";

    const hasCuts =
      this.canvas &&
      (this.canvas.completedJobs.size > 0 ||
        Object.values(this.canvas.maxLineByJob).some((v) => v > -1));
    const clearBtnText = hasCuts ? "Clear Cuts" : "Clear GCode";

    this.headerEl.innerHTML = `
        <div style="display: flex; flex-direction: column; width: 100%;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="display: flex; gap: 5px;">
                    <button class="gear-btn" id="btn-gc-settings" title="G-Code Settings">⚙️</button>
                    <button class="glass-btn secondary" id="btn-gc-clear" style="font-size: 10px;">${clearBtnText}</button>
                    ${hasJobs ? `<button class="glass-btn primary" id="btn-gen-cut-line" style="font-size: 10px; ${!hasCuts ? "opacity:0.3; pointer-events:none;" : ""}">Gen Cut Line</button>` : ""}
                </div>
                <div style="display: flex; gap: 5px;">
                    ${hasJobs ? `<button class="glass-btn primary" id="btn-gc-play-all" style="font-size: 10px; background: rgba(100, 100, 255, 0.2); color: #8888ff; border-color: rgba(100, 100, 255, 0.4);" title="Play All Sub-Jobs">▶</button>` : ""}
                    ${hasJobs ? `<button class="glass-btn primary" id="btn-gc-dl" style="font-size: 10px; background: rgba(43, 234, 100, 0.2); color: #2BEA64; border-color: rgba(43, 234, 100, 0.4);" title="Save to File">.NC</button>` : ""}
                    <button class="glass-btn primary" id="btn-gc-gen" style="font-size: 10px; ${isSelectionActive ? "background: rgba(74, 144, 226, 0.2); color: #4a90e2; border-color: rgba(74, 144, 226, 0.5);" : ""}">${hasJobs ? "Regen" : genBtnText}</button>
                </div>
            </div>
            ${
              hasJobs
                ? `
            <div style="display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--glass-border); padding-top: 5px; margin-top: 5px; width: 100%;">
                <span style="font-size: 9px; color: var(--text-muted); white-space: nowrap;">FEEDRATE OVERRIDE</span>
                <input type="range" id="gc-feed-override" min="0.25" max="15" step="0.25" value="1.0" style="flex: 1; height: 10px;">
                <span id="gc-feed-val" style="font-size: 10px; width: 35px; text-align: right; color: var(--text-muted);">1.00x</span>
            </div>`
                : ""
            }
        </div>
    `;

    document.getElementById("btn-gc-settings").onclick = () =>
      this.openSettingsModal();

    document.getElementById("btn-gc-clear").onclick = () => {
      document.dispatchEvent(new CustomEvent("CLEAR_SMART"));
    };

    document.getElementById("btn-gc-gen").onclick = () =>
      this.generateGCodeFromCanvas();

    if (hasJobs) {
      document.getElementById("btn-gc-dl").onclick = () =>
        this.downloadMasterGCode();
      document.getElementById("btn-gc-play-all").onclick = () =>
        this.startPlayAll();

      const genBtn = document.getElementById("btn-gen-cut-line");
      if (genBtn && hasCuts) {
        genBtn.onmouseenter = () =>
          document.dispatchEvent(new CustomEvent("PREVIEW_GLOBAL_CUT_LINE"));
        genBtn.onmouseleave = () =>
          document.dispatchEvent(new CustomEvent("CLEAR_GLOBAL_CUT_LINE"));
        genBtn.onclick = () =>
          document.dispatchEvent(new CustomEvent("COMMIT_GLOBAL_CUT_LINE"));
      }

      const slider = document.getElementById("gc-feed-override");
      const valDisp = document.getElementById("gc-feed-val");
      if (slider) {
        slider.oninput = (e) => {
          const val = parseFloat(e.target.value);
          valDisp.textContent = val.toFixed(2) + "x";
          document.dispatchEvent(
            new CustomEvent("FEED_OVERRIDE", { detail: val }),
          );
        };
      }
    }
  }

  startPlayAll() {
    if (this.slicedJobs.length === 0) return;
    this.isAutoplaying = true;
    this.autoplayIndex = 0;
    this.playNextSubJob();
  }

  playNextSubJob() {
    if (!this.isAutoplaying || this.autoplayIndex >= this.slicedJobs.length) {
      this.isAutoplaying = false;
      this.refreshAllControls();
      return;
    }
    const job = this.slicedJobs[this.autoplayIndex];
    this.activeJobId = job.id;
    this.isPaused = false;
    this.expandJobAccordion(job.id);
    document.dispatchEvent(new CustomEvent("JOB_STARTED", { detail: job.id }));
    this.sendJobToMachine(job.gcode);
    this.refreshAllControls();
  }

  generateGCodeFromCanvas() {
    let targets =
      this.canvas.selection.items.size > 0
        ? this.canvas.selection.getAll()
        : this.canvas.placedInstances;
    if (targets.length === 0) return;

    const ox = this.canvas.loadedFabric ? this.canvas.fabricOffset.x : 0;
    const oy = this.canvas.loadedFabric ? this.canvas.fabricOffset.y : 0;

    const slicer = new Slicer(this.config, ox, oy);
    this.slicedJobs = slicer.process(targets);

    document.dispatchEvent(
      new CustomEvent("SIMULATOR_UPDATE", {
        detail: { jobs: this.slicedJobs, cutJob: null },
      }),
    );
    document.dispatchEvent(
      new CustomEvent("RENDER_GCODE_SOLID", { detail: true }),
    );

    this.renderTree();
    this.renderHeader();
  }

  sendJobToMachine(gcodeString) {
    const cleanGcode =
      gcodeString
        .split("\n")
        .map((line) => line.split(";")[0].trim())
        .filter((line) => line.length > 0)
        .join("\n") + "\n";
    document.dispatchEvent(
      new CustomEvent("STREAM_GCODE_JOB", { detail: cleanGcode }),
    );
  }

  refreshAllControls() {
    this.win.content.querySelectorAll(".gcode-job-group").forEach((group) => {
      const jobId = group.dataset.jobId;
      const actionsDiv = group.querySelector(".job-actions");
      actionsDiv.innerHTML = this.getJobControlsHTML(jobId);
      this.attachControlListeners(group, jobId);
    });
  }

  getJobControlsHTML(jobId) {
    if (this.activeJobId === null)
      return `<button class="glass-btn primary btn-play" style="padding: 2px 8px;">▶</button>`;
    if (this.activeJobId === jobId) {
      if (this.isPaused)
        return `<button class="glass-btn primary btn-resume" style="padding: 2px 8px; background: rgba(43, 234, 100, 0.2); color: #2BEA64;">▶</button> <button class="glass-btn secondary btn-stop" style="padding: 2px 8px; background: rgba(255, 60, 60, 0.2); color: #ff3c3c; border-color: rgba(255, 60, 60, 0.4);">⏹</button>`;
      return `<button class="glass-btn secondary btn-pause" style="padding: 2px 8px; background: rgba(255, 170, 0, 0.2); color: #ffaa00; border-color: rgba(255, 170, 0, 0.4);">⏸</button> <button class="glass-btn secondary btn-stop" style="padding: 2px 8px; background: rgba(255, 60, 60, 0.2); color: #ff3c3c; border-color: rgba(255, 60, 60, 0.4);">⏹</button>`;
    }
    return `<button class="glass-btn secondary" style="padding: 2px 8px; opacity: 0.3; pointer-events: none;">Busy</button>`;
  }

  attachControlListeners(group, jobId) {
    const playBtn = group.querySelector(".btn-play");
    const pauseBtn = group.querySelector(".btn-pause");
    const resumeBtn = group.querySelector(".btn-resume");
    const stopBtn = group.querySelector(".btn-stop");

    const job = this.slicedJobs.find((j) => j.id === jobId);

    if (playBtn)
      playBtn.onclick = (e) => {
        e.stopPropagation();
        this.activeJobId = jobId;
        this.isPaused = false;
        this.expandJobAccordion(jobId);
        document.dispatchEvent(
          new CustomEvent("CLEAR_JOB_CUTS", { detail: jobId }),
        );
        document.dispatchEvent(
          new CustomEvent("JOB_STARTED", { detail: jobId }),
        );
        this.sendJobToMachine(job.gcode);
        this.refreshAllControls();
      };
    if (pauseBtn)
      pauseBtn.onclick = (e) => {
        e.stopPropagation();
        this.isPaused = true;
        document.dispatchEvent(new CustomEvent("PAUSE_JOB"));
        this.refreshAllControls();
      };
    if (resumeBtn)
      resumeBtn.onclick = (e) => {
        e.stopPropagation();
        this.isPaused = false;
        document.dispatchEvent(new CustomEvent("RESUME_JOB"));
        this.refreshAllControls();
      };
    if (stopBtn)
      stopBtn.onclick = (e) => {
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent("ABORT_JOB"));
        document.dispatchEvent(new CustomEvent("JOB_STOPPED"));
      };
  }

  renderJobBlock(job) {
    const group = document.createElement("div");
    group.className = "gcode-job-group";
    group.dataset.jobId = job.id;

    const match = job.id.match(/\d+/);
    const titleLabel = `${match ? match[0] : "?"}. ${Math.min(job.topY, job.bottomY).toFixed(0)} - ${Math.max(job.topY, job.bottomY).toFixed(0)}`;

    const gcodeHtml = job.linesData
      .map((line) => {
        if (!line.text.trim()) return "";
        return `<div class="gcl" data-idx="${line.n}"><span class="gcl-text">${line.text}</span><div class="gcl-controls"><button class="gcl-btn btn-goto" data-x="${line.x}" data-y="${line.y}" data-a="${line.a}" title="Go to start of line">✦</button><button class="gcl-btn btn-playfrom" data-idx="${line.n}" title="Play from here">►</button></div></div>`;
      })
      .join("");

    group.innerHTML = `<div class="gcode-job-summary"><span>${titleLabel}</span><div style="display: flex;" class="job-actions">${this.getJobControlsHTML(job.id)}</div></div><div class="gcode-job-content">${gcodeHtml}</div>`;

    const summary = group.querySelector(".gcode-job-summary");
    summary.onclick = (e) => {
      if (e.target.closest(".job-actions")) return;
      const wasExp = group.classList.contains("expanded");
      this.win.content
        .querySelectorAll(".gcode-job-group")
        .forEach((el) => el.classList.remove("expanded"));
      if (!wasExp) group.classList.add("expanded");
    };

    this.attachControlListeners(group, job.id);
    const contentDiv = group.querySelector(".gcode-job-content");

    contentDiv.addEventListener("click", (e) => {
      const gotoBtn = e.target.closest(".btn-goto");
      if (gotoBtn) {
        e.stopPropagation();
        const x = parseFloat(gotoBtn.dataset.x),
          y = parseFloat(gotoBtn.dataset.y),
          a = parseFloat(gotoBtn.dataset.a);
        document.dispatchEvent(
          new CustomEvent("STREAM_GCODE_JOB", {
            detail: `G90 G0 Z0\nG90 G0 A${a.toFixed(4)}\nG90 G0 X${x.toFixed(4)} Y${y.toFixed(4)}\n`,
          }),
        );
        return;
      }

      const playBtn = e.target.closest(".btn-playfrom");
      if (playBtn) {
        e.stopPropagation();
        const idx = parseInt(playBtn.dataset.idx);
        const remainingLines =
          job.linesData
            .slice(idx)
            .map((l) => l.text)
            .join("\n") + "\n";
        const state = job.linesData[idx];

        this.activeJobId = job.id;
        this.isPaused = false;
        this.expandJobAccordion(job.id);

        document.dispatchEvent(
          new CustomEvent("PLAY_FROM_LINE", {
            detail: { jobId: job.id, lineIndex: idx },
          }),
        );
        document.dispatchEvent(
          new CustomEvent("JOB_STARTED", { detail: job.id }),
        );

        this.sendJobToMachine(
          `G90 G0 Z0\nG90 G0 A${state.a.toFixed(4)}\nG90 G0 X${state.x.toFixed(4)} Y${state.y.toFixed(4)}\n` +
            remainingLines,
        );
        this.refreshAllControls();
        return;
      }
    });

    contentDiv.addEventListener("mouseover", (e) => {
      const lineEl = e.target.closest(".gcl");
      if (lineEl)
        document.dispatchEvent(
          new CustomEvent("HOVER_GCODE_LINE", {
            detail: { jobId: job.id, lineIndex: parseInt(lineEl.dataset.idx) },
          }),
        );
    });
    contentDiv.addEventListener("mouseout", () =>
      document.dispatchEvent(
        new CustomEvent("HOVER_GCODE_LINE", { detail: null }),
      ),
    );

    group.onmouseenter = () =>
      document.dispatchEvent(
        new CustomEvent("HIGHLIGHT_SUBJOB", { detail: job }),
      );
    group.onmouseleave = () =>
      document.dispatchEvent(
        new CustomEvent("HIGHLIGHT_SUBJOB", { detail: null }),
      );

    return group;
  }

  renderTree() {
    this.treeEl.innerHTML = "";
    this.slicedJobs.forEach((job) =>
      this.treeEl.appendChild(this.renderJobBlock(job)),
    );
  }

  openSettingsModal() {
    // Unchanged Standard Boilerplate
    const modalLayer = document.getElementById("modal-layer");
    if (!modalLayer) return;

    const c = this.config;
    modalLayer.innerHTML = `
            <div class="glass-modal-overlay" id="gc-settings-overlay">
                <div class="glass-modal-content" style="max-width: 450px;">
                    <h3>Machine & Toolpath Settings</h3>
                    
                    <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 10px; text-transform: uppercase; font-weight: bold; border-bottom: 1px solid var(--glass-border); padding-bottom: 4px;">Workspace</div>
                    <div class="form-row">
                        <div class="form-group"><label>Band Height (mm)</label><input type="number" id="gc-band-height" value="${c.bandHeight || 350}" step="10"></div>
                    </div>

                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 15px; margin-bottom: 10px; text-transform: uppercase; font-weight: bold; border-bottom: 1px solid var(--glass-border); padding-bottom: 4px;">Z-Axis Control</div>
                    <div class="form-row">
                        <div class="form-group"><label>Z Rapid Height (mm)</label><input type="number" id="gc-z-rapid" value="${c.zRapid}" step="1"></div>
                        <div class="form-group"><label>Z Cut Depth (mm)</label><input type="number" id="gc-z-cut" value="${c.zCut}" step="1"></div>
                        <div class="form-group"><label>Lift Angle Threshold (°)</label><input type="number" id="gc-lift-ang" value="${c.liftAngle}" step="1"></div>
                    </div>

                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 15px; margin-bottom: 10px; text-transform: uppercase; font-weight: bold; border-bottom: 1px solid var(--glass-border); padding-bottom: 4px;">Line Adjustments (+ Extends / - Retracts)</div>
                    <div class="form-row">
                        <div class="form-group"><label>Global Start Offset</label><input type="number" id="gc-start" value="${c.globalStart}" step="0.5"></div>
                        <div class="form-group"><label>Global End Offset</label><input type="number" id="gc-end" value="${c.globalEnd}" step="0.5"></div>
                    </div>

                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 15px; margin-bottom: 10px; text-transform: uppercase; font-weight: bold; border-bottom: 1px solid var(--glass-border); padding-bottom: 4px;">Smart Corners</div>
                    <div class="form-row">
                        <div class="form-group"><label>Outside Corner Overcut</label><input type="number" id="gc-out-cut" value="${c.outOvercut}" step="0.5"></div>
                        <div class="form-group"><label>Inside Corner Undercut</label><input type="number" id="gc-in-cut" value="${c.inUndercut}" step="0.5"></div>
                    </div>
                    
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 15px; margin-bottom: 10px; text-transform: uppercase; font-weight: bold; border-bottom: 1px solid var(--glass-border); padding-bottom: 4px;">Toolpath Optimization</div>
                    <div class="form-row" style="align-items: center;">
                        <div class="form-group" style="flex-direction: row; align-items: center; gap: 8px;">
                            <input type="checkbox" id="gc-enable-dedup" ${c.enableDedup !== false ? "checked" : ""} style="width: auto; margin:0;">
                            <label style="margin:0; cursor:pointer;" for="gc-enable-dedup">Enable Line Deduplication</label>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group"><label>Overlap Tolerance (mm)</label><input type="number" id="gc-overlap" value="${c.overlapTol}" step="0.1"></div>
                        <div class="form-group"><label>Angle Tolerance (rad)</label><input type="number" id="gc-angle-tol" value="${c.angleTol !== undefined ? c.angleTol : 0.2}" step="0.05"></div>
                    </div>

                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 15px; margin-bottom: 10px; text-transform: uppercase; font-weight: bold; border-bottom: 1px solid var(--glass-border); padding-bottom: 4px;">Advanced</div>
                    <div class="form-row">
                        <div class="form-group"><label>In-Material Pivot Feed</label><input type="number" id="gc-pivot-feed" value="${c.pivotFeed || 1000}" step="100"></div>
                    </div>

                    <div class="modal-actions" style="margin-top: 20px;">
                        <button class="glass-btn secondary" id="btn-cancel-gc">Cancel</button>
                        <button class="glass-btn primary" id="btn-save-gc">Save Settings</button>
                    </div>
                </div>
            </div>
        `;

    document.getElementById("btn-cancel-gc").onclick = () =>
      (modalLayer.innerHTML = "");
    document.getElementById("btn-save-gc").onclick = () => {
      this.config = {
        zRapid: parseFloat(document.getElementById("gc-z-rapid").value) || -10,
        zCut: parseFloat(document.getElementById("gc-z-cut").value) || -22,
        liftAngle:
          parseFloat(document.getElementById("gc-lift-ang").value) || 15,
        globalStart: parseFloat(document.getElementById("gc-start").value) || 0,
        globalEnd: parseFloat(document.getElementById("gc-end").value) || 0,
        outOvercut:
          parseFloat(document.getElementById("gc-out-cut").value) || 0,
        inUndercut: parseFloat(document.getElementById("gc-in-cut").value) || 0,
        enableDedup: document.getElementById("gc-enable-dedup").checked,
        overlapTol:
          parseFloat(document.getElementById("gc-overlap").value) || 0.5,
        angleTol:
          parseFloat(document.getElementById("gc-angle-tol").value) || 0.2,
        pivotFeed:
          parseFloat(document.getElementById("gc-pivot-feed").value) || 1000,
        bandHeight:
          parseFloat(document.getElementById("gc-band-height").value) || 350,
      };
      localStorage.setItem("gcodeConfig", JSON.stringify(this.config));
      modalLayer.innerHTML = "";
      if (this.slicedJobs.length > 0) this.generateGCodeFromCanvas(); // Regen
    };
  }

  downloadMasterGCode() {
    let masterCode = "% \n; AUTOMATED TANGENTIAL NEST\n\n";
    this.slicedJobs.forEach(
      (job) => (masterCode += `; --- ${job.id} ---\n` + job.gcode + "\n"),
    );
    masterCode += "M30\n%\n";

    const blob = new Blob([masterCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NEST_JOB_${new Date().toISOString().slice(0, 10)}.nc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
