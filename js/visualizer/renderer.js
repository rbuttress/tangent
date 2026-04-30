// js/visualizer/renderer.js
//version no. 1.6

import { machine } from "../core/machine.js";

export class Renderer {
  constructor(visualizer) {
    this.viz = visualizer;
    this.dashOffset = 0;
  }

  animate() {
    const {
      ctx,
      canvas,
      viewport,
      selection,
      isAltHeld,
      altTargetPos,
      isNestingLive,
      hoverPreviewData,
      gcodeSolidData,
      highlightedJob,
      globalCutLinePreview,
    } = this.viz;

    const diff = viewport.targetY - viewport.offsetY;
    if (Math.abs(diff) > 0.1) viewport.offsetY += diff * 0.05;
    else viewport.offsetY = viewport.targetY;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawGrid();
    this.drawLoadedFabric();
    this.drawLiveTrace();

    this.drawNestingMask();
    this.drawActiveToolPath();

    if (isNestingLive) {
      this.drawPlacedInstances();
      this.drawGhostFrame();
    } else {
      this.drawPlacedInstances();
    }

    if (hoverPreviewData) {
      this.drawHoverPreview();
    }

    if (gcodeSolidData) {
      this.drawCompletedCuts();
      this.drawSimulator();
      if (highlightedJob) this.drawSubJobHighlight();

      if (globalCutLinePreview) this.drawGlobalCutLinePreview();
    } else {
      this.drawPlacedInstances();
      if (isNestingLive) this.drawGhostFrame();
      if (hoverPreviewData) this.drawHoverPreview();
    }

    if (selection.box) {
      ctx.save();
      const p1 = this.viz.input.worldToPx(
        selection.box.startX,
        selection.box.startY,
      );
      const p2 = this.viz.input.worldToPx(
        selection.box.endX,
        selection.box.endY,
      );
      ctx.fillStyle = "rgba(74, 144, 226, 0.2)";
      ctx.strokeStyle = "rgba(74, 144, 226, 0.8)";
      ctx.lineWidth = 1;
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.restore();
    }

    this.drawHeading();
    this.drawTool();

    if (isAltHeld && altTargetPos) {
      this.drawJogTargetLine();
    }

    requestAnimationFrame(() => this.animate());
  }

  drawJogTargetLine() {
    const { ctx, input, altTargetPos } = this.viz;
    const startPx = input.worldToPx(machine.currentPos.x, machine.currentPos.y);
    const endPx = input.worldToPx(altTargetPos.x, altTargetPos.y);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startPx.x, startPx.y);
    ctx.lineTo(endPx.x, endPx.y);

    ctx.strokeStyle = "rgba(255, 60, 60, 0.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.stroke();

    // Draw a crosshair at the mouse target
    ctx.beginPath();
    ctx.arc(endPx.x, endPx.y, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(endPx.x - 15, endPx.y);
    ctx.lineTo(endPx.x + 15, endPx.y);
    ctx.moveTo(endPx.x, endPx.y - 15);
    ctx.lineTo(endPx.x, endPx.y + 15);
    ctx.stroke();

    ctx.restore();
  }

  drawGlobalCutLinePreview() {
    const {
      ctx,
      input,
      canvas,
      globalCutLinePreview,
      loadedFabric,
      fabricOffset,
    } = this.viz;
    if (!globalCutLinePreview || !loadedFabric) return;

    const ox = fabricOffset.x;
    const oy = fabricOffset.y;

    ctx.save();

    // Clip the rendering logic strictly to the bounding box of the fabric
    ctx.beginPath();
    loadedFabric.edgeProfile.forEach((p, i) => {
      const screenPos = input.worldToPx(p.x + ox, p.y + oy);
      if (i === 0) ctx.moveTo(screenPos.x, screenPos.y);
      else ctx.lineTo(screenPos.x, screenPos.y);
    });
    ctx.clip();

    // Fill polygon bounded by the smoothed cut line and the top of the canvas
    ctx.beginPath();
    globalCutLinePreview.forEach((p, i) => {
      const screenPos = input.worldToPx(p.x + ox, p.y + oy);
      if (i === 0) ctx.moveTo(screenPos.x, screenPos.y);
      else ctx.lineTo(screenPos.x, screenPos.y);
    });

    // Draw lines way up to encompass the "used" section
    ctx.lineTo(canvas.width + 1000, -1000);
    ctx.lineTo(-1000, -1000);
    ctx.closePath();

    ctx.fillStyle = "rgba(255, 60, 60, 0.2)";
    ctx.fill();

    // Redraw the smoothed dashed line over the fill
    ctx.beginPath();
    globalCutLinePreview.forEach((p, i) => {
      const screenPos = input.worldToPx(p.x + ox, p.y + oy);
      if (i === 0) ctx.moveTo(screenPos.x, screenPos.y);
      else ctx.lineTo(screenPos.x, screenPos.y);
    });

    ctx.strokeStyle = "#ff3c3c";
    ctx.lineWidth = 2;
    ctx.setLineDash([15, 10]);
    ctx.stroke();

    ctx.restore();
  }

