// js/visualizer/canvas.js
//version no. 6.2

import { HistoryManager } from "./history.js";
import { InputManager } from "./input.js";
import { Renderer } from "./renderer.js";
import { SelectionManager } from "./selection.js";
import { machine } from "../core/machine.js";
import {
  SelectTool,
  FabricDragTool,
  DrawPolyTool,
  BoxTool,
  BoxMaskTool,
  FreeMaskTool,
  PolyMaskTool,
  CutFabricTool,
  PolyCutTool,
} from "./tools.js";

export class Visualizer {
  constructor(canvasId, controller) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.controller = controller;

    // --- Core View State ---
    this.viewport = { offsetX: 0, offsetY: 0, targetY: 0, scale: 1.0 };
    this.bounds = { width: 1600 };
    this.toolRadius = 10;

    // --- Application Data State ---
    this.activeTracePoints = [];
    this.loadedFabric = JSON.parse(localStorage.getItem("savedFabric")) || null;
    this.fabricOffset = JSON.parse(
      localStorage.getItem("savedFabricOffset"),
    ) || { x: 0, y: 0 };
    this.placedInstances =
      JSON.parse(localStorage.getItem("savedInstances")) || [];

    // --- Interaction State ---
    this.activeDrawing = [];
    this.currentMousePos = null;
    this.isAltHeld = false;
    this.altTargetPos = null;

    // --- Simulator & UI Overlay State ---
    this.isNestingLive = false;
    this.ghostLayout = [];
    this.ghostTestingPoly = null;
    this.hoverPreviewData = null;
    this.gcodeSolidData = null;
    this.highlightedJob = null;
    this.simulatorJobs = [];
    this.simulatorCutJob = null;

    // --- Active Job History Tracking ---
    this.hoveredGcodeLine = null;
    this.completedJobs = new Set();
    this.maxLineByJob = {};
    this.globalCutLinePreview = null;
    this.activeJobId = null;

    // --- Sub-Modules ---
    this.selection = new SelectionManager();
    this.history = new HistoryManager(this, 30);
    this.input = new InputManager(this);
    this.renderer = new Renderer(this);

    this.tools = {
      SELECT: new SelectTool(this),
      DRAG_FABRIC: new FabricDragTool(this),
      DRAW_POLY: new DrawPolyTool(this),
      BOX: new BoxTool(this),
      BOX_MASK: new BoxMaskTool(this),
      FREE_MASK: new FreeMaskTool(this),
      POLY_MASK: new PolyMaskTool(this),
      CUT_FABRIC: new CutFabricTool(this),
      POLY_CUT: new PolyCutTool(this),
    };
    this.currentTool = this.tools["SELECT"];

    this.bindJobStateListeners();

