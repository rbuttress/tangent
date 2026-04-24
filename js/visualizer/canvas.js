// js/visualizer/canvas.js
//version no. 2.8

import { machine } from "../core/machine.js";
import { Nester } from "../core/nester.js";

export class Visualizer {
  constructor(canvasId, controller) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.controller = controller;

    this.viewport = { offsetX: 0, offsetY: 0, targetY: 0, scale: 1.0 };
    this.bounds = { width: 1600 };
    this.toolRadius = 10;

    // --- Fabric & Queue State ---
    this.activeTracePoints = [];
    this.loadedFabric = JSON.parse(localStorage.getItem("savedFabric")) || null;
    this.fabricOffset = JSON.parse(
      localStorage.getItem("savedFabricOffset"),
    ) || { x: 0, y: 0 };
    this.isDraggingFabric = false;
    this.dragStart = { x: 0, y: 0 };

    this.placedInstances =
      JSON.parse(localStorage.getItem("savedInstances")) || [];
    this.dashOffset = 0;
    this.draggedInstance = null;
    this.dragMouseStart = { x: 0, y: 0 };
    this.hoveredInstance = null;

    this.isNestingLive = false;
    this.ghostLayout = [];
    this.ghostTestingPoly = null;

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
        if (this.placedInstances[i].piece.name === e.detail.piece.name) {
          this.placedInstances.splice(i, 1);
          this.saveState();
          break;
        }
      }
    });

    document.addEventListener("TRACE_UPDATED", (e) => {
      this.activeTracePoints = e.detail;
    });

    document.addEventListener("FABRIC_LOADED", (e) => {
      const { fabric, isFreshTrace } = e.detail;
      this.loadedFabric = fabric;
      this.activeTracePoints = [];

      if (isFreshTrace) {
        this.fabricOffset = { x: 0, y: 0 };
      } else {
        let minX = Infinity;
        fabric.edgeProfile.forEach((p) => {
          if (p.x < minX) minX = p.x;
        });

        let maxYAtLeftEdge = -Infinity;
        fabric.edgeProfile.forEach((p) => {
          if (Math.abs(p.x - minX) < 0.001) {
            if (p.y > maxYAtLeftEdge) maxYAtLeftEdge = p.y;
          }
        });

        this.fabricOffset = {
          x: machine.currentPos.x - minX,
          y: machine.currentPos.y - maxYAtLeftEdge,
        };
      }
      this.saveState();
      this.focusView(true);
    });

    // --- Interactive Direct Manipulation ---
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const mouseWorld = this.screenToWorld(e.offsetX, e.offsetY);
      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;

      if (e.shiftKey && this.loadedFabric) {
        this.isDraggingFabric = true;
        this.dragStart = { x: mouseWorld.x - ox, y: mouseWorld.y - oy };
        return;
      }

      const localX = mouseWorld.x - ox;
      const localY = mouseWorld.y - oy;

      for (let i = this.placedInstances.length - 1; i >= 0; i--) {
        const inst = this.placedInstances[i];
        const worldPoly = inst.piece.vertices.map((v) => ({
          x: inst.x + v.x,
          y: inst.y + v.y,
        }));

        if (Nester.isPointInPolygon({ x: localX, y: localY }, worldPoly)) {
          this.draggedInstance = inst;
          this.dragMouseStart = { x: localX - inst.x, y: localY - inst.y };
          if (inst.nestingEnabled) {
            inst.nestingEnabled = false;
            this.saveState();
          }
          document.body.style.cursor = "grabbing";
          break;
        }
      }
    });

    this.canvas.addEventListener("mousemove", (e) => {
      const mouseWorld = this.screenToWorld(e.offsetX, e.offsetY);
      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;
      const localX = mouseWorld.x - ox;
      const localY = mouseWorld.y - oy;

      if (this.isDraggingFabric) {
        this.fabricOffset.x = mouseWorld.x - this.dragStart.x;
        this.fabricOffset.y = mouseWorld.y - this.dragStart.y;
      } else if (this.draggedInstance) {
        this.draggedInstance.x = localX - this.dragMouseStart.x;
        this.draggedInstance.y = localY - this.dragMouseStart.y;
      } else {
        this.hoveredInstance = null;
        for (let i = this.placedInstances.length - 1; i >= 0; i--) {
          const inst = this.placedInstances[i];
          const worldPoly = inst.piece.vertices.map((v) => ({
            x: inst.x + v.x,
            y: inst.y + v.y,
          }));

          if (Nester.isPointInPolygon({ x: localX, y: localY }, worldPoly)) {
            this.hoveredInstance = inst;
            document.body.style.cursor = "grab";
            break;
          }
        }
        if (!this.hoveredInstance && !this.isDraggingFabric) {
          document.body.style.cursor = "default";
        }
      }
    });

    this.canvas.addEventListener("mouseup", () => {
      this.isDraggingFabric = false;
      this.draggedInstance = null;
      this.saveState();
    });

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const mouseWorld = this.screenToWorld(e.offsetX, e.offsetY);
      const ox = this.loadedFabric ? this.fabricOffset.x : 0;
      const oy = this.loadedFabric ? this.fabricOffset.y : 0;
      const localX = mouseWorld.x - ox;
      const localY = mouseWorld.y - oy;

      for (let i = this.placedInstances.length - 1; i >= 0; i--) {
        const inst = this.placedInstances[i];
        const worldPoly = inst.piece.vertices.map((v) => ({
          x: inst.x + v.x,
          y: inst.y + v.y,
        }));

        if (Nester.isPointInPolygon({ x: localX, y: localY }, worldPoly)) {
          if (!inst.nestingEnabled) {
            inst.nestingEnabled = true;
            this.saveState();
          }
          break;
        }
      }
    });

    document.addEventListener("NESTING_GHOST_FRAME", (e) => {
      this.isNestingLive = true;
      this.ghostLayout = e.detail.layout;
      this.ghostTestingPoly = e.detail.testingPoly;
    });

    document.addEventListener("PREVIEW_ITERATION", (e) => {
      this.isNestingLive = false;
      this.placedInstances = e.detail;
      this.saveState();
    });

    document.addEventListener("STOP_NESTING", () => {
      this.isNestingLive = false;
      this.ghostLayout = [];
      this.ghostTestingPoly = null;
    });

    // THE FIX: Listen for the leaderboard hover state
    this.hoverPreviewLayout = null;

    document.addEventListener("HOVER_PREVIEW_START", (e) => {
      this.hoverPreviewLayout = e.detail;
    });

    document.addEventListener("HOVER_PREVIEW_END", () => {
      this.hoverPreviewLayout = null;
    });

    this.init();
  }

  saveState() {
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
      for (let entry of entries) {
        this.resize(entry.contentRect.width, entry.contentRect.height);
      }
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

  //version no. 2.9

  focusView(forceCenterY = false) {
    const hudMargin = 320;
    const availableW = this.canvas.width - hudMargin * 2;
    const screenCenterX = hudMargin + availableW / 2;
    const screenCenterY = this.canvas.height / 2;

    if (this.loadedFabric && this.loadedFabric.edgeProfile) {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      this.loadedFabric.edgeProfile.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });

      const fabricW = maxX - minX;

      this.viewport.scale = availableW / (fabricW * 1.1);
      if (this.viewport.scale > 1.2) this.viewport.scale = 1.2;

      const worldCenterX = this.fabricOffset.x + minX + fabricW / 2;

      this.viewport.offsetX =
        screenCenterX - worldCenterX * this.viewport.scale;

      if (forceCenterY) {
        // THE FIX: Lock the camera directly to the tool's Y-axis center
        this.viewport.targetY = screenCenterY;
        this.viewport.offsetY = this.viewport.targetY;
      }
    } else {
      this.viewport.scale = (availableW / this.bounds.width) * 0.6;
      if (this.viewport.scale > 0.8) this.viewport.scale = 0.8;

      const worldCenterX = this.bounds.width / 2;
      this.viewport.offsetX =
        screenCenterX - worldCenterX * this.viewport.scale;

      if (forceCenterY) {
        this.viewport.targetY = screenCenterY;
        this.viewport.offsetY = this.viewport.targetY;
      }
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
    this.drawHeading();
    this.drawTool();

    if (this.isNestingLive) {
      this.drawPlacedInstances();
      this.drawGhostFrame();
    } else {
      this.drawPlacedInstances();
    }

    if (this.hoverPreviewLayout) {
      this.drawHoverPreview();
    }

    requestAnimationFrame(() => this.animate());
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
      this.ctx.closePath();

      if (inst.nestingEnabled) {
        this.ctx.strokeStyle = "#4a90e2";
        this.ctx.lineWidth = 2 / this.viewport.scale;
      } else {
        this.ctx.strokeStyle = "black";
        this.ctx.lineWidth =
          (this.hoveredInstance === inst ? 3 : 2) / this.viewport.scale;
      }

      this.ctx.setLineDash([8 / this.viewport.scale, 8 / this.viewport.scale]);
      this.ctx.lineDashOffset =
        this.hoveredInstance === inst ? this.dashOffset : 0;
      this.ctx.stroke();

      const pointSize = 4 / this.viewport.scale;
      const offset = pointSize / 2;
      const squareColor = inst.nestingEnabled ? "#4a90e2" : "black";

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
    if (this.isDraggingFabric) this.ctx.setLineDash([5, 5]);

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

  drawHoverPreview() {
    if (!this.hoverPreviewLayout || this.hoverPreviewLayout.length === 0)
      return;

    const ox = this.loadedFabric ? this.fabricOffset.x : 0;
    const oy = this.loadedFabric ? this.fabricOffset.y : 0;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    // 1. Draw the light grey ghost pieces and calculate bounds simultaneously
    this.hoverPreviewLayout.forEach((inst) => {
      this.ctx.save();
      const screenPos = this.worldToPx(inst.x + ox, inst.y + oy);
      this.ctx.translate(screenPos.x, screenPos.y);
      this.ctx.scale(this.viewport.scale, this.viewport.scale);

      this.ctx.beginPath();
      inst.piece.vertices.forEach((v, i) => {
        // Track absolute world bounds for the bounding box
        const worldX = inst.x + v.x;
        const worldY = inst.y + v.y;
        if (worldX < minX) minX = worldX;
        if (worldX > maxX) maxX = worldX;
        if (worldY < minY) minY = worldY;
        if (worldY > maxY) maxY = worldY;

        // Draw the polygon
        if (i === 0) this.ctx.moveTo(v.x, -v.y);
        else this.ctx.lineTo(v.x, -v.y);
      });
      this.ctx.closePath();

      // Style: Very Light Grey
      this.ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
      this.ctx.lineWidth = 1 / this.viewport.scale;
      this.ctx.stroke();
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      this.ctx.fill();
      this.ctx.restore();
    });

    // 2. Draw the incredibly faint bounding box around the entire layout
    if (minX !== Infinity) {
      // Map the top-left and bottom-right world limits to screen pixels
      const topLeft = this.worldToPx(minX + ox, maxY + oy);
      const bottomRight = this.worldToPx(maxX + ox, minY + oy);

      const width = bottomRight.x - topLeft.x;
      const height = bottomRight.y - topLeft.y;

      this.ctx.save();
      this.ctx.strokeStyle = "rgba(74, 144, 226, 0.3)"; // Faint blue stroke
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([6, 6]);

      this.ctx.strokeRect(topLeft.x, topLeft.y, width, height);

      // Almost imperceptible blue wash inside the bounds
      this.ctx.fillStyle = "rgba(74, 144, 226, 0.03)";
      this.ctx.fillRect(topLeft.x, topLeft.y, width, height);
      this.ctx.restore();
    }
  }
}