  drawCompletedCuts() {
    const {
      ctx,
      input,
      viewport,
      simulatorJobs,
      completedJobs,
      maxLineByJob,
      loadedFabric,
      fabricOffset,
    } = this.viz;
    if (!simulatorJobs || simulatorJobs.length === 0) return;

    const ox = loadedFabric ? fabricOffset.x : 0;
    const oy = loadedFabric ? fabricOffset.y : 0;

    ctx.save();
    ctx.strokeStyle = "#2BEA64";
    ctx.lineWidth = 1.5 / viewport.scale;
    ctx.setLineDash([]);

    ctx.beginPath();
    simulatorJobs.forEach((job) => {
      const isFullyCompleted = completedJobs.has(job.id);
      const maxLine = maxLineByJob[job.id] ?? -1;

      job.simPaths.forEach((path) => {
        if (path.type === "G1") {
          if (isFullyCompleted || path.lineIndex <= maxLine) {
            const p1 = input.worldToPx(path.p1.x + ox, path.p1.y + oy);
            const p2 = input.worldToPx(path.p2.x + ox, path.p2.y + oy);
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
          }
        }
      });
    });
    ctx.stroke();
    ctx.restore();
  }

  drawNestingMask() {
    const { ctx, input, selection, loadedFabric, fabricOffset } = this.viz;

    if (selection.nestingMaskBox) {
      ctx.save();
      const p1 = input.worldToPx(
        selection.nestingMaskBox.startX,
        selection.nestingMaskBox.startY,
      );
      const p2 = input.worldToPx(
        selection.nestingMaskBox.endX,
        selection.nestingMaskBox.endY,
      );
      ctx.fillStyle = "rgba(255, 170, 0, 0.1)";
      ctx.strokeStyle = "rgba(255, 170, 0, 0.8)";
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.restore();
    }

    if (selection.nestingMaskPoly) {
      const ox = loadedFabric ? fabricOffset.x : 0;
      const oy = loadedFabric ? fabricOffset.y : 0;
      ctx.save();
      ctx.beginPath();
      selection.nestingMaskPoly.forEach((v, i) => {
        const screenPos = input.worldToPx(v.x + ox, v.y + oy);
        if (i === 0) ctx.moveTo(screenPos.x, screenPos.y);
        else ctx.lineTo(screenPos.x, screenPos.y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 170, 0, 0.25)";
      ctx.fill();
      ctx.restore();
    }
  }

  drawActiveToolPath() {
    const {
      ctx,
      input,
      viewport,
      activeDrawing,
      currentMousePos,
      loadedFabric,
      fabricOffset,
    } = this.viz;
    if (activeDrawing.length === 0) return;

    const ox = loadedFabric ? fabricOffset.x : 0;
    const oy = loadedFabric ? fabricOffset.y : 0;

    ctx.strokeStyle = "#2BEA64";
    ctx.lineWidth = 2 / viewport.scale;
    ctx.beginPath();
    activeDrawing.forEach((v, i) => {
      const screenPos = input.worldToPx(v.x + ox, v.y + oy);
      if (i === 0) ctx.moveTo(screenPos.x, screenPos.y);
      else ctx.lineTo(screenPos.x, screenPos.y);
    });
    if (currentMousePos) {
      const screenPos = input.worldToPx(
        currentMousePos.x + ox,
        currentMousePos.y + oy,
      );
      ctx.lineTo(screenPos.x, screenPos.y);
    }
    ctx.stroke();
  }

  drawPlacedInstances() {
    const {
      ctx,
      input,
      viewport,
      placedInstances,
      selection,
      loadedFabric,
      fabricOffset,
    } = this.viz;
    this.dashOffset -= 0.5;

    const ox = loadedFabric ? fabricOffset.x : 0;
    const oy = loadedFabric ? fabricOffset.y : 0;

    placedInstances.forEach((inst) => {
      ctx.save();
      const screenPos = input.worldToPx(inst.x + ox, inst.y + oy);
      ctx.translate(screenPos.x, screenPos.y);
      ctx.scale(viewport.scale, viewport.scale);

      ctx.beginPath();
      inst.piece.vertices.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, -v.y);
        else ctx.lineTo(v.x, -v.y);
      });

      const isSelected = selection.isSelected(inst);

      if (inst.isDiy) {
        ctx.strokeStyle = isSelected ? "#4a90e2" : "#ffaa00";
        ctx.lineWidth = (isSelected ? 4 : 2) / viewport.scale;
        ctx.setLineDash(
          isSelected
            ? [8 / viewport.scale, 8 / viewport.scale]
            : [5 / viewport.scale, 5 / viewport.scale],
        );
        ctx.lineDashOffset = isSelected ? this.dashOffset : 0;
        ctx.stroke();
      } else {
        ctx.closePath();
        if (isSelected) {
          ctx.strokeStyle = "#4a90e2";
          ctx.lineWidth = 4 / viewport.scale;
          ctx.fillStyle = "rgba(74, 144, 226, 0.2)";
          ctx.fill();
        } else if (inst.nestingEnabled) {
          ctx.strokeStyle = "#888888";
          ctx.lineWidth = 2 / viewport.scale;
        } else {
          ctx.strokeStyle = "black";
          ctx.lineWidth = 2 / viewport.scale;
        }
        ctx.setLineDash([8 / viewport.scale, 8 / viewport.scale]);
        ctx.lineDashOffset = isSelected ? this.dashOffset : 0;
        ctx.stroke();
      }

      const pointSize = 4 / viewport.scale;
      const offset = pointSize / 2;
      const squareColor = isSelected
        ? "#4a90e2"
        : inst.isDiy
          ? "#ffaa00"
          : "black";

      inst.piece.vertices.forEach((v) => {
        ctx.beginPath();
        if (v.isCurve) {
          ctx.fillStyle = "#ff0000";
          ctx.arc(v.x, -v.y, offset, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = squareColor;
          ctx.rect(v.x - offset, -v.y - offset, pointSize, pointSize);
          ctx.fill();
        }
      });
      ctx.restore();
    });
  }

