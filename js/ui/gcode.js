// js/ui/gcode.js
//version no. 5.6

export class GCodeManager {
  constructor(win) {
    this.win = win;
    this.activeNest = null;
    this.slicedJobs = [];
    this.cutLineJob = null;

    this.activeJobId = null;
    this.isPaused = false;

    this.isAutoplaying = false;
    this.autoplayIndex = 0;
    this.autoplayTimeout = null;

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

    this.initDOM();

    document.addEventListener("PREVIEW_ITERATION", (e) => {
      this.activeNest = e.detail;
      this.slicedJobs = [];
      this.cutLineJob = null;
      this.renderHeader();
      document.dispatchEvent(
        new CustomEvent("RENDER_GCODE_SOLID", { detail: this.activeNest }),
      );
    });

    document.addEventListener("JOB_COMPLETED", () => {
      this.activeJobId = null;
      this.isPaused = false;
      this.refreshAllControls();

      if (this.isAutoplaying) {
        this.autoplayIndex++;
        if (this.autoplayIndex < this.slicedJobs.length) {
          console.log(
            `%c[G-CODE] Autoplay: Waiting 5s before next job...`,
            "color: #aaffaa",
          );
          this.autoplayTimeout = setTimeout(() => {
            this.playNextSubJob();
          }, 5000);
        } else {
          console.log(
            `%c[G-CODE] Autoplay Sequence Complete.`,
            "color: #2BEA64",
          );
          this.isAutoplaying = false;
        }
      }
    });

    document.addEventListener("ABORT_JOB", () => {
      this.isAutoplaying = false;
      clearTimeout(this.autoplayTimeout);
    });
  }

  initDOM() {
    this.win.content.innerHTML = `
            <div class="gcode-header-controls" id="gc-header"></div>
            <div class="gcode-tree" id="gc-tree" style="display: flex; flex-direction: column; gap: 5px;"></div>
        `;
    this.headerEl = this.win.content.querySelector("#gc-header");
    this.treeEl = this.win.content.querySelector("#gc-tree");
    this.renderHeader();
  }

  // --- THE FIX: Unified Clear Method ---
  clearGCodeData() {
    this.activeNest = null;
    this.slicedJobs = [];
    this.cutLineJob = null;
    this.activeJobId = null;
    this.isPaused = false;
    this.isAutoplaying = false;
    clearTimeout(this.autoplayTimeout);

    this.treeEl.innerHTML = "";
    this.renderHeader();
    document.dispatchEvent(new CustomEvent("CLEAR_GCODE_PREVIEW"));
  }

