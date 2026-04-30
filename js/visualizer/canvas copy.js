// js/visualizer/canvas.js
//version no. 4.6

import { machine } from "../core/machine.js";
import { Nester } from "../core/nester.js";
import { SelectionManager } from "./selection.js";
import {
  SelectTool,
  FabricDragTool,
  DrawPolyTool,
  LassoTool,
} from "./tools.js";

export class Visualizer {
  constructor(canvasId, controller) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.controller = controller;

    this.viewport = { offsetX: 0, offsetY: 0, targetY: 0, scale: 1.0 };
    this.bounds = { width: 1600 };
    this.toolRadius = 10;

    // --- State Management ---
    this.activeTracePoints = [];
    this.loadedFabric = JSON.parse(localStorage.getItem("savedFabric")) || null;
    this.fabricOffset = JSON.parse(
      localStorage.getItem("savedFabricOffset"),
    ) || { x: 0, y: 0 };
    this.placedInstances =
      JSON.parse(localStorage.getItem("savedInstances")) || [];

    this.activeDrawing = [];
    this.currentMousePos = null;

    // --- UNDO / REDO HISTORY STATE ---
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 30;
    this.isRestoring = false; // Flag to prevent history loops

    this.isCtrlHeld = false;
    this.ctrlTargetPos = null; // World coordinates of mouse

    this.selection = new SelectionManager();

    this.tools = {
      SELECT: new SelectTool(this),
      DRAG_FABRIC: new FabricDragTool(this),
      DRAW_POLY: new DrawPolyTool(this),
      LASSO: new LassoTool(this),
    };
    this.currentTool = this.tools["SELECT"];

    this.dashOffset = 0;
    this.isNestingLive = false;
    this.ghostLayout = [];
    this.ghostTestingPoly = null;
    this.hoverPreviewData = null;
    this.gcodeSolidData = null;
    this.highlightedJob = null;
    this.simulatorJobs = [];
    this.simulatorCutJob = null;

    this.initEventListeners();
    this.init();

