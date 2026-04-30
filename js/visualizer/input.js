// js/visualizer/input.js
//version no. 1.1

import { machine } from "../core/machine.js";
import { Nester } from "../core/nester.js";

export class InputManager {
  constructor(visualizer) {
    this.viz = visualizer;
    this.hasCenteredInitially = false;
    this.resizeObserver = null;
    this.lastJogAimTime = 0;
    this.JOG_AIM_THROTTLE_MS = 300;
  }

  init() {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        this.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    this.resizeObserver.observe(this.viz.canvas);

    this.viz.canvas.addEventListener("wheel", (e) => this.handleScroll(e), {
      passive: false,
    });

    this.initEventListeners();
  }

  resize(
    newWidth = this.viz.canvas.clientWidth,
    newHeight = this.viz.canvas.clientHeight,
  ) {
    this.viz.canvas.width = newWidth;
    this.viz.canvas.height = newHeight;
    this.focusView(!this.hasCenteredInitially);
    this.hasCenteredInitially = true;
  }

  handleScroll(e) {
    e.preventDefault();
    this.viz.viewport.targetY -= e.deltaY * 0.8;
  }

  focusView(forceCenterY = false) {
    const hudMargin = 320;
    const availableW = this.viz.canvas.width - hudMargin * 2;
    const screenCenterX = hudMargin + availableW / 2;
    const screenCenterY = this.viz.canvas.height / 2;

    if (this.viz.loadedFabric && this.viz.loadedFabric.edgeProfile) {
      let minX = Infinity,
        maxX = -Infinity;
      this.viz.loadedFabric.edgeProfile.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      });

      const fabricW = maxX - minX;
      this.viz.viewport.scale = availableW / (fabricW * 1.1);
      if (this.viz.viewport.scale > 1.2) this.viz.viewport.scale = 1.2;

