// js/visualizer/tools.js
//version no. 2.0

import { Nester } from "../core/nester.js";

// --- Math & Utility Functions ---
function pointToSegmentDistance(p, v, w) {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(
    p.x - (v.x + t * (w.x - v.x)),
    p.y - (v.y + t * (w.y - v.y)),
  );
}

// Iterative smoothing algorithm for freehand drawing
function smoothPolyline(points, amount) {
  if (points.length < 3 || amount === 0) return points;
  let smoothed = [...points];
  for (let iter = 0; iter < amount; iter++) {
    let next = [smoothed[0]];
    for (let i = 1; i < smoothed.length - 1; i++) {
      next.push({
        x: (smoothed[i - 1].x + smoothed[i].x + smoothed[i + 1].x) / 3,
        y: (smoothed[i - 1].y + smoothed[i].y + smoothed[i + 1].y) / 3,
      });
    }
    next.push(smoothed[smoothed.length - 1]);
    smoothed = next;
  }
  return smoothed;
}

export class Tool {
  constructor(canvasManager) {
    this.canvas = canvasManager;
  }
  onMouseDown(e, worldPos, localPos) {}
  onMouseMove(e, worldPos, localPos) {}
  onMouseUp(e, worldPos, localPos) {}
  onContextMenu(e, worldPos, localPos) {}
  onKeyDown(e) {}
}

export class SelectTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
    this.isDraggingPieces = false;
    this.isBoxSelecting = false;
    this.dragStartOffsets = new Map();
  }

  getHoveredInstance(localPos) {
    for (let i = this.canvas.placedInstances.length - 1; i >= 0; i--) {
      const inst = this.canvas.placedInstances[i];
      const worldPoly = inst.piece.vertices.map((v) => ({
        x: inst.x + v.x,
        y: inst.y + v.y,
      }));
      if (Nester.isPointInPolygon(localPos, worldPoly)) return inst;
    }
    return null;
  }

  onMouseDown(e, worldPos, localPos) {
    const hovered = this.getHoveredInstance(localPos);

    if (e.button === 0) {
      if (hovered) {
        if (!this.canvas.selection.isSelected(hovered) && !e.shiftKey) {
          this.canvas.selection.clear();
          this.canvas.selection.add(hovered);
        } else if (e.shiftKey) {
          this.canvas.selection.toggle(hovered);
        }

        if (!hovered.nestingEnabled) {
          this.isDraggingPieces = true;
          this.dragStartOffsets.clear();

          this.canvas.selection.getAll().forEach((inst) => {
            if (!inst.nestingEnabled) {
              this.dragStartOffsets.set(inst, {
                dx: localPos.x - inst.x,
                dy: localPos.y - inst.y,
              });
            }
          });
          document.body.style.cursor = "grabbing";
        }
      } else {
        if (!e.shiftKey) this.canvas.selection.clear();
        this.isBoxSelecting = true;
        this.canvas.selection.startBox(worldPos.x, worldPos.y);
        document.body.style.cursor = "crosshair";
      }
    } else if (e.button === 2) {
      if (
        !hovered &&
        this.canvas.loadedFabric &&
        this.canvas.loadedFabric.edgeProfile
      ) {
        const ox = this.canvas.fabricOffset.x;
        const oy = this.canvas.fabricOffset.y;
        const profile = this.canvas.loadedFabric.edgeProfile;
        const tolerance = 15 / this.canvas.viewport.scale;
        let clickedOnOutline = false;

        for (let i = 0; i < profile.length; i++) {
          const v = { x: profile[i].x + ox, y: profile[i].y + oy };
          const w = {
            x: profile[(i + 1) % profile.length].x + ox,
            y: profile[(i + 1) % profile.length].y + oy,
          };

          if (pointToSegmentDistance(worldPos, v, w) <= tolerance) {
            clickedOnOutline = true;
            break;
          }
        }

        if (clickedOnOutline) {
          this.canvas.setTool("DRAG_FABRIC");
        }
      }
    }
  }

  onMouseMove(e, worldPos, localPos) {
    if (this.isDraggingPieces) {
      this.canvas.selection.getAll().forEach((inst) => {
        const offset = this.dragStartOffsets.get(inst);
        if (offset) {
          inst.x = localPos.x - offset.dx;
          inst.y = localPos.y - offset.dy;
        }
      });
      document.body.style.cursor = "grabbing";
    } else if (this.isBoxSelecting) {
      this.canvas.selection.updateBox(worldPos.x, worldPos.y);
      document.body.style.cursor = "crosshair";
    } else {
      const hovered = this.getHoveredInstance(localPos);
      if (hovered && !hovered.nestingEnabled) {
        document.body.style.cursor = "grab";
      } else {
        document.body.style.cursor = "crosshair";
      }
    }
  }

  onMouseUp(e, worldPos, localPos) {
    if (this.isDraggingPieces) {
      this.isDraggingPieces = false;
      this.dragStartOffsets.clear();
      this.canvas.saveState();
    } else if (this.isBoxSelecting) {
      this.isBoxSelecting = false;
      const ox = this.canvas.loadedFabric ? this.canvas.fabricOffset.x : 0;
      const oy = this.canvas.loadedFabric ? this.canvas.fabricOffset.y : 0;

      const boxed = this.canvas.selection.getInstancesInBox(
        this.canvas.placedInstances,
        ox,
        oy,
      );
      if (!e.shiftKey) this.canvas.selection.clear();
      boxed.forEach((inst) => this.canvas.selection.add(inst));

      this.canvas.selection.clearBox();
    }
    document.body.style.cursor = "crosshair";
  }

  onContextMenu(e, worldPos, localPos) {
    const hovered = this.getHoveredInstance(localPos);
    if (hovered && !hovered.isDiy) {
      hovered.nestingEnabled = !hovered.nestingEnabled;
      this.canvas.saveState();
    }
  }
}