  renderHeader() {
    if (!this.activeNest) {
      this.headerEl.innerHTML = `<span style="font-size: 10px; color: var(--text-muted);">Select a nest to generate.</span>`;
      return;
    }

    const hasJobs = this.slicedJobs.length > 0;

    this.headerEl.innerHTML = `
        <div style="display: flex; flex-direction: column; width: 100%;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="display: flex; gap: 5px;">
                    <button class="gear-btn" id="btn-gc-settings" title="G-Code Settings">⚙️</button>
                    <button class="glass-btn secondary" id="btn-gc-clear" style="font-size: 10px;">Clear</button>
                </div>
                <div style="display: flex; gap: 5px;">
                    ${hasJobs ? `<button class="glass-btn primary" id="btn-gc-play-all" style="font-size: 10px; background: rgba(100, 100, 255, 0.2); color: #8888ff; border-color: rgba(100, 100, 255, 0.4);" title="Play All Sub-Jobs">▶</button>` : ""}
                    ${hasJobs ? `<button class="glass-btn primary" id="btn-gc-dl" style="font-size: 10px; background: rgba(43, 234, 100, 0.2); color: #2BEA64; border-color: rgba(43, 234, 100, 0.4);" title="Save to File">.NC</button>` : ""}
                    <button class="glass-btn primary" id="btn-gc-gen" style="font-size: 10px;">${hasJobs ? "Regen" : "Generate G-Code"}</button>
                </div>
            </div>
            ${
              hasJobs
                ? `
            <div style="display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--glass-border); padding-top: 10px; margin-top: 10px; width: 100%;">
                <span style="font-size: 10px; color: var(--text-muted); white-space: nowrap;">FEEDRATE OVERRIDE</span>
                <input type="range" id="gc-feed-override" min="0.25" max="15" step="0.25" value="1.0" style="flex: 1;">
                <span id="gc-feed-val" style="font-size: 10px; width: 35px; text-align: right; color: var(--text-muted);">1.00x</span>
            </div>`
                : ""
            }
        </div>
    `;

    document.getElementById("btn-gc-settings").onclick = () =>
      this.openSettingsModal();

    // THE FIX: Route the header Clear button to the new method
    document.getElementById("btn-gc-clear").onclick = () =>
      this.clearGCodeData();

    document.getElementById("btn-gc-gen").onclick = () =>
      this.processNestIntoGCode();

    if (hasJobs) {
      document.getElementById("btn-gc-dl").onclick = () =>
        this.downloadMasterGCode();
      document.getElementById("btn-gc-play-all").onclick = () =>
        this.startPlayAll();

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
    this.sendJobToMachine(job.gcode);
    this.refreshAllControls();
  }

  openSettingsModal() {
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
      if (this.slicedJobs.length > 0) this.processNestIntoGCode();
    };
  }

  getPolygonArea(poly) {
    let area = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    return area / 2;
  }

  generateCompensatedToolpaths(layout) {
    let compensatedLines = [];
    const { globalStart, globalEnd, outOvercut, inUndercut, liftAngle } =
      this.config;
    const liftAngleRad = liftAngle * (Math.PI / 180);

    layout.forEach((inst) => {
      const poly = inst.piece.vertices.map((v) => ({
        x: inst.x + v.x,
        y: inst.y + v.y,
      }));
      const isCCW = this.getPolygonArea(poly) > 0;

      let segments = [];
      for (let i = 0; i < poly.length; i++)
        segments.push({
          p1: { ...poly[i] },
          p2: { ...poly[(i + 1) % poly.length] },
        });

      for (let i = 0; i < poly.length; i++) {
        const segIn = segments[(i - 1 + poly.length) % poly.length];
        const segOut = segments[i];

        const vIn = {
          x: poly[i].x - poly[(i - 1 + poly.length) % poly.length].x,
          y: poly[i].y - poly[(i - 1 + poly.length) % poly.length].y,
        };
        const vOut = {
          x: poly[(i + 1) % poly.length].x - poly[i].x,
          y: poly[(i + 1) % poly.length].y - poly[i].y,
        };

        const lenIn = Math.hypot(vIn.x, vIn.y),
          lenOut = Math.hypot(vOut.x, vOut.y);
        if (lenIn === 0 || lenOut === 0) continue;

        let angleIn = Math.atan2(vIn.y, vIn.x);
        let angleOut = Math.atan2(vOut.y, vOut.x);
        let diff = angleOut - angleIn;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff <= -Math.PI) diff += 2 * Math.PI;
        diff = Math.abs(diff);

        if (diff > liftAngleRad) {
          const cp = vIn.x * vOut.y - vIn.y * vOut.x;
          const cornerOvercut = (isCCW ? cp > 0 : cp < 0)
            ? outOvercut
            : -inUndercut;

          segIn.p2.x += (vIn.x / lenIn) * (globalEnd + cornerOvercut);
          segIn.p2.y += (vIn.y / lenIn) * (globalEnd + cornerOvercut);

          segOut.p1.x -= (vOut.x / lenOut) * (globalStart + cornerOvercut);
          segOut.p1.y -= (vOut.y / lenOut) * (globalStart + cornerOvercut);
        }
      }
      compensatedLines.push(...segments);
    });

