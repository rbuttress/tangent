// js/core/nester.js
//version no. 2.6

const savedConfig = JSON.parse(localStorage.getItem("nestConfig")) || {};
window.NestConfig = {
  strategy: savedConfig.strategy || "TOPOGRAPHIC_SWEEP",
  space: savedConfig.space !== undefined ? savedConfig.space : 5,
  rotations: savedConfig.rotations !== undefined ? savedConfig.rotations : 2,
  generations: savedConfig.generations || 10,
  populationSize: savedConfig.populationSize || 10,
  elitism: savedConfig.elitism !== undefined ? savedConfig.elitism : 2,
  mutationRate:
    savedConfig.mutationRate !== undefined ? savedConfig.mutationRate : 15,
  initialSort: savedConfig.initialSort || "AREA_DESC",
};

export class Nester {
  constructor() {
    document.addEventListener(
      "NEST_CONFIG_UPDATED",
      (e) => (window.NestConfig = e.detail),
    );

    // THE FIX: Track the local nesting mask
    this.activeMask = null;
    document.addEventListener("NESTING_MASK_UPDATED", (e) => {
      this.activeMask = e.detail;
    });

    this.worker = null;
  }

  // --- MIRRORED GEOMETRY MATH FOR INSTANT UI STAGING ---
  static getBoundingBox(poly) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    poly.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    return { x: minX, y: maxY, w: maxX - minX, h: maxY - minY };
  }

  static getCentroid(poly) {
    let cx = 0,
      cy = 0;
    poly.forEach((p) => {
      cx += p.x;
      cy += p.y;
    });
    return { x: cx / poly.length, y: cy / poly.length };
  }

  static doBoxesIntersect(box1, box2, padding = 0) {
    const pad = padding / 2;
    if (box1.x + box1.w + pad <= box2.x - pad) return false;
    if (box1.x - pad >= box2.x + box2.w + pad) return false;
    if (box1.y - box1.h - pad >= box2.y + pad) return false;
    if (box1.y + pad <= box2.y - box2.h - pad) return false;
    return true;
  }

  static distToSegment(p, v, w) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return Math.sqrt((p.x - proj.x) ** 2 + (p.y - proj.y) ** 2);
  }

  static ccw(A, B, C) {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  }
  static doLineSegmentsIntersect(p1, p2, p3, p4) {
    return (
      this.ccw(p1, p3, p4) !== this.ccw(p2, p3, p4) &&
      this.ccw(p1, p2, p3) !== this.ccw(p1, p2, p4)
    );
  }

  static isPointInPolygon(point, polygon) {
    let isInside = false;
    let j = polygon.length - 1;
    for (let i = 0; i < polygon.length; i++) {
      const xi = polygon[i].x,
        yi = polygon[i].y;
      const xj = polygon[j].x,
        yj = polygon[j].y;
      if (
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
      )
        isInside = !isInside;
      j = i;
    }
    return isInside;
  }

  static doPolygonsCollide(polyA, polyB, padding = 0) {
    if (
      !this.doBoxesIntersect(
        this.getBoundingBox(polyA),
        this.getBoundingBox(polyB),
        padding,
      )
    )
      return false;
    for (let i = 0; i < polyA.length; i++) {
      const p1 = polyA[i],
        p2 = polyA[(i + 1) % polyA.length];
      for (let j = 0; j < polyB.length; j++) {
        const p3 = polyB[j],
          p4 = polyB[(j + 1) % polyB.length];
        if (this.doLineSegmentsIntersect(p1, p2, p3, p4)) return true;
      }
    }
    if (this.isPointInPolygon(this.getCentroid(polyA), polyB)) return true;
    if (this.isPointInPolygon(this.getCentroid(polyB), polyA)) return true;
    if (padding > 0) {
      for (const pt of polyA) {
        for (let j = 0; j < polyB.length; j++) {
          if (
            this.distToSegment(pt, polyB[j], polyB[(j + 1) % polyB.length]) <
            padding
          )
            return true;
        }
      }
      for (const pt of polyB) {
        for (let i = 0; i < polyA.length; i++) {
          if (
            this.distToSegment(pt, polyA[i], polyA[(i + 1) % polyA.length]) <
            padding
          )
            return true;
        }
      }
    }
    return false;
  }

  static isPolygonInside(innerPoly, outerPoly, padding = 0) {
    for (const pt of innerPoly) {
      if (!this.isPointInPolygon(pt, outerPoly)) return false;
    }
    for (let i = 0; i < innerPoly.length; i++) {
      const p1 = innerPoly[i],
        p2 = innerPoly[(i + 1) % innerPoly.length];
      for (let j = 0; j < outerPoly.length; j++) {
        const p3 = outerPoly[j],
          p4 = outerPoly[(j + 1) % outerPoly.length];
        if (this.doLineSegmentsIntersect(p1, p2, p3, p4)) return false;
      }
    }
    if (padding > 0) {
      for (const pt of innerPoly) {
        for (let j = 0; j < outerPoly.length; j++) {
          if (
            this.distToSegment(
              pt,
              outerPoly[j],
              outerPoly[(j + 1) % outerPoly.length],
            ) < padding
          )
            return false;
        }
      }
    }
    return true;
  }

  static placePiece(pieceDef, fabric, placedPieces) {
    const gridStep = 10;
    const fBox = this.getBoundingBox(fabric.edgeProfile);
    const pBox = this.getBoundingBox(pieceDef.vertices);
    const pad = window.NestConfig.space;

    for (
      let scanY = fBox.y;
      scanY >= fBox.y - fBox.h + pBox.h;
      scanY -= gridStep
    ) {
      for (
        let scanX = fBox.x;
        scanX <= fBox.x + fBox.w - pBox.w;
        scanX += gridStep
      ) {
        const testPoly = pieceDef.vertices.map((v) => ({
          x: v.x + scanX,
          y: v.y + scanY - pBox.y,
        }));

        if (!this.isPolygonInside(testPoly, fabric.edgeProfile, pad)) continue;

        let collision = false;
        for (const placed of placedPieces) {
          const placedPoly = placed.piece.vertices.map((v) => ({
            x: v.x + placed.x,
            y: v.y + placed.y,
          }));
          if (this.doPolygonsCollide(testPoly, placedPoly, pad)) {
            collision = true;
            break;
          }
        }

        if (!collision) return { x: scanX, y: scanY - pBox.y };
      }
    }
    return null;
  }

  // --- WORKER CONTROLS ---
  startNesting(fabric, placedInstances) {
    if (!fabric) return;

    // THE FIX: Completely hide DIY drawn lines from the nesting engine
    const validInstances = placedInstances.filter((p) => !p.isDiy);

    const manualPieces = validInstances.filter((p) => !p.nestingEnabled);
    const autoPieces = validInstances.filter((p) => p.nestingEnabled);

    if (autoPieces.length === 0) return;

    if (this.worker) this.worker.terminate();
    this.worker = new Worker("./js/core/worker.js");

    this.worker.onmessage = (e) => {
      const data = e.data;

      if (data.type === "ghost") {
        document.dispatchEvent(
          new CustomEvent("NESTING_GHOST_FRAME", {
            detail: { layout: data.layout, testingPoly: data.testingPoly },
          }),
        );
      }

      if (data.type === "update" || data.type === "done") {
        document.dispatchEvent(
          new CustomEvent("NESTING_LEADERBOARD_UPDATE", {
            detail: {
              topIterations: e.data.topIterations,
              progress: {
                currentGen: e.data.currentGen || 0,
                totalGens: e.data.totalGens || 1,
                genProgress: e.data.genProgress || 100,
              },
            },
          }),
        );

        if (data.topIterations.length > 0) {
          document.dispatchEvent(
            new CustomEvent("PREVIEW_ITERATION", {
              detail: data.topIterations[0].layout,
            }),
          );
        }
      }
    };

    this.worker.postMessage({
      fabric,
      activeMask: this.activeMask,
      pieces: autoPieces,
      manualPieces,
      config: window.NestConfig,
    });
  }

  stopNesting() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