export class FabricDragTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
  }

  onMouseDown(e, worldPos, localPos) {
    if (e.button !== 0) return;
    this.isDragging = true;
    this.dragStart = {
      x: worldPos.x - this.canvas.fabricOffset.x,
      y: worldPos.y - this.canvas.fabricOffset.y,
    };
    document.body.style.cursor = "move";
  }

  onMouseMove(e, worldPos, localPos) {
    document.body.style.cursor = "move";
    if (this.isDragging) {
      this.canvas.fabricOffset.x = worldPos.x - this.dragStart.x;
      this.canvas.fabricOffset.y = worldPos.y - this.dragStart.y;
    }
  }

  onMouseUp(e, worldPos, localPos) {
    this.isDragging = false;
    document.body.style.cursor = "move";
    this.canvas.saveState();
  }

  onContextMenu(e, worldPos, localPos) {
    this.canvas.setTool("SELECT");
    document.body.style.cursor = "crosshair";
  }
}

export class DrawPolyTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
  }

  onMouseDown(e, worldPos, localPos) {
    if (e.button === 0) {
      if (this.canvas.activeDrawing.length > 2) {
        const startPt = this.canvas.activeDrawing[0];
        const dist = Math.hypot(startPt.x - localPos.x, startPt.y - localPos.y);

        if (dist < 15 / this.canvas.viewport.scale) {
          this.canvas.activeDrawing.push({ x: startPt.x, y: startPt.y });
          this.finalizeShape(true);
          return;
        }
      }
      this.canvas.activeDrawing.push({ x: localPos.x, y: localPos.y });
    }
  }

  onMouseMove(e, worldPos, localPos) {
    document.body.style.cursor = "crosshair";
    if (this.canvas.activeDrawing.length > 0) {
      this.canvas.currentMousePos = { x: localPos.x, y: localPos.y };
    }
  }

  onMouseUp(e, worldPos, localPos) {}

  onKeyDown(e) {
    if (e.key === "Enter" && this.canvas.activeDrawing.length > 1) {
      this.finalizeShape(false);
    }
  }

  onContextMenu(e, worldPos, localPos) {
    if (this.canvas.activeDrawing.length > 1) {
      this.finalizeShape(false);
    } else {
      this.cancel();
    }
  }

  finalizeShape(isClosed) {
    if (this.canvas.activeDrawing.length > 1) {
      const diyPiece = {
        name: "DIY_Cut_" + Date.now(),
        vertices: [...this.canvas.activeDrawing],
        isClosed: isClosed,
      };

      this.canvas.placedInstances.push({
        id: "inst_" + Date.now(),
        piece: diyPiece,
        x: 0,
        y: 0,
        rotation: 0,
        nestingEnabled: false,
        isDiy: true,
      });

      this.canvas.saveState();
    }
    this.cancel();
  }

  cancel() {
    this.canvas.activeDrawing = [];
    this.canvas.currentMousePos = null;
    this.canvas.setTool("SELECT");
    document.dispatchEvent(
      new CustomEvent("TOOL_CHANGED", { detail: "SELECT" }),
    );
  }
}