    // --- Initialize ---
    this.input.init();
    this.renderer.animate();
    this.history.record();
  }

  bindJobStateListeners() {
    document.addEventListener("HOVER_GCODE_LINE", (e) => {
      this.hoveredGcodeLine = e.detail;
    });

    document.addEventListener("JOB_STARTED", (e) => {
      this.activeJobId = e.detail;
    });

    document.addEventListener("JOB_STOPPED", () => {
      this.activeJobId = null;
    });

    // KINEMATIC COORDINATE TRACKING
    machine.onUpdate(() => {
      if (!this.activeJobId || !this.simulatorJobs) return;
      const job = this.simulatorJobs.find((j) => j.id === this.activeJobId);
      if (!job) return;

      const mx = machine.currentPos.x;
      const my = machine.currentPos.y;
      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;

      const currentMax = this.maxLineByJob[this.activeJobId] || -1;
      let nextIdx = currentMax;

      const searchWindow = job.simPaths.filter(
        (p) => p.lineIndex > currentMax && p.lineIndex <= currentMax + 10,
      );

      for (const path of searchWindow) {
        let pX, pY;
        if (path.type === "G0" || path.type === "G1") {
          pX = path.p1.x + ox;
          pY = path.p1.y + oy;
        } else if (path.type === "PIVOT_MAT" || path.type === "PIVOT_AIR") {
          pX = path.p.x + ox;
          pY = path.p.y + oy;
        }

        if (pX !== undefined && pY !== undefined) {
          const dist = Math.hypot(pX - mx, pY - my);
          if (dist < 2.0) {
            nextIdx = Math.max(nextIdx, path.lineIndex);
          }
        }
      }

      if (nextIdx > currentMax) {
        this.maxLineByJob[this.activeJobId] = nextIdx;

        this.completedCutPaths = [];
        this.simulatorJobs.forEach((j) => {
          const isFullyCompleted = this.completedJobs.has(j.id);
          const maxLine = this.maxLineByJob[j.id] ?? -1;
          j.simPaths.forEach((path) => {
            if (
              path.type === "G1" &&
              (isFullyCompleted || path.lineIndex <= maxLine)
            ) {
              this.completedCutPaths.push(path);
            }
          });
        });

        document.dispatchEvent(
          new CustomEvent("JOB_PROGRESS", {
            detail: { jobId: this.activeJobId, lineIndex: nextIdx },
          }),
        );
      }
    });

    document.addEventListener("PLAY_FROM_LINE", (e) => {
      const { jobId, lineIndex } = e.detail;
      this.maxLineByJob[jobId] = lineIndex - 1;
    });

    document.addEventListener("SUBJOB_COMPLETED", (e) => {
      this.completedJobs.add(e.detail);
      document.dispatchEvent(new CustomEvent("COMPLETED_CUTS_UPDATED"));
    });

    document.addEventListener("CLEAR_JOB_CUTS", (e) => {
      const jobId = e.detail;
      this.completedJobs.delete(jobId);
      if (this.maxLineByJob[jobId] !== undefined)
        delete this.maxLineByJob[jobId];
      document.dispatchEvent(new CustomEvent("COMPLETED_CUTS_UPDATED"));
    });

    document.addEventListener("CLEAR_SMART", () => {
      const hasCuts =
        this.completedJobs.size > 0 ||
        Object.values(this.maxLineByJob).some((v) => v > -1);
      if (hasCuts) {
        this.completedJobs.clear();
        this.maxLineByJob = {};
        this.globalCutLinePreview = null;
        this.completedCutPaths = [];
        document.dispatchEvent(new CustomEvent("CUTS_CLEARED_UI_UPDATE"));
      } else {
        document.dispatchEvent(new CustomEvent("CLEAR_GCODE_ENTIRELY"));
      }
    });

    document.addEventListener("CLEAR_GCODE_PREVIEW", () => {
      this.completedJobs.clear();
      this.maxLineByJob = {};
      this.completedCutPaths = [];
      this.globalCutLinePreview = null;
      document.dispatchEvent(new CustomEvent("COMPLETED_CUTS_UPDATED"));
    });

    document.addEventListener("PREVIEW_GLOBAL_CUT_LINE", () => {
      if (this.completedCutPaths.length === 0 || !this.loadedFabric) return;

      let minX = Infinity,
        maxX = -Infinity,
        maxY = -Infinity,
        minY = Infinity;
      this.loadedFabric.edgeProfile.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
      const fBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

      const resolution = 5;
      const cutRadius = window.NestConfig
        ? window.NestConfig.cutRadius || 50
        : 50;
      const cols = Math.ceil(fBox.w / resolution) + 1;
      const rawProfile = new Array(cols);
      const fabric = this.loadedFabric;

      for (let i = 0; i < cols; i++) {
        const scanX = fBox.x + i * resolution;
        let highestY = -Infinity;

        for (let j = 0; j < fabric.edgeProfile.length; j++) {
          const p1 = fabric.edgeProfile[j];
          const p2 = fabric.edgeProfile[(j + 1) % fabric.edgeProfile.length];
          const minXEdge = Math.min(p1.x, p2.x);
          const maxXEdge = Math.max(p1.x, p2.x);

          if (scanX >= minXEdge && scanX <= maxXEdge && minXEdge !== maxXEdge) {
            const t = (scanX - p1.x) / (p2.x - p1.x);
            const y = p1.y + t * (p2.y - p1.y);
            if (y > highestY) highestY = y;
          }
        }
        rawProfile[i] = highestY !== -Infinity ? highestY : fBox.y + fBox.h;
      }

      this.completedCutPaths.forEach((path) => {
        const p1 = path.p1,
          p2 = path.p2;
        const minXCut = Math.min(p1.x, p2.x),
          maxXCut = Math.max(p1.x, p2.x);
        if (minXCut === maxXCut) return;

        const startCol = Math.max(
          0,
          Math.floor((minXCut - fBox.x) / resolution),
        );
        const endCol = Math.min(
          cols - 1,
          Math.ceil((maxXCut - fBox.x) / resolution),
        );

        for (let col = startCol; col <= endCol; col++) {
          const scanX = fBox.x + col * resolution;
          if (scanX >= minXCut && scanX <= maxXCut) {
            const t = (scanX - p1.x) / (p2.x - p1.x);
            const y = p1.y + t * (p2.y - p1.y);
            if (y < rawProfile[col]) rawProfile[col] = y;
          }
        }
      });

      const windowSize = Math.max(1, Math.floor(cutRadius / resolution));
      const lowered = new Array(cols);

      for (let i = 0; i < cols; i++) {
        let localMin = rawProfile[i];
        for (let w = -windowSize; w <= windowSize; w++) {
          if (i + w >= 0 && i + w < cols) {
            if (rawProfile[i + w] < localMin) localMin = rawProfile[i + w];
          }
        }
        lowered[i] = localMin - 5;
      }

      const smoothed = new Array(cols);
      for (let i = 0; i < cols; i++) {
        let sum = 0,
          count = 0;
        for (let w = -windowSize; w <= windowSize; w++) {
          if (i + w >= 0 && i + w < cols) {
            sum += lowered[i + w];
            count++;
          }
        }
        smoothed[i] = sum / count;
      }

      const finalLine = [];
      for (let i = 0; i < cols; i++) {
        finalLine.push({ x: fBox.x + i * resolution, y: smoothed[i] });
      }

      this.globalCutLinePreview = finalLine;
    });

    document.addEventListener("CLEAR_GLOBAL_CUT_LINE", () => {
      this.globalCutLinePreview = null;
    });

    document.addEventListener("COMMIT_GLOBAL_CUT_LINE", () => {
      if (
        !this.globalCutLinePreview ||
        !this.loadedFabric ||
        typeof ClipperLib === "undefined"
      )
        return;

      const scale = 1000;

      const removePoly = this.globalCutLinePreview.map((p) => ({
        X: Math.round(p.x * scale),
        Y: Math.round(p.y * scale),
      }));

      const lastX = removePoly[removePoly.length - 1].X;
      const firstX = removePoly[0].X;

      removePoly.push({ X: lastX + 10000 * scale, Y: 10000 * scale });
      removePoly.push({ X: firstX - 10000 * scale, Y: 10000 * scale });

      const fabPoly = this.loadedFabric.edgeProfile.map((p) => ({
        X: Math.round(p.x * scale),
        Y: Math.round(p.y * scale),
      }));

      const c = new ClipperLib.Clipper();
      c.AddPaths([fabPoly], ClipperLib.PolyType.ptSubject, true);
      c.AddPaths([removePoly], ClipperLib.PolyType.ptClip, true);

      const solution = new ClipperLib.Paths();
      c.Execute(
        ClipperLib.ClipType.ctDifference,
        solution,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero,
      );

      if (solution.length > 0) {
        let largestPoly = solution[0];
        let maxArea = 0;
        solution.forEach((poly) => {
          const area = Math.abs(ClipperLib.Clipper.Area(poly));
          if (area > maxArea) {
            maxArea = area;
            largestPoly = poly;
          }
        });

        this.loadedFabric.edgeProfile = largestPoly.map((p) => ({
          x: p.X / scale,
          y: p.Y / scale,
        }));

        this.completedJobs.clear();
        this.maxLineByJob = {};
        this.completedCutPaths = [];
        this.globalCutLinePreview = null;

        this.saveState();

        document.dispatchEvent(new CustomEvent("COMPLETED_CUTS_UPDATED"));
        document.dispatchEvent(new CustomEvent("CLEAR_GCODE_ENTIRELY"));
      }
    });
  }

  setTool(toolName) {
    if (this.tools[toolName]) {
      this.currentTool = this.tools[toolName];
    }
  }

  undo() {
    this.history.undo();
  }
  redo() {
    this.history.redo();
  }

  saveState() {
    if (!this.history.isRestoring) this.history.record();
    localStorage.setItem("savedFabric", JSON.stringify(this.loadedFabric));
    localStorage.setItem(
      "savedFabricOffset",
      JSON.stringify(this.fabricOffset),
    );
    localStorage.setItem(
      "savedInstances",
      JSON.stringify(this.placedInstances),
    );
  }

  gantryToPx(x) {
    return this.input.gantryToPx(x);
  }
  worldToPx(x, y) {
    return this.input.worldToPx(x, y);
  }
  screenToWorld(screenX, screenY) {
    return this.input.screenToWorld(screenX, screenY);
  }
}