  drawGhostFrame() {
    const {
      ctx,
      input,
      viewport,
      isNestingLive,
      ghostLayout,
      ghostTestingPoly,
      loadedFabric,
      fabricOffset,
    } = this.viz;
    if (!isNestingLive) return;

    const ox = loadedFabric ? fabricOffset.x : 0;
    const oy = loadedFabric ? fabricOffset.y : 0;

    ghostLayout.forEach((inst) => {
      ctx.save();
      const screenPos = input.worldToPx(inst.x + ox, inst.y + oy);
      ctx.translate(screenPos.x, screenPos.y);
      ctx.scale(viewport.scale, viewport.scale);

      ctx.beginPath();
      inst.piece.vertices.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, -v.y);
        else ctx.lineTo(v.x, -v.y);
      });
      ctx.closePath();

      ctx.strokeStyle = "rgba(74, 144, 226, 0.5)";
      ctx.lineWidth = 1 / viewport.scale;
      ctx.stroke();
      ctx.fillStyle = "rgba(74, 144, 226, 0.05)";
      ctx.fill();
      ctx.restore();
    });

    if (ghostTestingPoly) {
      ctx.save();
      ctx.beginPath();
      ghostTestingPoly.forEach((v, i) => {
        const screenPos = input.worldToPx(v.x + ox, v.y + oy);
        if (i === 0) ctx.moveTo(screenPos.x, screenPos.y);
        else ctx.lineTo(screenPos.x, screenPos.y);
      });
      ctx.closePath();

      ctx.strokeStyle = "#ff00ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 0, 255, 0.2)";
      ctx.fill();
      ctx.restore();
    }
  }

  drawHoverPreview() {
    const {
      ctx,
      input,
      canvas,
      viewport,
      hoverPreviewData,
      loadedFabric,
      fabricOffset,
    } = this.viz;
    if (!hoverPreviewData || !hoverPreviewData.layout) return;

    const layout = hoverPreviewData.layout;
    const cutLine = hoverPreviewData.cutLine;

    const ox = loadedFabric ? fabricOffset.x : 0;
    const oy = loadedFabric ? fabricOffset.y : 0;

    layout.forEach((inst) => {
      ctx.save();
      const screenPos = input.worldToPx(inst.x + ox, inst.y + oy);
      ctx.translate(screenPos.x, screenPos.y);
      ctx.scale(viewport.scale, viewport.scale);

      ctx.beginPath();
      inst.piece.vertices.forEach((v, i) => {
        if (i === 0) ctx.moveTo(v.x, -v.y);
        else ctx.lineTo(v.x, -v.y);
      });
      ctx.closePath();

      ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
      ctx.lineWidth = 1 / viewport.scale;
      ctx.stroke();
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fill();
      ctx.restore();
    });

    if (cutLine && loadedFabric && loadedFabric.edgeProfile) {
      ctx.save();
      ctx.beginPath();
      loadedFabric.edgeProfile.forEach((p, i) => {
        const screenPos = input.worldToPx(p.x + ox, p.y + oy);
        if (i === 0) ctx.moveTo(screenPos.x, screenPos.y);
        else ctx.lineTo(screenPos.x, screenPos.y);
      });
      ctx.clip();

      ctx.beginPath();
      ctx.moveTo(-10000, -10000);
      ctx.lineTo(canvas.width + 10000, -10000);
      for (let i = cutLine.length - 1; i >= 0; i--) {
        const pt = input.worldToPx(cutLine[i].x + ox, cutLine[i].y + oy);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();

      ctx.fillStyle = "rgba(74, 144, 226, 0.08)";
      ctx.fill();

      ctx.beginPath();
      cutLine.forEach((p, i) => {
        const pt = input.worldToPx(p.x + ox, p.y + oy);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });

      ctx.strokeStyle = "rgba(255, 60, 60, 0.8)";
      ctx.setLineDash([10, 6]);
      ctx.lineWidth = 2 / viewport.scale;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawLiveTrace() {
    const { ctx, input, activeTracePoints } = this.viz;
    if (activeTracePoints.length === 0) return;

    ctx.beginPath();
    ctx.strokeStyle = "#2BEA64";
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;

    activeTracePoints.forEach((p, index) => {
      const screenPos = input.worldToPx(p.x, p.y);
      if (index === 0) ctx.moveTo(screenPos.x, screenPos.y);
      else ctx.lineTo(screenPos.x, screenPos.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#2BEA64";
    activeTracePoints.forEach((p) => {
      const screenPos = input.worldToPx(p.x, p.y);
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawLoadedFabric() {
    const { ctx, input, loadedFabric, fabricOffset, currentTool } = this.viz;
    if (
      !loadedFabric ||
      !loadedFabric.edgeProfile ||
      loadedFabric.edgeProfile.length === 0
    )
      return;

    ctx.save();
    const hexColor = loadedFabric.color || "#cccccc";
    ctx.fillStyle = hexColor + "33";
    ctx.strokeStyle = hexColor;
    ctx.lineWidth = 2;

    if (currentTool && currentTool.constructor.name === "FabricDragTool") {
      ctx.setLineDash([5, 5]);
      ctx.fillStyle = hexColor + "66";
    }

    const profile = loadedFabric.edgeProfile;
    const ox = fabricOffset.x;
    const oy = fabricOffset.y;
    ctx.beginPath();
    profile.forEach((p, i) => {
      const screenPos = input.worldToPx(p.x + ox, p.y + oy);
      if (i === 0) ctx.moveTo(screenPos.x, screenPos.y);
      else ctx.lineTo(screenPos.x, screenPos.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawGrid() {
    const { ctx, viewport, bounds, canvas, input } = this.viz;
    const machineY = machine.currentPos.y;
    const leftEdge = viewport.offsetX;
    const rightEdge = viewport.offsetX + bounds.width * viewport.scale;

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
        const screenPos = input.worldToPx(x, y);
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
    const { ctx, input, controller } = this.viz;
    if (!controller || controller.activeAngle === null) return;

    const pos = machine.currentPos;
    const screenPos = input.gantryToPx(pos.x);
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
    const { ctx, viewport, input, toolRadius } = this.viz;
    const pos = machine.currentPos;
    const screenPos = input.gantryToPx(pos.x);

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
      toolRadius * viewport.scale,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 1;
    ctx.stroke();

    const adjustedAngle = Math.PI - pos.a;
    const lineLen = toolRadius * viewport.scale;

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
    const {
      ctx,
      input,
      viewport,
      simulatorJobs,
      simulatorCutJob,
      loadedFabric,
      fabricOffset,
    } = this.viz;
    const ox = loadedFabric ? fabricOffset.x : 0;
    const oy = loadedFabric ? fabricOffset.y : 0;

    ctx.save();
    const allJobs = [...simulatorJobs];
    if (simulatorCutJob) allJobs.push(simulatorCutJob);

    allJobs.forEach((job) => {
      job.simPaths.forEach((path) => {
        if (path.type === "G0" || path.type === "G1") {
          const isFloat = path.type === "G0";
          const p1 = input.worldToPx(path.p1.x + ox, path.p1.y + oy);
          const p2 = input.worldToPx(path.p2.x + ox, path.p2.y + oy);

          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);

          if (isFloat) {
            ctx.strokeStyle = "rgba(255, 60, 60, 0.4)";
            ctx.setLineDash([2, 3]);
            ctx.lineWidth = 0.5;
          } else {
            ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
            ctx.setLineDash([]);
            ctx.lineWidth = 0.5 / viewport.scale;
          }
          ctx.stroke();
        }
      });
    });
    ctx.restore();
  }

  drawSubJobHighlight() {
    const {
      ctx,
      canvas,
      input,
      viewport,
      highlightedJob,
      hoveredGcodeLine,
      loadedFabric,
      fabricOffset,
    } = this.viz;
    const ox = loadedFabric ? fabricOffset.x : 0;
    const oy = loadedFabric ? fabricOffset.y : 0;
    const job = highlightedJob;

    const drawWedge = (px, a1, a2, isFloating, customHex) => {
      let delta = a2 - a1;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;

      const slices = 15;
      const radius = isFloating ? 18 : 12;

      let baseRgb = isFloating ? "255, 60, 60" : "43, 234, 100";
      if (customHex === "#ff00ff") baseRgb = "255, 0, 255";
      else if (customHex === "#eac72b") baseRgb = "234, 199, 43";
      else if (customHex === "rgba(255, 60, 60, 0.2)")
        baseRgb = "100, 100, 100";

      for (let i = 1; i <= slices; i++) {
        const f0 = (i - 1) / slices;
        const f1 = i / slices;
        const cA1 = -(a1 + delta * f0);
        const cA2 = -(a1 + delta * f1);

        ctx.beginPath();
        ctx.moveTo(px.x, px.y);
        ctx.arc(px.x, px.y, radius, cA1, cA2, delta > 0);
        ctx.closePath();
        ctx.fillStyle = `rgba(${baseRgb}, ${f1 * 0.7})`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.moveTo(px.x, px.y);
      ctx.lineTo(
        px.x + Math.cos(-(a1 + delta)) * radius * 1.2,
        px.y + Math.sin(-(a1 + delta)) * radius * 1.2,
      );
      ctx.strokeStyle = `rgba(${baseRgb}, 1)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    ctx.save();

    const screenTopY = input.worldToPx(0, job.topY + oy).y;
    const screenBottomY = input.worldToPx(0, job.bottomY + oy).y;
    ctx.fillStyle = "rgba(43, 234, 100, 0.08)";
    ctx.fillRect(0, screenTopY, canvas.width, screenBottomY - screenTopY);

    const isHovering = hoveredGcodeLine && hoveredGcodeLine.jobId === job.id;
    const hoverIdx = isHovering ? hoveredGcodeLine.lineIndex : -1;

    job.simPaths.forEach((path) => {
      let strokeColor = job.isCutLine ? "#eac72b" : "#ff3c3c";
      let lineWidth = 1.2 / viewport.scale;

      if (isHovering) {
        if (path.lineIndex < hoverIdx) {
          strokeColor = "#eac72b";
          lineWidth = 1.5 / viewport.scale;
        } else if (path.lineIndex === hoverIdx) {
          strokeColor = "#ff00ff";
          lineWidth = 2.5 / viewport.scale;
        } else {
          strokeColor = "rgba(255, 60, 60, 0.2)";
        }
      }

      if (path.type === "G1") {
        const p1 = input.worldToPx(path.p1.x + ox, path.p1.y + oy);
        const p2 = input.worldToPx(path.p2.x + ox, path.p2.y + oy);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = strokeColor;
        ctx.setLineDash([]);
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      } else if (path.type === "PIVOT_MAT") {
        const px = input.worldToPx(path.p.x + ox, path.p.y + oy);
        drawWedge(px, path.a1, path.a2, false, strokeColor);
      }
    });

    job.simPaths.forEach((path) => {
      let strokeColor = "rgba(255, 60, 60, 0.9)";
      let lineWidth = 1;

      if (isHovering) {
        if (path.lineIndex < hoverIdx) {
          strokeColor = "#eac72b";
        } else if (path.lineIndex === hoverIdx) {
          strokeColor = "#ff00ff";
          lineWidth = 2;
        } else {
          strokeColor = "rgba(255, 60, 60, 0.2)";
        }
      }

      if (path.type === "G0") {
        const p1 = input.worldToPx(path.p1.x + ox, path.p1.y + oy);
        const p2 = input.worldToPx(path.p2.x + ox, path.p2.y + oy);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = strokeColor;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      } else if (path.type === "PIVOT_AIR") {
        const px = input.worldToPx(path.p.x + ox, path.p.y + oy);
        drawWedge(px, path.a1, path.a2, true, strokeColor);
      }
    });

    ctx.restore();
  }
}