export class BoxTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
    this.startPos = null;
    this.isDragging = false;
  }

  onMouseDown(e, worldPos, localPos) {
    if (e.button === 0) {
      this.startPos = { x: localPos.x, y: localPos.y };
      this.isDragging = true;
    }
  }

  onMouseMove(e, worldPos, localPos) {
    document.body.style.cursor = "crosshair";
    if (this.isDragging && this.startPos) {
      this.canvas.activeDrawing = [
        { x: this.startPos.x, y: this.startPos.y },
        { x: localPos.x, y: this.startPos.y },
        { x: localPos.x, y: localPos.y },
        { x: this.startPos.x, y: localPos.y },
        { x: this.startPos.x, y: this.startPos.y },
      ];
    }
  }

  onMouseUp(e, worldPos, localPos) {
    if (this.isDragging && this.canvas.activeDrawing.length > 0) {
      const diyPiece = {
        name: "DIY_Box_" + Date.now(),
        vertices: [...this.canvas.activeDrawing],
        isClosed: true,
      };

      this.canvas.placedInstances.push({
        id: "inst_" + Date.now(),
        piece: diyPiece,
        x: 0,
        y: 0,
        rotation: 0,
        nestingEnabled: false,
        isDiy: true,
      });

      this.canvas.saveState();
    }
    this.reset();
  }

  onContextMenu(e, worldPos, localPos) {
    this.reset();
  }

  reset() {
    this.isDragging = false;
    this.startPos = null;
    this.canvas.activeDrawing = [];
    this.canvas.setTool("SELECT");
    document.dispatchEvent(
      new CustomEvent("TOOL_CHANGED", { detail: "SELECT" }),
    );
  }
}