      const worldCenterX = this.viz.fabricOffset.x + minX + fabricW / 2;
      this.viz.viewport.offsetX =
        screenCenterX - worldCenterX * this.viz.viewport.scale;
    } else {
      this.viz.viewport.scale = (availableW / this.viz.bounds.width) * 0.6;
      if (this.viz.viewport.scale > 0.8) this.viz.viewport.scale = 0.8;
      const worldCenterX = this.viz.bounds.width / 2;
      this.viz.viewport.offsetX =
        screenCenterX - worldCenterX * this.viz.viewport.scale;
    }
    if (forceCenterY) {
      this.viz.viewport.targetY = screenCenterY;
      this.viz.viewport.offsetY = this.viz.viewport.targetY;
    }
  }

  gantryToPx(x) {
    return {
      x: this.viz.viewport.offsetX + x * this.viz.viewport.scale,
      y: this.viz.viewport.offsetY,
    };
  }

  worldToPx(x, y) {
    return {
      x: this.viz.viewport.offsetX + x * this.viz.viewport.scale,
      y:
        this.viz.viewport.offsetY -
        (y - machine.currentPos.y) * this.viz.viewport.scale,
    };
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.viz.viewport.offsetX) / this.viz.viewport.scale,
      y:
        machine.currentPos.y -
        (screenY - this.viz.viewport.offsetY) / this.viz.viewport.scale,
    };
  }

  initEventListeners() {
    // --- Keyboard Events ---
    document.addEventListener("keydown", (e) => {
      // Changed from "Control" to "Alt"
      if (e.key === "Alt" && !this.viz.isAltHeld) {
        e.preventDefault(); // Prevents browser menu bar from activating
        this.viz.isAltHeld = true;
        document.body.style.cursor = "crosshair";
      }
    });

    document.addEventListener("keyup", (e) => {
      if (e.key === "Alt") {
        e.preventDefault();
        this.viz.isAltHeld = false;
        this.viz.altTargetPos = null;
        document.body.style.cursor = "default";

        // Revert the A-axis to its original position if we didn't click
        const port = localStorage.getItem("last-port");
        if (port && !this.viz.controller.isStreaming) {
          this.viz.controller.spjs.send(`send ${port} G90 G0 A0\n`);
        }
      }
    });

    // --- Custom App Events ---
    document.addEventListener("SPAWN_INSTANCE", (e) => {
      const piece = e.detail.piece;
      let pos = { x: 50, y: -50 };

      if (this.viz.loadedFabric) {
        const autoPos = Nester.placePiece(
          piece,
          this.viz.loadedFabric,
          this.viz.placedInstances,
        );
        if (autoPos) pos = autoPos;
      } else {
        const cascade = (this.viz.placedInstances.length * 15) % 150;
        pos = { x: 50 + cascade, y: -50 - cascade };
      }

      this.viz.placedInstances.push({
        id: piece.name + "_" + Date.now() + Math.random(),
        piece: piece,
        x: pos.x,
        y: pos.y,
        rotation: 0,
        nestingEnabled: true,
      });
      this.viz.saveState();
    });

    document.addEventListener("REMOVE_INSTANCE", (e) => {
      for (let i = this.viz.placedInstances.length - 1; i >= 0; i--) {
        const inst = this.viz.placedInstances[i];
        if (
          (e.detail.id && inst.id === e.detail.id) ||
          (!e.detail.id && inst.piece.name === e.detail.piece.name)
        ) {
          this.viz.selection.remove(inst);
          this.viz.placedInstances.splice(i, 1);
          this.viz.saveState();
          break;
        }
      }
    });

    document.addEventListener("PREVIEW_ITERATION", (e) => {
      this.viz.isNestingLive = false;
      const diyLines = this.viz.placedInstances.filter((p) => p.isDiy);
      const newLayout = Array.isArray(e.detail)
        ? e.detail
        : e.detail.layout || [];
      this.viz.placedInstances = [...newLayout, ...diyLines];
      this.viz.selection.clear();
      this.viz.saveState();
    });

    document.addEventListener("NESTING_GHOST_FRAME", (e) => {
      this.viz.isNestingLive = true;
      this.viz.ghostLayout = e.detail.layout;
      this.viz.ghostTestingPoly = e.detail.testingPoly;
    });

    document.addEventListener("STOP_NESTING", () => {
      this.viz.isNestingLive = false;
      this.viz.ghostLayout = [];
      this.viz.ghostTestingPoly = null;
    });

    document.addEventListener("HOVER_PREVIEW_START", (e) => {
      this.viz.hoverPreviewData = e.detail;
    });

    document.addEventListener("HOVER_PREVIEW_END", () => {
      this.viz.hoverPreviewData = null;
    });

    document.addEventListener("TRACE_UPDATED", (e) => {
      this.viz.activeTracePoints = e.detail;
    });

    document.addEventListener("RENDER_GCODE_SOLID", (e) => {
      this.viz.isNestingLive = false;
      this.viz.gcodeSolidData = e.detail;
    });

    document.addEventListener("SIMULATOR_UPDATE", (e) => {
      this.viz.simulatorJobs = e.detail.jobs;
      this.viz.simulatorCutJob = e.detail.cutJob;
    });

    document.addEventListener("HIGHLIGHT_SUBJOB", (e) => {
      this.viz.highlightedJob = e.detail;
    });

    document.addEventListener("FABRIC_LOADED", (e) => {
      this.viz.loadedFabric = e.detail ? e.detail.fabric : null;
      if (!this.viz.loadedFabric) {
        this.viz.fabricOffset = { x: 0, y: 0 };
        this.viz.saveState();
        this.focusView(true);
        return;
      }
      this.viz.saveState();
      this.focusView(true);
    });

    // --- Mouse Events ---
    this.viz.canvas.addEventListener("mousedown", (e) => {
      const worldPos = this.screenToWorld(e.offsetX, e.offsetY);

      // Changed from ctrlKey to altKey
      if (e.altKey) {
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
      const ox = this.viz.loadedFabric ? this.viz.fabricOffset.x : 0;
      const oy = this.viz.loadedFabric ? this.viz.fabricOffset.y : 0;
      const localPos = { x: worldPos.x - ox, y: worldPos.y - oy };
      this.viz.currentTool.onMouseDown(e, worldPos, localPos);
    });

    this.viz.canvas.addEventListener("mousemove", (e) => {
      const worldPos = this.screenToWorld(e.offsetX, e.offsetY);

      // Changed to isAltHeld
      if (this.viz.isAltHeld) {
        this.viz.altTargetPos = worldPos;

        const port = localStorage.getItem("last-port");
        const now = Date.now();

        if (
          port &&
          !this.viz.controller.isStreaming &&
          now - this.lastJogAimTime > this.JOG_AIM_THROTTLE_MS
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
            this.viz.controller.spjs.send(
              `send ${port} G90 G0 A${targetAngle.toFixed(3)}\n`,
            );
            this.lastJogAimTime = now;
          }
        }
      } else {
        this.viz.altTargetPos = null;
      }

      const ox = this.viz.loadedFabric ? this.viz.fabricOffset.x : 0;
      const oy = this.viz.loadedFabric ? this.viz.fabricOffset.y : 0;
      const localPos = { x: worldPos.x - ox, y: worldPos.y - oy };
      this.viz.currentTool.onMouseMove(e, worldPos, localPos);
      document.dispatchEvent(
        new CustomEvent("CANVAS_COORDS", { detail: worldPos }),
      );
    });

    this.viz.canvas.addEventListener("mouseup", (e) => {
      const worldPos = this.screenToWorld(e.offsetX, e.offsetY);
      const ox = this.viz.loadedFabric ? this.viz.fabricOffset.x : 0;
      const oy = this.viz.loadedFabric ? this.viz.fabricOffset.y : 0;
      const localPos = { x: worldPos.x - ox, y: worldPos.y - oy };
      this.viz.currentTool.onMouseUp(e, worldPos, localPos);
    });

    this.viz.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const worldPos = this.screenToWorld(e.offsetX, e.offsetY);
      const ox = this.viz.loadedFabric ? this.viz.fabricOffset.x : 0;
      const oy = this.viz.loadedFabric ? this.viz.fabricOffset.y : 0;
      const localPos = { x: worldPos.x - ox, y: worldPos.y - oy };
      this.viz.currentTool.onContextMenu(e, worldPos, localPos);
    });
  }
}