    // Capture the blank/loaded starting state
    this.recordHistory();
  }

  setTool(toolName) {
    if (this.tools[toolName]) {
      this.currentTool = this.tools[toolName];
    }
  }

  // --- THE FIX: UNDO / REDO CAPABILITIES ---

  recordHistory() {
    if (this.isRestoring) return;

    // If we undo'd back a few steps and then made a change, truncate the "future"
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    const snapshot = {
      placedInstances: JSON.parse(JSON.stringify(this.placedInstances)),
      loadedFabric: JSON.parse(JSON.stringify(this.loadedFabric)),
      fabricOffset: JSON.parse(JSON.stringify(this.fabricOffset)),
      nestingMaskPoly: JSON.parse(
        JSON.stringify(this.selection.nestingMaskPoly),
      ),
    };

    this.history.push(snapshot);
    if (this.history.length > this.maxHistory + 1) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }
  }

  undo() {
    if (this.historyIndex > 0) {
      this.isRestoring = true;
      this.historyIndex--;
      this.applySnapshot(this.history[this.historyIndex]);
      this.isRestoring = false;
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.isRestoring = true;
      this.historyIndex++;
      this.applySnapshot(this.history[this.historyIndex]);
      this.isRestoring = false;
    }
  }

  applySnapshot(snapshot) {
    this.placedInstances = JSON.parse(JSON.stringify(snapshot.placedInstances));
    this.loadedFabric = JSON.parse(JSON.stringify(snapshot.loadedFabric));
    this.fabricOffset = JSON.parse(JSON.stringify(snapshot.fabricOffset));
    this.selection.nestingMaskPoly = JSON.parse(
      JSON.stringify(snapshot.nestingMaskPoly),
    );

    this.selection.clear();

    // Manually update localStorage without triggering another recordHistory
    localStorage.setItem("savedFabric", JSON.stringify(this.loadedFabric));
    localStorage.setItem(
      "savedFabricOffset",
      JSON.stringify(this.fabricOffset),
    );
    localStorage.setItem(
      "savedInstances",
      JSON.stringify(this.placedInstances),
    );

    // Sync the Queue and the G-Code menus
    document.dispatchEvent(
      new CustomEvent("SYNC_QUEUE", { detail: this.placedInstances }),
    );
    document.dispatchEvent(new CustomEvent("SELECTION_CHANGED"));
  }

  // ------------------------------------------

  initEventListeners() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Control" && !this.isCtrlHeld) {
        this.isCtrlHeld = true;
        document.body.style.cursor = "crosshair";
      }
    });

    document.addEventListener("keyup", (e) => {
      if (e.key === "Control") {
        this.isCtrlHeld = false;
        this.ctrlTargetPos = null;
        document.body.style.cursor = "default";

        // Revert the A-axis to its original position if we didn't click
        const port = localStorage.getItem("last-port");
        if (port && !this.controller.isStreaming) {
          this.controller.spjs.send(`send ${port} G90 G0 A0\n`);
        }
      }
    });

    document.addEventListener("SPAWN_INSTANCE", (e) => {
      const piece = e.detail.piece;
      let pos = { x: 50, y: -50 };

      if (this.loadedFabric) {
        const autoPos = Nester.placePiece(
          piece,
          this.loadedFabric,
          this.placedInstances,
        );
        if (autoPos) pos = autoPos;
      } else {
        const cascade = (this.placedInstances.length * 15) % 150;
        pos = { x: 50 + cascade, y: -50 - cascade };
      }

      this.placedInstances.push({
        id: piece.name + "_" + Date.now() + Math.random(),
        piece: piece,
        x: pos.x,
        y: pos.y,
        rotation: 0,
        nestingEnabled: true,
      });
      this.saveState();
    });

    document.addEventListener("REMOVE_INSTANCE", (e) => {
      for (let i = this.placedInstances.length - 1; i >= 0; i--) {
        const inst = this.placedInstances[i];
        if (
          (e.detail.id && inst.id === e.detail.id) ||
          (!e.detail.id && inst.piece.name === e.detail.piece.name)
        ) {
          this.selection.remove(inst);
          this.placedInstances.splice(i, 1);
          this.saveState();
          break;
        }
      }
    });

    document.addEventListener("PREVIEW_ITERATION", (e) => {
      this.isNestingLive = false;
      const diyLines = this.placedInstances.filter((p) => p.isDiy);
      const newLayout = Array.isArray(e.detail)
        ? e.detail
        : e.detail.layout || [];
      this.placedInstances = [...newLayout, ...diyLines];
      this.selection.clear();
      this.saveState();
    });

    document.addEventListener("NESTING_GHOST_FRAME", (e) => {
      this.isNestingLive = true;
      this.ghostLayout = e.detail.layout;
      this.ghostTestingPoly = e.detail.testingPoly;
    });

    document.addEventListener("STOP_NESTING", () => {
      this.isNestingLive = false;
      this.ghostLayout = [];
      this.ghostTestingPoly = null;
    });

    document.addEventListener("HOVER_PREVIEW_START", (e) => {
      this.hoverPreviewData = e.detail;
    });

    document.addEventListener("HOVER_PREVIEW_END", () => {
      this.hoverPreviewData = null;
    });

    document.addEventListener("TRACE_UPDATED", (e) => {
      this.activeTracePoints = e.detail;
    });

    document.addEventListener("RENDER_GCODE_SOLID", (e) => {
      this.isNestingLive = false;
      this.gcodeSolidData = e.detail;
    });

    document.addEventListener("CLEAR_GCODE_PREVIEW", () => {
      this.gcodeSolidData = null;
      this.highlightedJob = null;
      this.simulatorJobs = [];
      this.simulatorCutJob = null;
    });

    document.addEventListener("SIMULATOR_UPDATE", (e) => {
      this.simulatorJobs = e.detail.jobs;
      this.simulatorCutJob = e.detail.cutJob;
    });

    document.addEventListener("HIGHLIGHT_SUBJOB", (e) => {
      this.highlightedJob = e.detail;
    });

    this.canvas.addEventListener("mousedown", (e) => {
      const worldPos = this.screenToWorld(e.offsetX, e.offsetY);
      if (e.ctrlKey) {
        e.preventDefault();
        const port = localStorage.getItem("last-port");
        if (port) {
          const dx = worldPos.x - machine.currentPos.x;
          const dy = worldPos.y - machine.currentPos.y;
          let targetAngle = Math.atan2(dy, dx);

          // Normalize angle for A-axis
          while (targetAngle - machine.currentPos.a > Math.PI)
            targetAngle -= 2 * Math.PI;
          while (targetAngle - machine.currentPos.a < -Math.PI)
            targetAngle += 2 * Math.PI;

          let streamStr = `G90 G0 A${targetAngle.toFixed(3)}\n`;
          streamStr += `G90 G0 X${worldPos.x.toFixed(3)} Y${worldPos.y.toFixed(3)}\n`;
          streamStr += `G90 G0 A0\n`;

          document.dispatchEvent(
            new CustomEvent("STREAM_GCODE_JOB", { detail: streamStr }),
          );
          console.log(
            `[UI] Rapid Jog Sequence to X${worldPos.x.toFixed(3)} Y${worldPos.y.toFixed(3)}`,
          );

          // Prevent the tool from also processing this click
          return;
        }
      }
      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;
      const localPos = { x: worldPos.x - ox, y: worldPos.y - oy };
      this.currentTool.onMouseDown(e, worldPos, localPos);
    });

    let lastJogAimTime = 0;
    const JOG_AIM_THROTTLE_MS = 300;

    this.canvas.addEventListener("mousemove", (e) => {
      const worldPos = this.screenToWorld(e.offsetX, e.offsetY);
      if (this.isCtrlHeld) {
        this.ctrlTargetPos = worldPos;

        const port = localStorage.getItem("last-port");
        if (
          port &&
          !this.controller.isStreaming &&
          now - lastJogAimTime > JOG_AIM_THROTTLE_MS
        ) {
          const dx = worldPos.x - machine.currentPos.x;
          const dy = worldPos.y - machine.currentPos.y;
          let targetAngle = Math.atan2(dy, dx);

          while (targetAngle - machine.currentPos.a > Math.PI)
            targetAngle -= 2 * Math.PI;
          while (targetAngle - machine.currentPos.a < -Math.PI)
            targetAngle += 2 * Math.PI;

          // Only send if the angle actually changed by at least 1 degree (0.017 rad)
          if (Math.abs(targetAngle - machine.currentPos.a) > 0.017) {
            this.controller.spjs.send(
              `send ${port} G90 G0 A${targetAngle.toFixed(3)}\n`,
            );
            lastJogAimTime = now;
          }
        }
      } else {
        this.ctrlTargetPos = null;
      }

      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;
      const localPos = { x: worldPos.x - ox, y: worldPos.y - oy };
      this.currentTool.onMouseMove(e, worldPos, localPos);
      document.dispatchEvent(
        new CustomEvent("CANVAS_COORDS", { detail: worldPos }),
      );
    });

    this.canvas.addEventListener("mouseup", (e) => {
      const worldPos = this.screenToWorld(e.offsetX, e.offsetY);
      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;
      const localPos = { x: worldPos.x - ox, y: worldPos.y - oy };
      this.currentTool.onMouseUp(e, worldPos, localPos);
    });

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const worldPos = this.screenToWorld(e.offsetX, e.offsetY);
      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;
      const localPos = { x: worldPos.x - ox, y: worldPos.y - oy };
      this.currentTool.onContextMenu(e, worldPos, localPos);
    });

    document.addEventListener("FABRIC_LOADED", (e) => {
      this.loadedFabric = e.detail ? e.detail.fabric : null;
      if (!this.loadedFabric) {
        this.fabricOffset = { x: 0, y: 0 };
        this.saveState();
        this.focusView(true);
        return;
      }
      this.saveState();
      this.focusView(true);
    });
  }

  saveState() {
    if (!this.isRestoring) this.recordHistory();
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
    return {
      x: this.viewport.offsetX + x * this.viewport.scale,
      y: this.viewport.offsetY,
    };
  }
  worldToPx(x, y) {
    return {
      x: this.viewport.offsetX + x * this.viewport.scale,
      y:
        this.viewport.offsetY -
        (y - machine.currentPos.y) * this.viewport.scale,
    };
  }
  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.viewport.offsetX) / this.viewport.scale,
      y:
        machine.currentPos.y -
        (screenY - this.viewport.offsetY) / this.viewport.scale,
    };
  }

  init() {
    this.hasCenteredInitially = false;
    this.resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries)
        this.resize(entry.contentRect.width, entry.contentRect.height);
    });
    this.resizeObserver.observe(this.canvas);
    this.canvas.addEventListener("wheel", (e) => this.handleScroll(e), {
      passive: false,
    });
    this.animate();
  }

  resize(
    newWidth = this.canvas.clientWidth,
    newHeight = this.canvas.clientHeight,
  ) {
    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.focusView(!this.hasCenteredInitially);
    this.hasCenteredInitially = true;
  }

  handleScroll(e) {
    e.preventDefault();
    this.viewport.targetY -= e.deltaY * 0.8;
  }

  focusView(forceCenterY = false) {
    const hudMargin = 320;
    const availableW = this.canvas.width - hudMargin * 2;
    const screenCenterX = hudMargin + availableW / 2;
    const screenCenterY = this.canvas.height / 2;

    if (this.loadedFabric && this.loadedFabric.edgeProfile) {
      let minX = Infinity,
        maxX = -Infinity;
      this.loadedFabric.edgeProfile.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      });

      const fabricW = maxX - minX;
      this.viewport.scale = availableW / (fabricW * 1.1);
      if (this.viewport.scale > 1.2) this.viewport.scale = 1.2;

      const worldCenterX = this.fabricOffset.x + minX + fabricW / 2;
      this.viewport.offsetX =
        screenCenterX - worldCenterX * this.viewport.scale;
    } else {
      this.viewport.scale = (availableW / this.bounds.width) * 0.6;
      if (this.viewport.scale > 0.8) this.viewport.scale = 0.8;
      const worldCenterX = this.bounds.width / 2;
      this.viewport.offsetX =
        screenCenterX - worldCenterX * this.viewport.scale;
    }
    if (forceCenterY) {
      this.viewport.targetY = screenCenterY;
      this.viewport.offsetY = this.viewport.targetY;
    }
  }

  animate() {
    const diff = this.viewport.targetY - this.viewport.offsetY;
    if (Math.abs(diff) > 0.1) this.viewport.offsetY += diff * 0.05;
    else this.viewport.offsetY = this.viewport.targetY;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawGrid();
    this.drawLoadedFabric();
    this.drawLiveTrace();

    this.drawNestingMask();
    this.drawActiveToolPath();

    if (this.isNestingLive) {
      this.drawPlacedInstances();
      this.drawGhostFrame();
    } else {
      this.drawPlacedInstances();
    }

    if (this.hoverPreviewData) {
      this.drawHoverPreview();
    }

    if (this.gcodeSolidData) {
      this.drawSimulator();
      if (this.highlightedJob) this.drawSubJobHighlight();
    } else {
      this.drawPlacedInstances();
      if (this.isNestingLive) this.drawGhostFrame();
      if (this.hoverPreviewData) this.drawHoverPreview();
    }

    if (this.selection.box) {
      this.ctx.save();
      const p1 = this.worldToPx(
        this.selection.box.startX,
        this.selection.box.startY,
      );
      const p2 = this.worldToPx(
        this.selection.box.endX,
        this.selection.box.endY,
      );
      this.ctx.fillStyle = "rgba(74, 144, 226, 0.2)";
      this.ctx.strokeStyle = "rgba(74, 144, 226, 0.8)";
      this.ctx.lineWidth = 1;
      this.ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      this.ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      this.ctx.restore();
    }

    this.drawHeading();
    this.drawTool();

    if (this.isCtrlHeld && this.ctrlTargetPos) {
      this.drawJogTargetLine();
    }

    requestAnimationFrame(() => this.animate());
  }
  // control jog line from machine to mouse target when Ctrl is held
  drawJogTargetLine() {
    const startPx = this.worldToPx(machine.currentPos.x, machine.currentPos.y);
    const endPx = this.worldToPx(this.ctrlTargetPos.x, this.ctrlTargetPos.y);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.moveTo(startPx.x, startPx.y);
    this.ctx.lineTo(endPx.x, endPx.y);

    this.ctx.strokeStyle = "rgba(255, 60, 60, 0.8)";
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 8]);
    this.ctx.stroke();

    // Draw a crosshair at the mouse target
    this.ctx.beginPath();
    this.ctx.arc(endPx.x, endPx.y, 8, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.moveTo(endPx.x - 15, endPx.y);
    this.ctx.lineTo(endPx.x + 15, endPx.y);
    this.ctx.moveTo(endPx.x, endPx.y - 15);
    this.ctx.lineTo(endPx.x, endPx.y + 15);
    this.ctx.stroke();

    this.ctx.restore();
  }

  // --- RENDERING ROUTINES ---
  drawNestingMask() {
    if (this.selection.nestingMaskBox) {
      this.ctx.save();
      const p1 = this.worldToPx(
        this.selection.nestingMaskBox.startX,
        this.selection.nestingMaskBox.startY,
      );
      const p2 = this.worldToPx(
        this.selection.nestingMaskBox.endX,
        this.selection.nestingMaskBox.endY,
      );
      this.ctx.fillStyle = "rgba(255, 170, 0, 0.1)";
      this.ctx.strokeStyle = "rgba(255, 170, 0, 0.8)";
      this.ctx.setLineDash([5, 5]);
      this.ctx.lineWidth = 1;
      this.ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      this.ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      this.ctx.restore();
    }

    if (this.selection.nestingMaskPoly) {
      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;
      this.ctx.save();
      this.ctx.beginPath();
      this.selection.nestingMaskPoly.forEach((v, i) => {
        const screenPos = this.worldToPx(v.x + ox, v.y + oy);
        if (i === 0) this.ctx.moveTo(screenPos.x, screenPos.y);
        else this.ctx.lineTo(screenPos.x, screenPos.y);
      });
      this.ctx.closePath();
      this.ctx.fillStyle = "rgba(255, 170, 0, 0.25)";
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  drawActiveToolPath() {
    if (this.activeDrawing.length === 0) return;
    const ox = this.loadedFabric ? this.fabricOffset.x : 0;
    const oy = this.loadedFabric ? this.fabricOffset.y : 0;
    this.ctx.strokeStyle = "#2BEA64";
    this.ctx.lineWidth = 2 / this.viewport.scale;
    this.ctx.beginPath();
    this.activeDrawing.forEach((v, i) => {
      const screenPos = this.worldToPx(v.x + ox, v.y + oy);
      if (i === 0) this.ctx.moveTo(screenPos.x, screenPos.y);
      else this.ctx.lineTo(screenPos.x, screenPos.y);
    });
    if (this.currentMousePos) {
      const screenPos = this.worldToPx(
        this.currentMousePos.x + ox,
        this.currentMousePos.y + oy,
      );
      this.ctx.lineTo(screenPos.x, screenPos.y);
    }
    this.ctx.stroke();
  }

  drawPlacedInstances() {
    this.dashOffset -= 0.5;
    const ox = this.loadedFabric ? this.fabricOffset.x : 0;
    const oy = this.loadedFabric ? this.fabricOffset.y : 0;

    this.placedInstances.forEach((inst) => {
      this.ctx.save();
      const screenPos = this.worldToPx(inst.x + ox, inst.y + oy);
      this.ctx.translate(screenPos.x, screenPos.y);
      this.ctx.scale(this.viewport.scale, this.viewport.scale);

      this.ctx.beginPath();
      inst.piece.vertices.forEach((v, i) => {
        if (i === 0) this.ctx.moveTo(v.x, -v.y);
        else this.ctx.lineTo(v.x, -v.y);
      });

      const isSelected = this.selection.isSelected(inst);

      if (inst.isDiy) {
        this.ctx.strokeStyle = isSelected ? "#4a90e2" : "#ffaa00";
        this.ctx.lineWidth = (isSelected ? 4 : 2) / this.viewport.scale;
        this.ctx.setLineDash(
          isSelected
            ? [8 / this.viewport.scale, 8 / this.viewport.scale]
            : [5 / this.viewport.scale, 5 / this.viewport.scale],
        );
        this.ctx.lineDashOffset = isSelected ? this.dashOffset : 0;
        this.ctx.stroke();
      } else {
        this.ctx.closePath();
        if (isSelected) {
          this.ctx.strokeStyle = "#4a90e2";
          this.ctx.lineWidth = 4 / this.viewport.scale;
          this.ctx.fillStyle = "rgba(74, 144, 226, 0.2)";
          this.ctx.fill();
        } else if (inst.nestingEnabled) {
          this.ctx.strokeStyle = "#888888";
          this.ctx.lineWidth = 2 / this.viewport.scale;
        } else {
          this.ctx.strokeStyle = "black";
          this.ctx.lineWidth = 2 / this.viewport.scale;
        }
        this.ctx.setLineDash([
          8 / this.viewport.scale,
          8 / this.viewport.scale,
        ]);
        this.ctx.lineDashOffset = isSelected ? this.dashOffset : 0;
        this.ctx.stroke();
      }

      const pointSize = 4 / this.viewport.scale;
      const offset = pointSize / 2;
      const squareColor = isSelected
        ? "#4a90e2"
        : inst.isDiy
          ? "#ffaa00"
          : "black";

      inst.piece.vertices.forEach((v) => {
        this.ctx.beginPath();
        if (v.isCurve) {
          this.ctx.fillStyle = "#ff0000";
          this.ctx.arc(v.x, -v.y, offset, 0, Math.PI * 2);
          this.ctx.fill();
        } else {
          this.ctx.fillStyle = squareColor;
          this.ctx.rect(v.x - offset, -v.y - offset, pointSize, pointSize);
          this.ctx.fill();
        }
      });
      this.ctx.restore();
    });
  }

  drawGhostFrame() {
    if (!this.isNestingLive) return;
    const ox = this.loadedFabric ? this.fabricOffset.x : 0;
    const oy = this.loadedFabric ? this.fabricOffset.y : 0;

    this.ghostLayout.forEach((inst) => {
      this.ctx.save();
      const screenPos = this.worldToPx(inst.x + ox, inst.y + oy);
      this.ctx.translate(screenPos.x, screenPos.y);
      this.ctx.scale(this.viewport.scale, this.viewport.scale);

      this.ctx.beginPath();
      inst.piece.vertices.forEach((v, i) => {
        if (i === 0) this.ctx.moveTo(v.x, -v.y);
        else this.ctx.lineTo(v.x, -v.y);
      });
      this.ctx.closePath();

      this.ctx.strokeStyle = "rgba(74, 144, 226, 0.5)";
      this.ctx.lineWidth = 1 / this.viewport.scale;
      this.ctx.stroke();
      this.ctx.fillStyle = "rgba(74, 144, 226, 0.05)";
      this.ctx.fill();
      this.ctx.restore();
    });

    if (this.ghostTestingPoly) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ghostTestingPoly.forEach((v, i) => {
        const screenPos = this.worldToPx(v.x + ox, v.y + oy);
        if (i === 0) this.ctx.moveTo(screenPos.x, screenPos.y);
        else this.ctx.lineTo(screenPos.x, screenPos.y);
      });
      this.ctx.closePath();

      this.ctx.strokeStyle = "#ff00ff";
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      this.ctx.fillStyle = "rgba(255, 0, 255, 0.2)";
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  drawHoverPreview() {
    if (!this.hoverPreviewData || !this.hoverPreviewData.layout) return;

    const layout = this.hoverPreviewData.layout;
    const cutLine = this.hoverPreviewData.cutLine;

    const ox = this.loadedFabric ? this.fabricOffset.x : 0;
    const oy = this.loadedFabric ? this.fabricOffset.y : 0;

    layout.forEach((inst) => {
      this.ctx.save();
      const screenPos = this.worldToPx(inst.x + ox, inst.y + oy);
      this.ctx.translate(screenPos.x, screenPos.y);
      this.ctx.scale(this.viewport.scale, this.viewport.scale);

      this.ctx.beginPath();
      inst.piece.vertices.forEach((v, i) => {
        if (i === 0) this.ctx.moveTo(v.x, -v.y);
        else this.ctx.lineTo(v.x, -v.y);
      });
      this.ctx.closePath();

      this.ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
      this.ctx.lineWidth = 1 / this.viewport.scale;
      this.ctx.stroke();
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      this.ctx.fill();
      this.ctx.restore();
    });

    if (cutLine && this.loadedFabric && this.loadedFabric.edgeProfile) {
      this.ctx.save();
      this.ctx.beginPath();
      this.loadedFabric.edgeProfile.forEach((p, i) => {
        const screenPos = this.worldToPx(p.x + ox, p.y + oy);
        if (i === 0) this.ctx.moveTo(screenPos.x, screenPos.y);
        else this.ctx.lineTo(screenPos.x, screenPos.y);
      });
      this.ctx.clip();

      this.ctx.beginPath();
      this.ctx.moveTo(-10000, -10000);
      this.ctx.lineTo(this.canvas.width + 10000, -10000);
      for (let i = cutLine.length - 1; i >= 0; i--) {
        const pt = this.worldToPx(cutLine[i].x + ox, cutLine[i].y + oy);
        this.ctx.lineTo(pt.x, pt.y);
      }
      this.ctx.closePath();

      this.ctx.fillStyle = "rgba(74, 144, 226, 0.08)";
      this.ctx.fill();

      this.ctx.beginPath();
      cutLine.forEach((p, i) => {
        const pt = this.worldToPx(p.x + ox, p.y + oy);
        if (i === 0) this.ctx.moveTo(pt.x, pt.y);
        else this.ctx.lineTo(pt.x, pt.y);
      });

      this.ctx.strokeStyle = "rgba(255, 60, 60, 0.8)";
      this.ctx.setLineDash([10, 6]);
      this.ctx.lineWidth = 2 / this.viewport.scale;
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  drawLiveTrace() {
    if (this.activeTracePoints.length === 0) return;
    this.ctx.beginPath();
    this.ctx.strokeStyle = "#2BEA64";
    this.ctx.setLineDash([5, 5]);
    this.ctx.lineWidth = 2;

    this.activeTracePoints.forEach((p, index) => {
      const screenPos = this.worldToPx(p.x, p.y);
      if (index === 0) this.ctx.moveTo(screenPos.x, screenPos.y);
      else this.ctx.lineTo(screenPos.x, screenPos.y);
    });
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.fillStyle = "#2BEA64";
    this.activeTracePoints.forEach((p) => {
      const screenPos = this.worldToPx(p.x, p.y);
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x, screenPos.y, 4, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  drawLoadedFabric() {
    if (
      !this.loadedFabric ||
      !this.loadedFabric.edgeProfile ||
      this.loadedFabric.edgeProfile.length === 0
    )
      return;
    this.ctx.save();
    const hexColor = this.loadedFabric.color || "#cccccc";
    this.ctx.fillStyle = hexColor + "33";
    this.ctx.strokeStyle = hexColor;
    this.ctx.lineWidth = 2;
    if (this.currentTool instanceof FabricDragTool) {
      this.ctx.setLineDash([5, 5]);
      this.ctx.fillStyle = hexColor + "66";
    }
    const profile = this.loadedFabric.edgeProfile;
    const ox = this.fabricOffset.x;
    const oy = this.fabricOffset.y;
    this.ctx.beginPath();
    profile.forEach((p, i) => {
      const screenPos = this.worldToPx(p.x + ox, p.y + oy);
      if (i === 0) this.ctx.moveTo(screenPos.x, screenPos.y);
      else this.ctx.lineTo(screenPos.x, screenPos.y);
    });
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawGrid() {
    const { ctx, viewport, bounds, canvas } = this;
    const machineY = machine.currentPos.y;
    const leftEdge = this.viewport.offsetX;
    const rightEdge = this.viewport.offsetX + bounds.width * viewport.scale;

    ctx.strokeStyle = "#d0d0d0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftEdge, 0);
    ctx.lineTo(leftEdge, canvas.height);
    ctx.moveTo(rightEdge, 0);
    ctx.lineTo(rightEdge, canvas.height);
    ctx.stroke();

    const dotSpacing = 10;
    ctx.fillStyle = "#bbb";
    const startY =
      Math.floor((machineY - viewport.offsetY / viewport.scale) / dotSpacing) *
      dotSpacing;
    const endY =
      startY + Math.floor(canvas.height / viewport.scale) + dotSpacing * 2;

    for (let x = 0; x <= bounds.width; x += dotSpacing) {
      for (let y = startY; y <= endY; y += dotSpacing) {
        const screenPos = this.worldToPx(x, y);
        ctx.fillRect(screenPos.x - 0.5, screenPos.y - 0.5, 1, 1);
      }
    }

    ctx.strokeStyle = "rgba(153, 0, 0, 0.4)";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(leftEdge, viewport.offsetY);
    ctx.lineTo(rightEdge, viewport.offsetY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawHeading() {
    const { ctx, controller } = this;
    if (!controller || controller.activeAngle === null) return;
    const pos = machine.currentPos;
    const screenPos = this.gantryToPx(pos.x);
    const gp = navigator.getGamepads()[0];
    const lt = gp ? gp.buttons[6].value : 0;
    const vectorLen = 20 + lt * 100;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y);
    ctx.lineTo(
      screenPos.x + Math.cos(controller.activeAngle) * vectorLen,
      screenPos.y - Math.sin(controller.activeAngle) * vectorLen,
    );
    ctx.strokeStyle = `rgba(153, 0, 0, ${0.3 + lt * 0.7})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.stroke();

    ctx.fillStyle = `rgba(153, 0, 0, ${0.3 + lt * 0.7})`;
    ctx.beginPath();
    ctx.arc(
      screenPos.x + Math.cos(controller.activeAngle) * vectorLen,
      screenPos.y - Math.sin(controller.activeAngle) * vectorLen,
      3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  drawTool() {
    const { ctx, viewport } = this;
    const pos = machine.currentPos;
    const screenPos = this.gantryToPx(pos.x);

    const zLimit = -13;
    const zCurrent = Math.max(zLimit, Math.min(0, pos.z));
    const zProgress = zCurrent / zLimit;
    const currentDia = 20 - zProgress * 19;
    const currentAlpha = 0.1 + zProgress * 0.9;

    ctx.save();
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, currentDia / 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(153, 0, 0, ${currentAlpha})`;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(
      screenPos.x,
      screenPos.y,
      this.toolRadius * viewport.scale,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 1;
    ctx.stroke();

    const adjustedAngle = Math.PI - pos.a;
    const lineLen = this.toolRadius * viewport.scale;

    ctx.fillStyle = "#900";
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y);
    ctx.lineTo(
      screenPos.x + Math.cos(adjustedAngle) * lineLen,
      screenPos.y + Math.sin(adjustedAngle) * lineLen,
    );
    ctx.strokeStyle = "#900";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawSimulator() {
    const ox = this.loadedFabric ? this.fabricOffset.x : 0;
    const oy = this.loadedFabric ? this.fabricOffset.y : 0;

    this.ctx.save();
    const allJobs = [...this.simulatorJobs];
    if (this.simulatorCutJob) allJobs.push(this.simulatorCutJob);

    allJobs.forEach((job) => {
      job.simPaths.forEach((path) => {
        if (path.type === "G0" || path.type === "G1") {
          const isFloat = path.type === "G0";
          // THE FIX: Removed applyParallax, plotting absolute flat coordinates
          const p1 = this.worldToPx(path.p1.x + ox, path.p1.y + oy);
          const p2 = this.worldToPx(path.p2.x + ox, path.p2.y + oy);

          this.ctx.beginPath();
          this.ctx.moveTo(p1.x, p1.y);
          this.ctx.lineTo(p2.x, p2.y);

          // THE FIX: Ultra-fine line weights
          if (isFloat) {
            this.ctx.strokeStyle = "rgba(255, 60, 60, 0.4)";
            this.ctx.setLineDash([2, 3]);
            this.ctx.lineWidth = 0.5;
          } else {
            this.ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
            this.ctx.setLineDash([]);
            this.ctx.lineWidth = 0.5 / this.viewport.scale;
          }
          this.ctx.stroke();
        }
      });
    });
    this.ctx.restore();
  }

  drawSubJobHighlight() {
    const ox = this.loadedFabric ? this.fabricOffset.x : 0;
    const oy = this.loadedFabric ? this.fabricOffset.y : 0;
    const job = this.highlightedJob;

    const drawWedge = (px, a1, a2, isFloating) => {
      let delta = a2 - a1;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;

      const slices = 15;
      const radius = isFloating ? 18 : 12;
      const baseRgb = isFloating ? "255, 60, 60" : "43, 234, 100";

      for (let i = 1; i <= slices; i++) {
        const f0 = (i - 1) / slices;
        const f1 = i / slices;
        const cA1 = -(a1 + delta * f0);
        const cA2 = -(a1 + delta * f1);

        this.ctx.beginPath();
        this.ctx.moveTo(px.x, px.y);
        this.ctx.arc(px.x, px.y, radius, cA1, cA2, delta > 0);
        this.ctx.closePath();
        this.ctx.fillStyle = `rgba(${baseRgb}, ${f1 * 0.7})`;
        this.ctx.fill();
      }

      this.ctx.beginPath();
      this.ctx.moveTo(px.x, px.y);
      this.ctx.lineTo(
        px.x + Math.cos(-(a1 + delta)) * radius * 1.2,
        px.y + Math.sin(-(a1 + delta)) * radius * 1.2,
      );
      this.ctx.strokeStyle = `rgba(${baseRgb}, 1)`;
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    };

    this.ctx.save();

    const screenTopY = this.worldToPx(0, job.topY + oy).y;
    const screenBottomY = this.worldToPx(0, job.bottomY + oy).y;
    this.ctx.fillStyle = "rgba(43, 234, 100, 0.08)";
    this.ctx.fillRect(
      0,
      screenTopY,
      this.canvas.width,
      screenBottomY - screenTopY,
    );

    job.simPaths.forEach((path) => {
      if (path.type === "G1") {
        const p1 = this.worldToPx(path.p1.x + ox, path.p1.y + oy);
        const p2 = this.worldToPx(path.p2.x + ox, path.p2.y + oy);
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.strokeStyle = job.isCutLine ? "#eac72b" : "#ff3c3c";
        this.ctx.setLineDash([]);
        this.ctx.lineWidth = 1.2 / this.viewport.scale; // Slightly thicker than the 0.5 background so it highlights
        this.ctx.stroke();
      } else if (path.type === "PIVOT_MAT") {
        const px = this.worldToPx(path.p.x + ox, path.p.y + oy);
        drawWedge(px, path.a1, path.a2, false);
      }
    });

    job.simPaths.forEach((path) => {
      if (path.type === "G0") {
        const p1 = this.worldToPx(path.p1.x + ox, path.p1.y + oy);
        const p2 = this.worldToPx(path.p2.x + ox, path.p2.y + oy);

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.strokeStyle = "rgba(255, 60, 60, 0.9)";
        this.ctx.setLineDash([4, 4]);
        this.ctx.lineWidth = 1; // Fine highlight
        this.ctx.stroke();
      } else if (path.type === "PIVOT_AIR") {
        const px = this.worldToPx(path.p.x + ox, path.p.y + oy);
        drawWedge(px, path.a1, path.a2, true);
      }
    });

    this.ctx.restore();
  }
}