    return compensatedLines;
  }

  extractGeometryForBand(toolpaths, cutLine, topY, bottomY) {
    let segments = [];
    toolpaths.forEach((line) =>
      this.clipLineToBand(line.p1, line.p2, topY, bottomY, segments),
    );
    if (cutLine) {
      for (let i = 0; i < cutLine.length - 1; i++)
        this.clipLineToBand(
          cutLine[i],
          cutLine[i + 1],
          topY,
          bottomY,
          segments,
          true,
        );
    }
    return segments;
  }

  clipLineToBand(p1, p2, top, bottom, output, isCut = false) {
    const yMin = Math.min(p1.y, p2.y),
      yMax = Math.max(p1.y, p2.y);
    if (yMax < bottom || yMin > top) return;

    let s1 = { ...p1 },
      s2 = { ...p2 };
    if (s1.y > top) s1 = this.intersectY(p1, p2, top);
    if (s2.y > top) s2 = this.intersectY(p1, p2, top);
    if (s1.y < bottom) s1 = this.intersectY(p1, p2, bottom);
    if (s2.y < bottom) s2 = this.intersectY(p1, p2, bottom);

    output.push({ p1: s1, p2: s2, isCutLine: isCut });
  }

  intersectY(a, b, yTarget) {
    const t = (yTarget - a.y) / (b.y - a.y);
    return { x: a.x + t * (b.x - a.x), y: yTarget };
  }

  deduplicateCommonLines(lines) {
    if (this.config.enableDedup === false) return lines;
    let output = [...lines];
    const tol = this.config.overlapTol || 0.5;
    const cosAngleTol = Math.cos(
      this.config.angleTol !== undefined ? this.config.angleTol : 0.2,
    );

    let i = 0;
    while (i < output.length) {
      let A = output[i];
      let clipped = false;

      for (let j = 0; j < output.length; j++) {
        if (i === j) continue;
        let B = output[j];

        const dx1 = A.p2.x - A.p1.x,
          dy1 = A.p2.y - A.p1.y;
        const dx2 = B.p2.x - B.p1.x,
          dy2 = B.p2.y - B.p1.y;
        const len1 = Math.hypot(dx1, dy1),
          len2 = Math.hypot(dx2, dy2);

        if (len1 === 0 || len2 === 0) continue;

        if (Math.abs((dx1 * dx2 + dy1 * dy2) / (len1 * len2)) < cosAngleTol)
          continue;
        if (
          Math.abs(dx1 * (B.p1.y - A.p1.y) - dy1 * (B.p1.x - A.p1.x)) / len1 >
          tol
        )
          continue;

        const t3 =
          ((B.p1.x - A.p1.x) * dx1 + (B.p1.y - A.p1.y) * dy1) / (len1 * len1);
        const t4 =
          ((B.p2.x - A.p1.x) * dx1 + (B.p2.y - A.p1.y) * dy1) / (len1 * len1);

        const overlapStart = Math.max(0, Math.min(t3, t4));
        const overlapEnd = Math.min(1, Math.max(t3, t4));

        if ((overlapEnd - overlapStart) * len1 > 0.05) {
          let newSegments = [];
          if (overlapStart * len1 > 0.05)
            newSegments.push({
              p1: { x: A.p1.x, y: A.p1.y },
              p2: {
                x: A.p1.x + overlapStart * dx1,
                y: A.p1.y + overlapStart * dy1,
              },
            });
          if ((1 - overlapEnd) * len1 > 0.05)
            newSegments.push({
              p1: {
                x: A.p1.x + overlapEnd * dx1,
                y: A.p1.y + overlapEnd * dy1,
              },
              p2: { x: A.p2.x, y: A.p2.y },
            });
          output.splice(i, 1, ...newSegments);
          clipped = true;
          break;
        }
      }
      if (!clipped) i++;
    }
    return output;
  }

  chainSegments(segments) {
    if (segments.length === 0) return [];
    let pool = [...segments],
      chains = [],
      currentPoint = { x: pool[0].p1.x, y: pool[0].p1.y };

    while (pool.length > 0) {
      let bestIdx = -1,
        bestDist = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const d1 = Math.hypot(
          pool[i].p1.x - currentPoint.x,
          pool[i].p1.y - currentPoint.y,
        );
        if (d1 < bestDist) {
          bestDist = d1;
          bestIdx = i;
        }
      }
      const seg = pool.splice(bestIdx, 1)[0];
      chains.push(seg);
      currentPoint = seg.p2;
    }
    return chains;
  }

  processNestIntoGCode() {
    if (!this.activeNest) return;

    const layout = Array.isArray(this.activeNest)
      ? this.activeNest
      : this.activeNest.layout || [];
    const cutLine = Array.isArray(this.activeNest)
      ? null
      : this.activeNest.cutLine;

    if (layout.length === 0) return;

    let toolpaths = this.generateCompensatedToolpaths(layout);
    toolpaths = this.deduplicateCommonLines(toolpaths);

    let minY = Infinity,
      maxY = -Infinity;
    toolpaths.forEach((line) => {
      if (line.p1.y < minY) minY = line.p1.y;
      if (line.p1.y > maxY) maxY = line.p1.y;
      if (line.p2.y < minY) minY = line.p2.y;
      if (line.p2.y > maxY) maxY = line.p2.y;
    });

    if (cutLine) {
      cutLine.forEach((p) => {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    }

    const bandHeight = this.config.bandHeight || 350;
    this.jobMaxY = maxY;
    this.slicedJobs = [];
    let currentTopY = maxY,
      lastBandTopY = maxY,
      bandIndex = 1;

    while (currentTopY > minY - 10) {
      const currentBottomY = currentTopY - bandHeight;
      const rawGeometry = this.extractGeometryForBand(
        toolpaths,
        null,
        currentTopY,
        currentBottomY,
      );
      const sliceGeometry = this.chainSegments(rawGeometry);

      if (sliceGeometry.length > 0) {
        const jobData = this.compileGCodeForSlice(
          sliceGeometry,
          currentTopY,
          currentBottomY,
        );
        this.slicedJobs.push({
          id: `Sub-Job ${bandIndex}`,
          topY: currentTopY,
          bottomY: currentBottomY,
          geometry: sliceGeometry,
          gcode: jobData.code,
          simPaths: jobData.simPaths,
        });
        bandIndex++;
      }
      lastBandTopY = currentTopY;
      currentTopY -= bandHeight;
    }

    if (cutLine && cutLine.length > 0) {
      let cMinY = Infinity,
        cMaxY = -Infinity;
      cutLine.forEach((p) => {
        if (p.y < cMinY) cMinY = p.y;
        if (p.y > cMaxY) cMaxY = p.y;
      });
      const cutGeom = [];
      for (let i = 0; i < cutLine.length - 1; i++)
        cutGeom.push({ p1: cutLine[i], p2: cutLine[i + 1], isCutLine: true });

      const cutJobData = this.compileGCodeForSlice(
        cutGeom,
        lastBandTopY,
        cMinY,
      );
      this.cutLineJob = {
        id: `Sever Fabric`,
        isCutLine: true,
        topY: cMaxY,
        bottomY: cMinY,
        geometry: cutGeom,
        gcode: cutJobData.code,
        simPaths: cutJobData.simPaths,
      };
    }

    document.dispatchEvent(
      new CustomEvent("SIMULATOR_UPDATE", {
        detail: { jobs: this.slicedJobs, cutJob: this.cutLineJob },
      }),
    );
    this.renderTree();
    this.renderHeader();
  }

  compileGCodeForSlice(geometry, bandTopY, bandBottomY) {
    const { zRapid, zCut, liftAngle, pivotFeed } = this.config;
    const fOffset = JSON.parse(localStorage.getItem("savedFabricOffset")) || {
      x: 0,
      y: 0,
    };

    let code = `G90 ; Absolute Coordinates\nG0 Z${zRapid} ; Ensure Knife is UP\n`;
    let simPaths = [];

    let lastX = null,
      lastY = null,
      lastA = 0;
    let lastWorldX = null,
      lastWorldY = null;
    const liftAngleRad = liftAngle * (Math.PI / 180);

    geometry.forEach((line) => {
      const mX1 = line.p1.x + fOffset.x;
      const mX2 = line.p2.x + fOffset.x;

      const mY1 = line.p1.y - this.jobMaxY + fOffset.y;
      const mY2 = line.p2.y - this.jobMaxY + fOffset.y;

      let angleRad = Math.atan2(mY2 - mY1, mX2 - mX1);

      while (angleRad - lastA > Math.PI) angleRad -= 2 * Math.PI;
      while (angleRad - lastA < -Math.PI) angleRad += 2 * Math.PI;

      const isConnected =
        lastX !== null &&
        Math.abs(mX1 - lastX) < 5.0 &&
        Math.abs(mY1 - lastY) < 5.0;

      if (!isConnected) {
        code += `\n; Rapid to Start\n`;
        code += `G0 Z${zRapid}\n`;

        if (lastX !== null && lastY !== null) {
          const rapidDist = Math.hypot(mX1 - lastX, mY1 - lastY);
          if (rapidDist > 20) {
            let rapidA = Math.atan2(mY1 - lastY, mX1 - lastX);
            while (rapidA - lastA > Math.PI) rapidA -= 2 * Math.PI;
            while (rapidA - lastA < -Math.PI) rapidA += 2 * Math.PI;

            code += `G0 A${rapidA.toFixed(4)} ; Align for long rapid\n`;
            lastA = rapidA;

            while (angleRad - lastA > Math.PI) angleRad -= 2 * Math.PI;
            while (angleRad - lastA < -Math.PI) angleRad += 2 * Math.PI;
          }
        }

        code += `G0 X${mX1.toFixed(4)} Y${mY1.toFixed(4)}\n`;
        code += `G0 A${angleRad.toFixed(4)}\n`;
        code += `G1 Z${zCut} F1000\n`;

        if (lastWorldX !== null) {
          simPaths.push({
            type: "G0",
            p1: { x: lastWorldX, y: lastWorldY },
            p2: { x: line.p1.x, y: line.p1.y },
          });
        }
      } else {
        const angleDiff = Math.abs(angleRad - lastA);

        if (angleDiff > liftAngleRad) {
          code += `; Corner Lift\n`;
          code += `G0 Z${zRapid}\n`;

          if (Math.abs(mX1 - lastX) > 0.01 || Math.abs(mY1 - lastY) > 0.01) {
            code += `G0 X${mX1.toFixed(4)} Y${mY1.toFixed(4)}\n`;
            simPaths.push({
              type: "G0",
              p1: { x: lastWorldX, y: lastWorldY },
              p2: { x: line.p1.x, y: line.p1.y },
            });
          }

          code += `G0 A${angleRad.toFixed(4)}\n`;
          code += `G1 Z${zCut} F1000\n`;

          simPaths.push({
            type: "PIVOT_AIR",
            p: { x: line.p1.x, y: line.p1.y },
            a1: lastA,
            a2: angleRad,
          });
        } else if (angleDiff > 0.001) {
          code += `G1 A${angleRad.toFixed(4)} F${pivotFeed || 1000} ; Pivot\n`;
          simPaths.push({
            type: "PIVOT_MAT",
            p: { x: line.p1.x, y: line.p1.y },
            a1: lastA,
            a2: angleRad,
          });
        }
      }

      code += `G1 X${mX2.toFixed(4)} Y${mY2.toFixed(4)} F3000\n`;

      simPaths.push({
        type: "G1",
        p1: { x: line.p1.x, y: line.p1.y },
        p2: { x: line.p2.x, y: line.p2.y },
        isCutLine: line.isCutLine,
      });

      lastX = parseFloat(mX2.toFixed(4));
      lastY = parseFloat(mY2.toFixed(4));
      lastA = parseFloat(angleRad.toFixed(4));
      lastWorldX = line.p2.x;
      lastWorldY = line.p2.y;
    });

    const parkY = bandBottomY - this.jobMaxY + fOffset.y;

    let endA = 0;
    while (endA - lastA > Math.PI) endA -= 2 * Math.PI;
    while (endA - lastA < -Math.PI) endA += 2 * Math.PI;

    code += `\n; --- SLICE COMPLETE ---\nG0 Z${zRapid}\nG0 X0 Y${parkY.toFixed(4)}\nG0 Z0\nG0 A${endA.toFixed(4)}\nG28.3 A0 ; Zero internal A-axis coordinate\nM0 ; Pull Fabric\n`;

    return { code, simPaths };
  }

  sendJobToMachine(gcodeString) {
    document.dispatchEvent(
      new CustomEvent("STREAM_GCODE_JOB", { detail: gcodeString }),
    );
  }

  updateVirtualFabric(cutLine) {
    if (!cutLine || cutLine.length === 0) return;

    let nestMaxY = -Infinity;
    const layout = Array.isArray(this.activeNest)
      ? this.activeNest
      : this.activeNest.layout || [];

    if (layout.length > 0) {
      layout.forEach((inst) => {
        inst.piece.vertices.forEach((v) => {
          const y = inst.y + v.y;
          if (y > nestMaxY) nestMaxY = y;
        });
      });
    }

    const sortedLine = [...cutLine].sort((a, b) => a.x - b.x);

    const padX = 20;
    const minX = sortedLine[0].x - padX;
    const maxX = sortedLine[sortedLine.length - 1].x + padX;

    let cutMaxY = -Infinity;
    sortedLine.forEach((p) => {
      if (p.y > cutMaxY) cutMaxY = p.y;
    });

    const topY = Math.max(cutMaxY, nestMaxY) + 50;

    let clipPoly = [];

    clipPoly.push({ x: minX, y: topY });
    clipPoly.push({ x: maxX, y: topY });
    clipPoly.push({ x: maxX, y: sortedLine[sortedLine.length - 1].y });

    for (let i = sortedLine.length - 1; i >= 0; i--) {
      clipPoly.push({ x: sortedLine[i].x, y: sortedLine[i].y });
    }

    clipPoly.push({ x: minX, y: sortedLine[0].y });

    document.dispatchEvent(
      new CustomEvent("VIRTUAL_FABRIC_CUT", {
        detail: {
          cutLine: cutLine,
          clippingPolygon: clipPoly,
        },
      }),
    );
  }

  refreshAllControls() {
    this.win.content.querySelectorAll(".gcode-job-group").forEach((group) => {
      const jobId = group.dataset.jobId;
      const isCutLine = group.dataset.isCut === "true";
      const actionsDiv = group.querySelector(".job-actions");
      actionsDiv.innerHTML = this.getJobControlsHTML(jobId, isCutLine);
      this.attachControlListeners(group, jobId, isCutLine);
    });
  }

  getJobControlsHTML(jobId, isCutLine) {
    if (this.activeJobId === null) {
      let html = `<button class="glass-btn primary btn-play" style="padding: 2px 8px;">▶</button>`;
      if (isCutLine)
        html += `<button class="glass-btn secondary btn-omit" style="padding: 2px 8px;">Omit</button>`;
      return html;
    } else if (this.activeJobId === jobId) {
      if (this.isPaused) {
        return `
          <button class="glass-btn primary btn-resume" style="padding: 2px 8px; background: rgba(43, 234, 100, 0.2); color: #2BEA64;">▶</button>
          <button class="glass-btn secondary btn-stop" style="padding: 2px 8px; background: rgba(255, 60, 60, 0.2); color: #ff3c3c; border-color: rgba(255, 60, 60, 0.4);">⏹</button>
        `;
      } else {
        return `
          <button class="glass-btn secondary btn-pause" style="padding: 2px 8px; background: rgba(255, 170, 0, 0.2); color: #ffaa00; border-color: rgba(255, 170, 0, 0.4);">⏸</button>
          <button class="glass-btn secondary btn-stop" style="padding: 2px 8px; background: rgba(255, 60, 60, 0.2); color: #ff3c3c; border-color: rgba(255, 60, 60, 0.4);">⏹</button>
        `;
      }
    } else {
      return `<button class="glass-btn secondary" style="padding: 2px 8px; opacity: 0.3; pointer-events: none;">Busy</button>`;
    }
  }

  // THE FIX: Included clearGCodeData call on Omit and Cut
  attachControlListeners(group, jobId, isCutLine) {
    const playBtn = group.querySelector(".btn-play");
    const pauseBtn = group.querySelector(".btn-pause");
    const resumeBtn = group.querySelector(".btn-resume");
    const stopBtn = group.querySelector(".btn-stop");
    const omitBtn = group.querySelector(".btn-omit");

    const job =
      jobId === "Sever Fabric"
        ? this.cutLineJob
        : this.slicedJobs.find((j) => j.id === jobId);
    const cutLine = Array.isArray(this.activeNest)
      ? null
      : this.activeNest.cutLine;

    if (playBtn)
      playBtn.onclick = (e) => {
        e.stopPropagation();
        this.activeJobId = jobId;
        this.isPaused = false;
        this.sendJobToMachine(job.gcode);
        if (isCutLine) {
          this.updateVirtualFabric(cutLine);
          this.clearGCodeData();
        } else {
          this.refreshAllControls();
        }
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
      };

    if (omitBtn)
      omitBtn.onclick = (e) => {
        e.stopPropagation();
        this.updateVirtualFabric(cutLine);
        this.clearGCodeData();
      };
  }

  renderJobBlock(job, isCutLine = false) {
    const group = document.createElement("div");
    group.className = "gcode-job-group";
    group.dataset.jobId = job.id;
    group.dataset.isCut = isCutLine;

    group.innerHTML = `
            <div class="gcode-job-summary" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; flex-direction: column;">
                    <span>${job.id}</span>
                    <span style="font-size:9px; font-weight: normal; color: var(--text-muted);">Y: ${job.topY.toFixed(0)} to ${job.bottomY.toFixed(0)}</span>
                </div>
                <div style="display: flex; gap: 4px;" class="job-actions">
                    ${this.getJobControlsHTML(job.id, isCutLine)}
                </div>
            </div>
            <div class="gcode-job-content"><div class="gcode-lines-wrap">${job.gcode}</div></div>
        `;

    const summary = group.querySelector(".gcode-job-summary");
    summary.onclick = (e) => {
      if (e.target.closest(".job-actions")) return;
      const wasExp = group.classList.contains("expanded");
      this.win.content
        .querySelectorAll(".gcode-job-group")
        .forEach((el) => el.classList.remove("expanded"));
      if (!wasExp) group.classList.add("expanded");
    };

    this.attachControlListeners(group, job.id, isCutLine);

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
    if (this.cutLineJob) {
      const div = document.createElement("div");
      div.style.cssText =
        "margin-top: 10px; border-top: 1px dashed var(--glass-border); padding-top: 5px;";
      this.treeEl.appendChild(div);
      this.treeEl.appendChild(this.renderJobBlock(this.cutLineJob, true));
    }
  }

  downloadMasterGCode() {
    let masterCode = "% \n; AUTOMATED TANGENTIAL NEST\n\n";
    this.slicedJobs.forEach(
      (job) => (masterCode += `; --- ${job.id} ---\n` + job.gcode + "\n"),
    );
    if (this.cutLineJob)
      masterCode += `; --- SEVER FABRIC ---\n` + this.cutLineJob.gcode + "\n";
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