export class BoxMaskTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
    this.startPos = null;
    this.isDragging = false;
  }

  onMouseDown(e, worldPos, localPos) {
    if (e.button === 0) {
      this.startPos = { x: localPos.x, y: localPos.y };
      this.isDragging = true;
    }
  }

  onMouseMove(e, worldPos, localPos) {
    document.body.style.cursor = "crosshair";
    if (this.isDragging && this.startPos) {
      this.canvas.activeDrawing = [
        { x: this.startPos.x, y: this.startPos.y },
        { x: localPos.x, y: this.startPos.y },
        { x: localPos.x, y: localPos.y },
        { x: this.startPos.x, y: localPos.y },
        { x: this.startPos.x, y: this.startPos.y },
      ];
    }
  }

  onMouseUp(e, worldPos, localPos) {
    if (!this.isDragging) return;
    this.isDragging = false;

    if (
      this.canvas.activeDrawing.length === 0 ||
      !this.canvas.loadedFabric ||
      typeof ClipperLib === "undefined"
    ) {
      this.reset();
      return;
    }

    const scale = 1000;

    // Extracted directly as local coordinates
    const minX = Math.min(this.startPos.x, localPos.x);
    const maxX = Math.max(this.startPos.x, localPos.x);
    const minY = Math.min(this.startPos.y, localPos.y);
    const maxY = Math.max(this.startPos.y, localPos.y);

    if (Math.abs(maxX - minX) < 10 || Math.abs(maxY - minY) < 10) {
      this.reset();
      this.canvas.selection.clearNestingMask();
      document.dispatchEvent(
        new CustomEvent("NESTING_MASK_UPDATED", { detail: null }),
      );
      return;
    }

    const boxPoly = [
      { X: Math.round(minX * scale), Y: Math.round(minY * scale) },
      { X: Math.round(maxX * scale), Y: Math.round(minY * scale) },
      { X: Math.round(maxX * scale), Y: Math.round(maxY * scale) },
      { X: Math.round(minX * scale), Y: Math.round(maxY * scale) },
    ];

    const fabPoly = this.canvas.loadedFabric.edgeProfile.map((p) => ({
      X: Math.round(p.x * scale),
      Y: Math.round(p.y * scale),
    }));

    const c = new ClipperLib.Clipper();
    c.AddPaths([fabPoly], ClipperLib.PolyType.ptSubject, true);
    c.AddPaths([boxPoly], ClipperLib.PolyType.ptClip, true);

    const solution = new ClipperLib.Paths();
    c.Execute(
      ClipperLib.ClipType.ctIntersection,
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

      this.canvas.selection.nestingMaskPoly = largestPoly.map((p) => ({
        x: p.X / scale,
        y: p.Y / scale,
      }));

      document.dispatchEvent(
        new CustomEvent("NESTING_MASK_UPDATED", {
          detail: this.canvas.selection.nestingMaskPoly,
        }),
      );
    } else {
      this.canvas.selection.clearNestingMask();
      document.dispatchEvent(
        new CustomEvent("NESTING_MASK_UPDATED", { detail: null }),
      );
    }

    this.reset();
    this.canvas.saveState();
  }

  onContextMenu(e, worldPos, localPos) {
    this.canvas.selection.clearNestingMask();
    document.dispatchEvent(
      new CustomEvent("NESTING_MASK_UPDATED", { detail: null }),
    );
    this.reset();
  }

  reset() {
    this.isDragging = false;
    this.startPos = null;
    this.canvas.activeDrawing = [];
    this.canvas.setTool("SELECT");
    document.dispatchEvent(
      new CustomEvent("TOOL_CHANGED", { detail: "SELECT" }),
    );
  }
}

export class FreeMaskTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
    this.isDragging = false;
  }

  onMouseDown(e, worldPos, localPos) {
    if (e.button === 0) {
      this.canvas.activeDrawing = [{ x: localPos.x, y: localPos.y }];
      this.isDragging = true;
    }
  }

  onMouseMove(e, worldPos, localPos) {
    document.body.style.cursor = "crosshair";
    if (this.isDragging) {
      this.canvas.activeDrawing.push({ x: localPos.x, y: localPos.y });
    }
  }

  onMouseUp(e, worldPos, localPos) {
    if (!this.isDragging) return;
    this.isDragging = false;

    if (!this.canvas.loadedFabric || typeof ClipperLib === "undefined") {
      this.canvas.activeDrawing = [];
      return;
    }

    const smoothedPoints = smoothPolyline(
      this.canvas.activeDrawing,
      window.ToolSmoothing || 0,
    );
    const scale = 1000;

    const maskPoly = smoothedPoints.map((p) => ({
      X: Math.round(p.x * scale), // Already in local coordinates
      Y: Math.round(p.y * scale),
    }));

    const fabPoly = this.canvas.loadedFabric.edgeProfile.map((p) => ({
      X: Math.round(p.x * scale),
      Y: Math.round(p.y * scale),
    }));

    const c = new ClipperLib.Clipper();
    c.AddPaths([fabPoly], ClipperLib.PolyType.ptSubject, true);
    c.AddPaths([maskPoly], ClipperLib.PolyType.ptClip, true);
    const solution = new ClipperLib.Paths();

    c.Execute(
      ClipperLib.ClipType.ctIntersection,
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
      this.canvas.selection.nestingMaskPoly = largestPoly.map((p) => ({
        x: p.X / scale,
        y: p.Y / scale,
      }));
      document.dispatchEvent(
        new CustomEvent("NESTING_MASK_UPDATED", {
          detail: this.canvas.selection.nestingMaskPoly,
        }),
      );
    }

    this.canvas.activeDrawing = [];
    this.canvas.saveState();
  }

  onContextMenu(e, worldPos, localPos) {
    this.canvas.selection.clearNestingMask();
    document.dispatchEvent(
      new CustomEvent("NESTING_MASK_UPDATED", { detail: null }),
    );
  }
}

