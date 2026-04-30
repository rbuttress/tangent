// js/core/slicer.js
//version no. 1.0

export class Slicer {
  constructor(config, ox, oy) {
    this.config = config;
    this.ox = ox;
    this.oy = oy;
  }

  process(targets) {
    let toolpaths = this.generateCompensatedToolpaths(targets);
    toolpaths = this.deduplicateCommonLines(toolpaths);

    let minY = Infinity,
      maxY = -Infinity;
    toolpaths.forEach((line) => {
      if (line.p1.y < minY) minY = line.p1.y;
      if (line.p1.y > maxY) maxY = line.p1.y;
      if (line.p2.y < minY) minY = line.p2.y;
      if (line.p2.y > maxY) maxY = line.p2.y;
    });

    const bandHeight = this.config.bandHeight || 350;
    let slicedJobs = [];
    let currentTopY = maxY,
      bandIndex = 1;

    while (currentTopY > minY - 10) {
      const currentBottomY = currentTopY - bandHeight;
      const rawGeometry = this.extractGeometryForBand(
        toolpaths,
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
        slicedJobs.push({
          id: `Sub-Job ${bandIndex}`,
          topY: currentTopY,
          bottomY: currentBottomY,
          geometry: sliceGeometry,
          linesData: jobData.linesData,
          gcode: jobData.linesData.map((l) => l.text).join("\n") + "\n",
          simPaths: jobData.simPaths,
        });
        bandIndex++;
      }
      currentTopY -= bandHeight;
    }
    return slicedJobs;
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
      const isClosed = inst.piece.isClosed !== false;
      const isCCW = isClosed ? this.getPolygonArea(poly) > 0 : false;

      let segments = [];
      const segmentLimit = isClosed ? poly.length : poly.length - 1;

      for (let i = 0; i < segmentLimit; i++) {
        segments.push({
          p1: { ...poly[i] },
          p2: { ...poly[(i + 1) % poly.length] },
        });
      }

      for (let i = 0; i < segments.length; i++) {
        if (!isClosed && i === 0) continue;

        const prevIdx = isClosed
          ? (i - 1 + segments.length) % segments.length
          : i - 1;
        const segIn = segments[prevIdx];
        const segOut = segments[i];

        const vIn = { x: segIn.p2.x - segIn.p1.x, y: segIn.p2.y - segIn.p1.y };
        const vOut = {
          x: segOut.p2.x - segOut.p1.x,
          y: segOut.p2.y - segOut.p1.y,
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

  extractGeometryForBand(toolpaths, topY, bottomY) {
    let segments = [];
    toolpaths.forEach((line) => {
      const yMin = Math.min(line.p1.y, line.p2.y),
        yMax = Math.max(line.p1.y, line.p2.y);
      if (yMax < bottomY || yMin > topY) return;

      let s1 = { ...line.p1 },
        s2 = { ...line.p2 };
      const intersect = (a, b, yT) => ({
        x: a.x + ((yT - a.y) / (b.y - a.y)) * (b.x - a.x),
        y: yT,
      });

      if (s1.y > topY) s1 = intersect(line.p1, line.p2, topY);
      if (s2.y > topY) s2 = intersect(line.p1, line.p2, topY);
      if (s1.y < bottomY) s1 = intersect(line.p1, line.p2, bottomY);
      if (s2.y < bottomY) s2 = intersect(line.p1, line.p2, bottomY);

      segments.push({ p1: s1, p2: s2 });
    });
    return segments;
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
    let pool = [...segments];
    let chains = [];

    pool.sort((a, b) => {
      const aTop = Math.max(a.p1.y, a.p2.y),
        bTop = Math.max(b.p1.y, b.p2.y);
      if (Math.abs(aTop - bTop) > 10) return bTop - aTop;
      return Math.min(a.p1.x, a.p2.x) - Math.min(b.p1.x, b.p2.x);
    });

    let currentPoint = { x: pool[0].p1.x, y: pool[0].p1.y };

    while (pool.length > 0) {
      let bestIdx = -1,
        bestDist = Infinity,
        flip = false;
      for (let i = 0; i < pool.length; i++) {
        const d1 = Math.hypot(
          pool[i].p1.x - currentPoint.x,
          pool[i].p1.y - currentPoint.y,
        );
        const d2 = Math.hypot(
          pool[i].p2.x - currentPoint.x,
          pool[i].p2.y - currentPoint.y,
        );
        if (d1 < bestDist) {
          bestDist = d1;
          bestIdx = i;
          flip = false;
        }
        if (d2 < bestDist) {
          bestDist = d2;
          bestIdx = i;
          flip = true;
        }
      }
      const seg = pool.splice(bestIdx, 1)[0];
      if (flip) {
        chains.push({ p1: seg.p2, p2: seg.p1 });
        currentPoint = seg.p1;
      } else {
        chains.push(seg);
        currentPoint = seg.p2;
      }
    }
    return chains;
  }

  compileGCodeForSlice(geometry, bandTopY, bandBottomY) {
    const { zRapid, zCut, liftAngle, pivotFeed } = this.config;
    let linesData = [];
    let simPaths = [];
    let nCounter = 0;
    let curX = 0,
      curY = 0,
      curA = 0;
    const liftAngleRad = liftAngle * (Math.PI / 180);

    function addLine(cmd, pathObj) {
      const text = `N${nCounter} ${cmd}`;
      linesData.push({ n: nCounter, text: text, x: curX, y: curY, a: curA });
      if (pathObj) {
        pathObj.lineIndex = nCounter;
        simPaths.push(pathObj);
      }
      nCounter++;
    }

    addLine(`G90`, null);
    let lastX = null,
      lastY = null,
      lastA = 0,
      lastWorldX = null,
      lastWorldY = null;

    geometry.forEach((line) => {
      const mX1 = line.p1.x + this.ox,
        mX2 = line.p2.x + this.ox;
      const mY1 = line.p1.y + this.oy,
        mY2 = line.p2.y + this.oy;
      let angleRad = Math.atan2(mY2 - mY1, mX2 - mX1);

      while (angleRad - lastA > Math.PI) angleRad -= 2 * Math.PI;
      while (angleRad - lastA < -Math.PI) angleRad += 2 * Math.PI;

      const isConnected =
        lastX !== null &&
        Math.abs(mX1 - lastX) < 5.0 &&
        Math.abs(mY1 - lastY) < 5.0;

      if (!isConnected) {
        addLine(`G0 Z${zRapid}`, null);
        if (lastX !== null && lastY !== null) {
          const rapidDist = Math.hypot(mX1 - lastX, mY1 - lastY);
          if (rapidDist > 20) {
            let rapidA = Math.atan2(mY1 - lastY, mX1 - lastX);
            while (rapidA - lastA > Math.PI) rapidA -= 2 * Math.PI;
            while (rapidA - lastA < -Math.PI) rapidA += 2 * Math.PI;
            addLine(`G0 A${rapidA.toFixed(4)}`, null);
            curA = rapidA;
            while (angleRad - lastA > Math.PI) angleRad -= 2 * Math.PI;
            while (angleRad - lastA < -Math.PI) angleRad += 2 * Math.PI;
          }
        }
        addLine(`G0 X${mX1.toFixed(4)} Y${mY1.toFixed(4)}`, {
          type: "G0",
          p1: { x: lastWorldX, y: lastWorldY },
          p2: { x: line.p1.x, y: line.p1.y },
        });
        curX = mX1;
        curY = mY1;
        addLine(`G0 A${angleRad.toFixed(4)}`, null);
        curA = angleRad;
        addLine(`G1 Z${zCut} F1000`, null);
      } else {
        const angleDiff = Math.abs(angleRad - lastA);
        if (angleDiff > liftAngleRad) {
          addLine(`G0 Z${zRapid}`, null);
          if (Math.abs(mX1 - lastX) > 0.01 || Math.abs(mY1 - lastY) > 0.01) {
            addLine(`G0 X${mX1.toFixed(4)} Y${mY1.toFixed(4)}`, {
              type: "G0",
              p1: { x: lastWorldX, y: lastWorldY },
              p2: { x: line.p1.x, y: line.p1.y },
            });
            curX = mX1;
            curY = mY1;
          }
          addLine(`G0 A${angleRad.toFixed(4)}`, {
            type: "PIVOT_AIR",
            p: { x: line.p1.x, y: line.p1.y },
            a1: lastA,
            a2: angleRad,
          });
          curA = angleRad;
          addLine(`G1 Z${zCut} F1000`, null);
        } else if (angleDiff > 0.001) {
          addLine(`G1 A${angleRad.toFixed(4)} F${pivotFeed || 1000}`, {
            type: "PIVOT_MAT",
            p: { x: line.p1.x, y: line.p1.y },
            a1: lastA,
            a2: angleRad,
          });
          curA = angleRad;
        }
      }

      addLine(`G1 X${mX2.toFixed(4)} Y${mY2.toFixed(4)} F3000`, {
        type: "G1",
        p1: { x: line.p1.x, y: line.p1.y },
        p2: { x: line.p2.x, y: line.p2.y },
      });
      curX = mX2;
      curY = mY2;

      lastX = parseFloat(mX2.toFixed(4));
      lastY = parseFloat(mY2.toFixed(4));
      lastA = parseFloat(angleRad.toFixed(4));
      lastWorldX = line.p2.x;
      lastWorldY = line.p2.y;
    });

    const parkY = bandBottomY + this.oy;
    let endA = 0;
    while (endA - lastA > Math.PI) endA -= 2 * Math.PI;
    while (endA - lastA < -Math.PI) endA += 2 * Math.PI;

    addLine(`G0 Z${zRapid}`, null);
    addLine(`G0 X0 Y${parkY.toFixed(4)}`, null);
    curX = 0;
    curY = parkY;
    addLine(`G0 Z0`, null);
    addLine(`G0 A${endA.toFixed(4)}`, null);
    curA = endA;
    addLine(`G28.3 A0`, null);
    addLine(`M0`, null);

    return { linesData, simPaths };
  }
}