export class PolyMaskTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
  }

  onMouseDown(e, worldPos, localPos) {
    if (e.button === 0) {
      if (this.canvas.activeDrawing.length > 2) {
        const startPt = this.canvas.activeDrawing[0];
        const dist = Math.hypot(startPt.x - localPos.x, startPt.y - localPos.y);

        if (dist < 15 / this.canvas.viewport.scale) {
          this.canvas.activeDrawing.push({ x: startPt.x, y: startPt.y });
          this.finalizeMask();
          return;
        }
      }
      this.canvas.activeDrawing.push({ x: localPos.x, y: localPos.y });
    }
  }

  onMouseMove(e, worldPos, localPos) {
    document.body.style.cursor = "crosshair";
    if (this.canvas.activeDrawing.length > 0) {
      this.canvas.currentMousePos = { x: localPos.x, y: localPos.y };
    }
  }

  onMouseUp(e, worldPos, localPos) {}

  onKeyDown(e) {
    if (e.key === "Enter" && this.canvas.activeDrawing.length > 2) {
      this.finalizeMask();
    }
  }

  onContextMenu(e, worldPos, localPos) {
    if (this.canvas.activeDrawing.length === 0) {
      this.canvas.selection.clearNestingMask();
      document.dispatchEvent(
        new CustomEvent("NESTING_MASK_UPDATED", { detail: null }),
      );
    }
    this.canvas.activeDrawing = [];
    this.canvas.currentMousePos = null;
  }

  finalizeMask() {
    if (!this.canvas.loadedFabric || typeof ClipperLib === "undefined") {
      this.canvas.activeDrawing = [];
      this.canvas.currentMousePos = null;
      return;
    }

    const scale = 1000;

    const maskPoly = this.canvas.activeDrawing.map((p) => ({
      X: Math.round(p.x * scale), // Already in local coordinates
      Y: Math.round(p.y * scale),
    }));

    const fabPoly = this.canvas.loadedFabric.edgeProfile.map((p) => ({
      X: Math.round(p.x * scale),
      Y: Math.round(p.y * scale),
    }));

    const c = new ClipperLib.Clipper();
    c.AddPaths([fabPoly], ClipperLib.PolyType.ptSubject, true);
    c.AddPaths([maskPoly], ClipperLib.PolyType.ptClip, true);
    const solution = new ClipperLib.Paths();

    c.Execute(
      ClipperLib.ClipType.ctIntersection,
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
      this.canvas.selection.nestingMaskPoly = largestPoly.map((p) => ({
        x: p.X / scale,
        y: p.Y / scale,
      }));
      document.dispatchEvent(
        new CustomEvent("NESTING_MASK_UPDATED", {
          detail: this.canvas.selection.nestingMaskPoly,
        }),
      );
    }

    this.canvas.activeDrawing = [];
    this.canvas.currentMousePos = null;
    this.canvas.saveState();
  }
}

export class CutFabricTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
    this.isDragging = false;
  }

  onMouseDown(e, worldPos, localPos) {
    if (e.button === 0) {
      this.canvas.activeDrawing = [{ x: localPos.x, y: localPos.y }];
      this.isDragging = true;
    }
  }

  onMouseMove(e, worldPos, localPos) {
    document.body.style.cursor = "crosshair";
    if (this.isDragging) {
      this.canvas.activeDrawing.push({ x: localPos.x, y: localPos.y });
    }
  }

  onMouseUp(e, worldPos, localPos) {
    if (!this.isDragging) return;
    this.isDragging = false;

    if (!this.canvas.loadedFabric || typeof ClipperLib === "undefined") {
      this.canvas.activeDrawing = [];
      return;
    }

    const smoothedPoints = smoothPolyline(
      this.canvas.activeDrawing,
      window.ToolSmoothing || 0,
    );
    const scale = 1000;

    const lassoPoly = smoothedPoints.map((p) => ({
      X: Math.round(p.x * scale), // Already in local coordinates
      Y: Math.round(p.y * scale),
    }));

    const fabPoly = this.canvas.loadedFabric.edgeProfile.map((p) => ({
      X: Math.round(p.x * scale),
      Y: Math.round(p.y * scale),
    }));

    const c = new ClipperLib.Clipper();
    c.AddPaths([fabPoly], ClipperLib.PolyType.ptSubject, true);
    c.AddPaths([lassoPoly], ClipperLib.PolyType.ptClip, true);
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
      this.canvas.loadedFabric.edgeProfile = largestPoly.map((p) => ({
        x: p.X / scale,
        y: p.Y / scale,
      }));
    }

    this.canvas.activeDrawing = [];
    this.canvas.saveState();
  }

  onContextMenu(e, worldPos, localPos) {
    this.canvas.activeDrawing = [];
  }
}

export class PolyCutTool extends Tool {
  constructor(canvasManager) {
    super(canvasManager);
  }

  onMouseDown(e, worldPos, localPos) {
    if (e.button === 0) {
      if (this.canvas.activeDrawing.length > 2) {
        const startPt = this.canvas.activeDrawing[0];
        const dist = Math.hypot(startPt.x - localPos.x, startPt.y - localPos.y);

        if (dist < 15 / this.canvas.viewport.scale) {
          this.canvas.activeDrawing.push({ x: startPt.x, y: startPt.y });
          this.finalizeCut();
          return;
        }
      }
      this.canvas.activeDrawing.push({ x: localPos.x, y: localPos.y });
    }
  }

  onMouseMove(e, worldPos, localPos) {
    document.body.style.cursor = "crosshair";
    if (this.canvas.activeDrawing.length > 0) {
      this.canvas.currentMousePos = { x: localPos.x, y: localPos.y };
    }
  }

  onMouseUp(e, worldPos, localPos) {}

  onKeyDown(e) {
    if (e.key === "Enter" && this.canvas.activeDrawing.length > 2) {
      this.finalizeCut();
    }
  }

  onContextMenu(e, worldPos, localPos) {
    this.canvas.activeDrawing = [];
    this.canvas.currentMousePos = null;
  }

  finalizeCut() {
    if (!this.canvas.loadedFabric || typeof ClipperLib === "undefined") {
      this.canvas.activeDrawing = [];
      this.canvas.currentMousePos = null;
      return;
    }

    const scale = 1000;

    const cutPoly = this.canvas.activeDrawing.map((p) => ({
      X: Math.round(p.x * scale), // Already in local coordinates
      Y: Math.round(p.y * scale),
    }));

    const fabPoly = this.canvas.loadedFabric.edgeProfile.map((p) => ({
      X: Math.round(p.x * scale),
      Y: Math.round(p.y * scale),
    }));

    const c = new ClipperLib.Clipper();
    c.AddPaths([fabPoly], ClipperLib.PolyType.ptSubject, true);
    c.AddPaths([cutPoly], ClipperLib.PolyType.ptClip, true);
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
      this.canvas.loadedFabric.edgeProfile = largestPoly.map((p) => ({
        x: p.X / scale,
        y: p.Y / scale,
      }));
    }

    this.canvas.activeDrawing = [];
    this.canvas.currentMousePos = null;
    this.canvas.saveState();
  }
}
