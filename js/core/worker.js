// js/core/worker.js
//version no. 2.0

if (typeof ClipperLib === "undefined") {
  importScripts("https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js");
}

const HEURISTIC = {
  TOP_LEFT_SWEEP: "TOP_LEFT_SWEEP",
  GRAVITY_DROP: "GRAVITY_DROP",
  CENTER_SPIRAL: "CENTER_SPIRAL",
  EXACT_NFP_LOCK: "EXACT_NFP_LOCK",
  TOPOGRAPHIC_LEFT: "TOPOGRAPHIC_LEFT",
  TOPOGRAPHIC_RIGHT: "TOPOGRAPHIC_RIGHT",
  TOPOGRAPHIC_SMART: "TOPOGRAPHIC_SMART",
};
// Reusable Collision Checker
function isValidPlacement(
  scanX,
  scanY,
  rotatedVertices,
  rBox,
  fabric,
  currentLayout,
  config,
) {
  const testPoly = rotatedVertices.map((v) => ({
    x: v.x + scanX,
    y: v.y + scanY - rBox.y,
  }));
  if (!isPolygonInside(testPoly, fabric.edgeProfile, config.space))
    return false;

  for (const placedPiece of currentLayout) {
    const placedPoly = placedPiece.piece.vertices.map((v) => ({
      x: v.x + placedPiece.x,
      y: v.y + placedPiece.y,
    }));
    if (doPolygonsCollide(testPoly, placedPoly, config.space)) return false;
  }
  return true;
}

/**
 *  ________       _________    ________      ________      _________    _______       ________       ___    ___
 * |\   ____\     |\___   ___\ |\   __  \    |\   __  \    |\___   ___\ |\  ___ \     |\   ____\     |\  \  /  /|
 * \ \  \___|_    \|___ \  \_| \ \  \|\  \   \ \  \|\  \   \|___ \  \_| \ \   __/|    \ \  \___|     \ \  \/  / /
 *  \ \_____  \        \ \  \   \ \   _  _\   \ \   __  \       \ \  \   \ \  \_|/__   \ \  \  ___    \ \    / /
 *   \|____|\  \        \ \  \   \ \  \\  \|   \ \  \ \  \       \ \  \   \ \  \_|\ \   \ \  \|\  \    \/  /  /
 *     ____\_\  \        \ \__\   \ \__\\ _\    \ \__\ \__\       \ \__\   \ \_______\   \ \_______\ __/  / /
 *    |\_________\        \|__|    \|__|\|__|    \|__|\|__|        \|__|    \|_______|    \|_______||\___/ /
 *    \|_________|                                                                                  \|___|/
 */

// STRATEGY 1: Traditional Raster Sweep
function executeTopLeftSweep(
  rotatedVertices,
  rBox,
  fBox,
  fabric,
  currentLayout,
  config,
  step,
  broadcast,
) {
  for (let scanY = fBox.y; scanY >= fBox.y - fBox.h + rBox.h; scanY -= step) {
    for (let scanX = fBox.x; scanX <= fBox.x + fBox.w - rBox.w; scanX += step) {
      broadcast(scanX, scanY); // <--- THE FIX: Report live position

      if (
        isValidPlacement(
          scanX,
          scanY,
          rotatedVertices,
          rBox,
          fabric,
          currentLayout,
          config,
        )
      ) {
        return { x: scanX, y: scanY - rBox.y };
      }
    }
  }
  return null;
}

// STRATEGY 2: Pseudo-Gravity (Buoyancy Slide to Top Edge)
function executeGravityDrop(
  rotatedVertices,
  rBox,
  fBox,
  fabric,
  currentLayout,
  config,
  step,
  broadcast,
) {
  let bestPos = null;
  let minDepth = Infinity;

  for (let attempt = 0; attempt < 30; attempt++) {
    let scanX = fBox.x + Math.random() * (fBox.w - rBox.w);
    let highestValidY = null;

    for (let scanY = fBox.y - fBox.h + rBox.h; scanY <= fBox.y; scanY += step) {
      broadcast(scanX, scanY); // <--- THE FIX: Report live position

      if (
        isValidPlacement(
          scanX,
          scanY,
          rotatedVertices,
          rBox,
          fabric,
          currentLayout,
          config,
        )
      ) {
        highestValidY = scanY;
      } else if (highestValidY !== null) {
        break;
      }
    }

    if (highestValidY !== null) {
      const depth = fBox.y - highestValidY;
      if (depth < minDepth) {
        minDepth = depth;
        bestPos = { x: scanX, y: highestValidY - rBox.y };
      }
    }
  }
  return bestPos;
}

// STRATEGY 3: Cluster Orbit (Corner-anchored, evaluates full rings for highest Y)

function executeCenterSpiral(
  rotatedVertices,
  rBox,
  fBox,
  fabric,
  currentLayout,
  config,
  step,
  broadcast,
) {
  let cx, cy;

  // 1. Dynamic Anchoring
  if (currentLayout.length > 0) {
    // Anchor to the top-center of the currently placed cluster
    let cMinX = Infinity,
      cMaxX = -Infinity,
      cMaxY = -Infinity;
    currentLayout.forEach((inst) => {
      const worldPoly = inst.piece.vertices.map((v) => ({
        x: inst.x + v.x,
        y: inst.y + v.y,
      }));
      worldPoly.forEach((p) => {
        if (p.x < cMinX) cMinX = p.x;
        if (p.x > cMaxX) cMaxX = p.x;
        if (p.y > cMaxY) cMaxY = p.y;
      });
    });
    cx = cMinX + (cMaxX - cMinX) / 2;
    cy = cMaxY;
  } else {
    // First piece: Randomly pick Top-Left or Top-Right corner to start
    cx = Math.random() > 0.5 ? fBox.x : fBox.x + fBox.w;
    cy = fBox.y;
  }

  let radius = 0;
  const maxRadius = Math.max(fBox.w, fBox.h) * 1.5;

  // 2. Expand outward in rings
  while (radius < maxRadius) {
    let validPlacementsInRing = [];

    // Calculate how many steps to take around this specific ring
    const circumference = Math.max(2 * Math.PI * radius, step);
    const angleStep = (step / circumference) * (Math.PI * 2);

    // Sweep the entire 360 degrees of this ring
    for (let angle = 0; angle < Math.PI * 2; angle += angleStep) {
      // Multiply X by 1.5 to create a slightly flattened search area
      let scanX = cx + Math.cos(angle) * (radius * 1.5);
      let scanY = cy + Math.sin(angle) * radius;

      if (
        scanX >= fBox.x &&
        scanX <= fBox.x + fBox.w - rBox.w &&
        scanY <= fBox.y &&
        scanY >= fBox.y - fBox.h + rBox.h
      ) {
        broadcast(scanX, scanY);

        if (
          isValidPlacement(
            scanX,
            scanY,
            rotatedVertices,
            rBox,
            fabric,
            currentLayout,
            config,
          )
        ) {
          // Save the valid spot and its absolute Y height
          validPlacementsInRing.push({
            x: scanX,
            y: scanY - rBox.y,
            rawY: scanY,
          });
        }
      }
    }

    // 3. The Tournament: If we found any valid spots in this ring,
    // sort them by height and pick the absolute highest one!
    if (validPlacementsInRing.length > 0) {
      validPlacementsInRing.sort((a, b) => b.rawY - a.rawY);
      return { x: validPlacementsInRing[0].x, y: validPlacementsInRing[0].y };
    }

    radius += step;
  }
  return null;
}

// STRATEGY 4: True Shape NFP (Minkowski Difference via Clipper)
function executeNfpLock(
  rotatedVertices,
  rBox,
  fBox,
  fabric,
  currentLayout,
  config,
  step,
  broadcast,
) {
  let testPoints = [];

  // 1. THE FIX: Fabric Inner-Fit Profile
  // Drop the piece down from the absolute top in columns until it clears the V-dips of the fabric
  for (let x = fBox.x; x <= fBox.x + fBox.w - rBox.w; x += step * 2) {
    let y = fBox.y;
    while (y >= fBox.y - fBox.h + rBox.h) {
      const testPoly = rotatedVertices.map((v) => ({
        x: v.x + x,
        y: v.y + y - rBox.y,
      }));

      // Push it down until it is fully inside the fabric boundary
      if (isPolygonInside(testPoly, fabric.edgeProfile, config.space)) {
        testPoints.push({ x: x, y: y }); // Save the highest valid fabric point for this column
        break;
      }
      y -= step;
    }
  }

  // 2. Generate exact No-Fit Polygons against all established pieces
  if (currentLayout.length > 0 && typeof ClipperLib !== "undefined") {
    const scale = 1000;

    // Invert the testing piece for Minkowski Difference
    const invP = rotatedVertices.map((v) => ({
      X: Math.round(-v.x * scale),
      Y: Math.round(-v.y * scale),
    }));

    const cleanInvP = ClipperLib.Clipper.CleanPolygon(invP, 1.1);

    for (const placed of currentLayout) {
      const pathE = placed.piece.vertices.map((v) => ({
        X: Math.round((placed.x + v.x) * scale),
        Y: Math.round((placed.y + v.y) * scale),
      }));

      // Expand the established piece by our padding requirement
      const offsetPaths = new ClipperLib.Paths();
      if (config.space > 0) {
        const co = new ClipperLib.ClipperOffset();
        co.AddPaths(
          [pathE],
          ClipperLib.JoinType.jtRound,
          ClipperLib.EndType.etClosedPolygon,
        );
        co.Execute(offsetPaths, config.space * scale);
      } else {
        offsetPaths.push(pathE);
      }

      // Calculate the Minkowski Sum to find exact contact points
      for (let i = 0; i < offsetPaths.length; i++) {
        const solution = new ClipperLib.Paths();
        try {
          ClipperLib.Clipper.MinkowskiSum(
            cleanInvP,
            offsetPaths[i],
            solution,
            true,
          );

          for (let s = 0; s < solution.length; s++) {
            for (let p = 0; p < solution[s].length; p++) {
              const pt = solution[s][p];
              testPoints.push({
                x: pt.X / scale,
                y: pt.Y / scale + rBox.y,
              });
            }
          }
        } catch (e) {
          console.error("Clipper Minkowski Math Error", e);
        }
      }
    }
  }

  // 3. Sort all exact contour and fabric points by highest Y coordinate
  testPoints.sort((a, b) => b.y - a.y);

  testPoints.sort((a, b) => b.y - a.y);

  // THE FIX: Decimation Filter
  // Clipper generates thousands of microscopic points on curves.
  // We filter them down to points that are at least 1mm apart to save the CPU.
  const filteredPoints = [];
  let lastPt = { x: -9999, y: -9999 };
  for (const pt of testPoints) {
    if (Math.abs(pt.x - lastPt.x) >= 1.0 || Math.abs(pt.y - lastPt.y) >= 1.0) {
      filteredPoints.push(pt);
      lastPt = pt;
    }
  }

  // 4. Test the filtered, high-value points.
  let lastFrameTime = 0;

  for (const pt of filteredPoints) {
    // THE FIX: Non-blocking 60FPS Broadcast
    // Instead of freezing the thread with a while loop, we just check the clock.
    // If 16ms have passed, fire a ghost frame to the UI and keep calculating instantly.
    if (Date.now() - lastFrameTime > 150) {
      broadcast(pt.x, pt.y);
      lastFrameTime = Date.now();
    }

    if (
      isValidPlacement(
        pt.x,
        pt.y,
        rotatedVertices,
        rBox,
        fabric,
        currentLayout,
        config,
      )
    ) {
      return { x: pt.x, y: pt.y - rBox.y };
    }
  }

  return null;
}

// STRATEGY 5, 6 & 7: Topographic Wave (Left, Right, and Smart Clustering)
function executeTopographicSweep(
  rotatedVertices,
  rBox,
  fBox,
  fabric,
  currentLayout,
  config,
  step,
  broadcast,
  mode, // "LEFT", "RIGHT", or "SMART"
) {
  let lastFrameTime = 0;

  // --- THE FAST SWEEPS (LEFT / RIGHT) ---
  // Bypasses the heavy contour mapping. Drops a horizontal wave from the sky.
  // Because it scans top-to-bottom, the first valid spot is inherently the highest.
  if (mode === "LEFT" || mode === "RIGHT") {
    for (let scanY = fBox.y; scanY >= fBox.y - fBox.h + rBox.h; scanY -= step) {
      let startX = mode === "LEFT" ? fBox.x : fBox.x + fBox.w - rBox.w;
      let endX = mode === "LEFT" ? fBox.x + fBox.w - rBox.w : fBox.x;
      let dx = mode === "LEFT" ? step : -step;

      for (
        let scanX = startX;
        mode === "LEFT" ? scanX <= endX : scanX >= endX;
        scanX += dx
      ) {
        if (Date.now() - lastFrameTime > 16) {
          broadcast(scanX, scanY);
          lastFrameTime = Date.now();
        }

        if (
          isValidPlacement(
            scanX,
            scanY,
            rotatedVertices,
            rBox,
            fabric,
            currentLayout,
            config,
          )
        ) {
          return { x: scanX, y: scanY - rBox.y };
        }
      }
    }
    return null;
  }

  // --- THE SMART SWEEP (CONTOUR HUGGING & CLUSTERING) ---
  // Phase 1: Map the absolute ceiling contour for this specific shape
  const topContour = [];
  for (let x = fBox.x; x <= fBox.x + fBox.w - rBox.w; x += step) {
    let y = fBox.y;
    while (y >= fBox.y - fBox.h + rBox.h) {
      const testPoly = rotatedVertices.map((v) => ({
        x: v.x + x,
        y: v.y + y - rBox.y,
      }));
      if (isPolygonInside(testPoly, fabric.edgeProfile, config.space)) {
        topContour.push({ x: x, startY: y });
        break;
      }
      y -= step;
    }
  }

  if (topContour.length === 0) return null;

  // Phase 2: Define the X-Axis Search Sequence
  let xIndices = [];
  if (currentLayout.length === 0) {
    // Piece 1 must ALWAYS find the absolute highest peak on the fabric.
    for (let i = 0; i < topContour.length; i++) xIndices.push(i);
    xIndices.sort((a, b) => topContour[b].startY - topContour[a].startY);
  } else {
    // Subsequent Pieces: ALWAYS anchor to the VERY FIRST placed piece.
    const firstPieceX = currentLayout[0].x;
    let startIndex = 0;
    let minDist = Infinity;

    for (let i = 0; i < topContour.length; i++) {
      const dist = Math.abs(topContour[i].x - firstPieceX);
      if (dist < minDist) {
        minDist = dist;
        startIndex = i;
      }
    }

    const dir = Math.random() < 0.5 ? 1 : -1;
    for (let i = 0; i < topContour.length; i++) {
      let idx = (startIndex + i * dir) % topContour.length;
      if (idx < 0) idx += topContour.length;
      xIndices.push(idx);
    }
  }

  // Phase 3: Push the wave downward
  for (let depth = 0; depth <= fBox.h; depth += step) {
    for (const idx of xIndices) {
      const col = topContour[idx];
      const testX = col.x;
      const testY = col.startY - depth;

      if (testY < fBox.y - fBox.h + rBox.h) continue;

      if (Date.now() - lastFrameTime > 16) {
        broadcast(testX, testY);
        lastFrameTime = Date.now();
      }

      if (
        isValidPlacement(
          testX,
          testY,
          rotatedVertices,
          rBox,
          fabric,
          currentLayout,
          config,
        )
      ) {
        return { x: testX, y: testY - rBox.y };
      }
    }
  }

  return null;
}

/**
 *  ___  ___      _________    ___      ___           ___      _________    ___      _______       ________
 * |\  \|\  \    |\___   ___\ |\  \    |\  \         |\  \    |\___   ___\ |\  \    |\  ___ \     |\   ____\
 * \ \  \\\  \   \|___ \  \_| \ \  \   \ \  \        \ \  \   \|___ \  \_| \ \  \   \ \   __/|    \ \  \___|_
 *  \ \  \\\  \       \ \  \   \ \  \   \ \  \        \ \  \       \ \  \   \ \  \   \ \  \_|/__   \ \_____  \
 *   \ \  \\\  \       \ \  \   \ \  \   \ \  \____    \ \  \       \ \  \   \ \  \   \ \  \_|\ \   \|____|\  \
 *    \ \_______\       \ \__\   \ \__\   \ \_______\   \ \__\       \ \__\   \ \__\   \ \_______\    ____\_\  \
 *     \|_______|        \|__|    \|__|    \|_______|    \|__|        \|__|    \|__|    \|_______|   |\_________\
 *                                                                                                   \|_________|
 */

function getBoundingBox(poly) {
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

function getCentroid(poly) {
  let cx = 0,
    cy = 0;
  poly.forEach((p) => {
    cx += p.x;
    cy += p.y;
  });
  return { x: cx / poly.length, y: cy / poly.length };
}

function doBoxesIntersect(box1, box2, padding = 0) {
  const pad = padding / 2;
  if (box1.x + box1.w + pad <= box2.x - pad) return false;
  if (box1.x - pad >= box2.x + box2.w + pad) return false;
  if (box1.y - box1.h - pad >= box2.y + pad) return false;
  if (box1.y + pad <= box2.y - box2.h - pad) return false;
  return true;
}

// Distance from a point to a line segment (Used for perfect padding)
function distToSegment(p, v, w) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return Math.sqrt((p.x - proj.x) ** 2 + (p.y - proj.y) ** 2);
}

// Robust Cross-Product Edge Intersection
function ccw(A, B, C) {
  return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
}
function doLineSegmentsIntersect(p1, p2, p3, p4) {
  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
}

function isPointInPolygon(point, polygon) {
  let isInside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) isInside = !isInside;
    j = i;
  }
  return isInside;
}

// THE FIX: True Shape Collision
function doPolygonsCollide(polyA, polyB, padding = 0) {
  if (!doBoxesIntersect(getBoundingBox(polyA), getBoundingBox(polyB), padding))
    return false;

  // 1. Edge crossing check
  for (let i = 0; i < polyA.length; i++) {
    const p1 = polyA[i],
      p2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const p3 = polyB[j],
        p4 = polyB[(j + 1) % polyB.length];
      if (doLineSegmentsIntersect(p1, p2, p3, p4)) return true;
    }
  }

  // 2. Encapsulation check (Fixes the Square Bug)
  if (isPointInPolygon(getCentroid(polyA), polyB)) return true;
  if (isPointInPolygon(getCentroid(polyB), polyA)) return true;

  // 3. Padding tolerance check
  if (padding > 0) {
    for (const pt of polyA) {
      for (let j = 0; j < polyB.length; j++) {
        if (
          distToSegment(pt, polyB[j], polyB[(j + 1) % polyB.length]) < padding
        )
          return true;
      }
    }
    for (const pt of polyB) {
      for (let i = 0; i < polyA.length; i++) {
        if (
          distToSegment(pt, polyA[i], polyA[(i + 1) % polyA.length]) < padding
        )
          return true;
      }
    }
  }
  return false;
}

// THE FIX: True Fabric Encapsulation
function isPolygonInside(innerPoly, outerPoly, padding = 0) {
  for (const pt of innerPoly) {
    if (!isPointInPolygon(pt, outerPoly)) return false;
  }
  for (let i = 0; i < innerPoly.length; i++) {
    const p1 = innerPoly[i],
      p2 = innerPoly[(i + 1) % innerPoly.length];
    for (let j = 0; j < outerPoly.length; j++) {
      const p3 = outerPoly[j],
        p4 = outerPoly[(j + 1) % outerPoly.length];
      if (doLineSegmentsIntersect(p1, p2, p3, p4)) return false;
    }
  }
  if (padding > 0) {
    for (const pt of innerPoly) {
      for (let j = 0; j < outerPoly.length; j++) {
        if (
          distToSegment(
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

// Calculate Area of Polygon (Shoelace Formula)
function getPolygonArea(poly) {
  if (!poly || poly.length < 3) return 0;
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(area / 2);
}

// Sutherland-Hodgman Polygon Clipping (Clips an irregular polygon against a bounding rectangle)
function clipPolygonAgainstRect(poly, rect) {
  let clipped = poly;
  const edges = [
    [
      (p) => p.x >= rect.minX,
      (p1, p2) => ({
        x: rect.minX,
        y: p1.y + ((p2.y - p1.y) * (rect.minX - p1.x)) / (p2.x - p1.x),
      }),
    ], // Left
    [
      (p) => p.x <= rect.maxX,
      (p1, p2) => ({
        x: rect.maxX,
        y: p1.y + ((p2.y - p1.y) * (rect.maxX - p1.x)) / (p2.x - p1.x),
      }),
    ], // Right
    [
      (p) => p.y >= rect.minY,
      (p1, p2) => ({
        x: p1.x + ((p2.x - p1.x) * (rect.minY - p1.y)) / (p2.y - p1.y),
        y: rect.minY,
      }),
    ], // Bottom
    [
      (p) => p.y <= rect.maxY,
      (p1, p2) => ({
        x: p1.x + ((p2.x - p1.x) * (rect.maxY - p1.y)) / (p2.y - p1.y),
        y: rect.maxY,
      }),
    ], // Top
  ];

  for (const [isInside, getIntersection] of edges) {
    const input = clipped;
    clipped = [];
    if (input.length === 0) break;
    let prev = input[input.length - 1];
    for (let i = 0; i < input.length; i++) {
      const curr = input[i];
      if (isInside(curr)) {
        if (!isInside(prev)) clipped.push(getIntersection(prev, curr));
        clipped.push(curr);
      } else if (isInside(prev)) {
        clipped.push(getIntersection(prev, curr));
      }
      prev = curr;
    }
  }
  return clipped;
}

function rotatePolygon(vertices, angleDegrees) {
  if (angleDegrees === 0) return vertices;
  const angleRad = angleDegrees * (Math.PI / 180);
  const cos = Math.cos(angleRad),
    sin = Math.sin(angleRad);
  const box = getBoundingBox(vertices);
  const cx = box.x + box.w / 2,
    cy = box.y - box.h / 2;

  return vertices.map((v) => {
    const tx = v.x - cx,
      ty = v.y - cy;
    return { x: tx * cos - ty * sin + cx, y: tx * sin + ty * cos + cy };
  });
}

// Generates a machinable cut line tracing the bottom of the nested pieces AND the fabric edge
function generateBottomCutLine(
  layout,
  fBox,
  fabric,
  resolution = 5,
  cutRadius = 50,
) {
  const cols = Math.ceil(fBox.w / resolution) + 1;
  const rawProfile = new Array(cols);

  // 1. Initialize the baseline using the ACTUAL top edge of the fabric
  for (let i = 0; i < cols; i++) {
    const scanX = fBox.x + i * resolution;
    let highestY = -Infinity;

    for (let j = 0; j < fabric.edgeProfile.length; j++) {
      const p1 = fabric.edgeProfile[j];
      const p2 = fabric.edgeProfile[(j + 1) % fabric.edgeProfile.length];
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);

      // Find intersections with the fabric polygon at this X column
      if (scanX >= minX && scanX <= maxX && minX !== maxX) {
        const t = (scanX - p1.x) / (p2.x - p1.x);
        const y = p1.y + t * (p2.y - p1.y);
        if (y > highestY) highestY = y; // Grab the absolute top edge
      }
    }
    rawProfile[i] = highestY !== -Infinity ? highestY : fBox.y;
  }

  // 2. Rasterize the bottom-most points of all placed pieces
  for (const inst of layout) {
    const poly = inst.piece.vertices.map((v) => ({
      x: inst.x + v.x,
      y: inst.y + v.y,
    }));
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i],
        p2 = poly[(i + 1) % poly.length];
      const minX = Math.min(p1.x, p2.x),
        maxX = Math.max(p1.x, p2.x);

      if (minX === maxX) continue; // Skip vertical lines

      const startCol = Math.max(0, Math.floor((minX - fBox.x) / resolution));
      const endCol = Math.min(
        cols - 1,
        Math.ceil((maxX - fBox.x) / resolution),
      );

      for (let col = startCol; col <= endCol; col++) {
        const scanX = fBox.x + col * resolution;
        if (scanX >= minX && scanX <= maxX) {
          const t = (scanX - p1.x) / (p2.x - p1.x);
          const y = p1.y + t * (p2.y - p1.y);
          if (y < rawProfile[col]) rawProfile[col] = y; // Save lowest Y
        }
      }
    }
  }

  // 3. Minimum Bend Radius Filter (Morphological Erosion + Average)
  const windowSize = Math.max(1, Math.floor(cutRadius / resolution));
  const lowered = new Array(cols);

  // Push the line away from the pieces to guarantee we don't cut them
  for (let i = 0; i < cols; i++) {
    let localMin = rawProfile[i];
    for (let w = -windowSize; w <= windowSize; w++) {
      if (i + w >= 0 && i + w < cols) {
        if (rawProfile[i + w] < localMin) localMin = rawProfile[i + w];
      }
    }
    lowered[i] = localMin - 5; // 5mm global safety margin
  }

  // 4. Smooth the pushed line to create the final machinable curve
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
  for (let i = 0; i < cols; i++)
    finalLine.push({ x: fBox.x + i * resolution, y: smoothed[i] });
  return finalLine;
}

/**
 *  ________      _______       ________       _______       _________    ___      ________      ________
 * |\   ____\    |\  ___ \     |\   ___  \    |\  ___ \     |\___   ___\ |\  \    |\   ____\    |\   ____\
 * \ \  \___|    \ \   __/|    \ \  \\ \  \   \ \   __/|    \|___ \  \_| \ \  \   \ \  \___|    \ \  \___|_
 *  \ \  \  ___   \ \  \_|/__   \ \  \\ \  \   \ \  \_|/__       \ \  \   \ \  \   \ \  \        \ \_____  \
 *   \ \  \|\  \   \ \  \_|\ \   \ \  \\ \  \   \ \  \_|\ \       \ \  \   \ \  \   \ \  \____    \|____|\  \
 *    \ \_______\   \ \_______\   \ \__\\ \__\   \ \_______\       \ \__\   \ \__\   \ \_______\    ____\_\  \
 *     \|_______|    \|_______|    \|__| \|__|    \|_______|        \|__|    \|__|    \|_______|   |\_________\
 *                                                                                                 \|_________|
 */

// Order 1 Crossover (OX1) - Perfect for sequence permutation
function crossoverOX1(parent1, parent2) {
  const start = Math.floor(Math.random() * parent1.length);
  let end = Math.floor(Math.random() * parent1.length);
  if (start > end) {
    const temp = start;
    end = temp;
  }

  const child = new Array(parent1.length).fill(null);
  const parent1Slice = parent1.slice(start, end + 1);

  // Copy the slice from Parent 1
  for (let i = start; i <= end; i++) {
    child[i] = parent1[i];
  }

  // Fill the rest with Parent 2, skipping what's already in the slice
  const sliceIds = new Set(parent1Slice.map((p) => p.id));
  let p2Index = 0;

  for (let i = 0; i < child.length; i++) {
    if (child[i] === null) {
      while (sliceIds.has(parent2[p2Index].id)) {
        p2Index++;
      }
      child[i] = parent2[p2Index];
      p2Index++;
    }
  }
  return child;
}

// Sequence Mutation (Swap two random pieces)
function mutateSequence(sequence, mutationRate) {
  if (Math.random() * 100 < mutationRate) {
    const idx1 = Math.floor(Math.random() * sequence.length);
    let idx2 = Math.floor(Math.random() * sequence.length);
    while (idx1 === idx2) idx2 = Math.floor(Math.random() * sequence.length);

    const temp = sequence[idx1];
    sequence[idx1] = sequence[idx2];
    sequence[idx2] = temp;
  }
  return sequence;
}

// Sort by Largest Area First
function sortByAreaDesc(pieces) {
  return [...pieces].sort((a, b) => {
    const areaA = getPolygonArea(a.piece.vertices);
    const areaB = getPolygonArea(b.piece.vertices);
    return areaB - areaA;
  });
}

/**
 *  ___       __       ________      ________      ___  __        _______       ________
 * |\  \     |\  \    |\   __  \    |\   __  \    |\  \|\  \     |\  ___ \     |\   __  \
 * \ \  \    \ \  \   \ \  \|\  \   \ \  \|\  \   \ \  \/  /|_   \ \   __/|    \ \  \|\  \
 *  \ \  \  __\ \  \   \ \  \\\  \   \ \   _  _\   \ \   ___  \   \ \  \_|/__   \ \   _  _\
 *   \ \  \|\__\_\  \   \ \  \\\  \   \ \  \\  \|   \ \  \\ \  \   \ \  \_|\ \   \ \  \\  \|
 *    \ \____________\   \ \_______\   \ \__\\ _\    \ \__\\ \__\   \ \_______\   \ \__\\ _\
 *     \|____________|    \|_______|    \|__|\|__|    \|__| \|__|    \|_______|    \|__|\|__|
 */

// --- WORKER EVENT LISTENER & MAIN EVOLUTION LOOP ---
self.onmessage = function (e) {
  const { fabric, pieces, config, manualPieces } = e.data;
  let globalBestResults = [];
  let lastKnownUiPayload = [];
  const fBox = getBoundingBox(fabric.edgeProfile);
  const resolutionStep = 4;
  let lastBroadcast = Date.now();

  let population = [];
  for (let i = 0; i < config.populationSize; i++) {
    if (i === 0 && config.initialSort === "AREA_DESC") {
      population.push(sortByAreaDesc(pieces));
    } else {
      population.push([...pieces].sort(() => Math.random() - 0.5));
    }
  }

  for (let gen = 0; gen < config.generations; gen++) {
    let generationResults = [];

    for (let popIdx = 0; popIdx < population.length; popIdx++) {
      let attemptOrder = population[popIdx];
      let currentLayout = [...manualPieces];
      let allPlaced = true;

      for (let i = 0; i < attemptOrder.length; i++) {
        const pieceRef = attemptOrder[i];
        let angle = 0;
        if (config.rotations === 2) angle = Math.random() > 0.5 ? 180 : 0;
        else if (config.rotations === 4)
          angle = Math.floor(Math.random() * 4) * 90;
        else if (config.rotations === 360)
          angle = Math.floor(Math.random() * 360);

        const rotatedVertices = rotatePolygon(pieceRef.piece.vertices, angle);
        const rBox = getBoundingBox(rotatedVertices);

        const broadcast = (scanX, scanY) => {
          if (Date.now() - lastBroadcast > 16) {
            const testPoly = rotatedVertices.map((v) => ({
              x: v.x + scanX,
              y: v.y + scanY - rBox.y,
            }));
            self.postMessage({
              type: "ghost",
              layout: currentLayout,
              testingPoly: testPoly,
            });
            lastBroadcast = Date.now();
          }
        };

        let placement = null;
        if (config.strategy === HEURISTIC.GRAVITY_DROP)
          placement = executeGravityDrop(
            rotatedVertices,
            rBox,
            fBox,
            fabric,
            currentLayout,
            config,
            resolutionStep,
            broadcast,
          );
        else if (config.strategy === HEURISTIC.CENTER_SPIRAL)
          placement = executeCenterSpiral(
            rotatedVertices,
            rBox,
            fBox,
            fabric,
            currentLayout,
            config,
            resolutionStep,
            broadcast,
          );
        else if (config.strategy === HEURISTIC.EXACT_NFP_LOCK)
          placement = executeNfpLock(
            rotatedVertices,
            rBox,
            fBox,
            fabric,
            currentLayout,
            config,
            resolutionStep,
            broadcast,
          );
        else if (config.strategy === HEURISTIC.TOPOGRAPHIC_LEFT)
          placement = executeTopographicSweep(
            rotatedVertices,
            rBox,
            fBox,
            fabric,
            currentLayout,
            config,
            resolutionStep,
            broadcast,
            "LEFT",
          );
        else if (config.strategy === HEURISTIC.TOPOGRAPHIC_RIGHT)
          placement = executeTopographicSweep(
            rotatedVertices,
            rBox,
            fBox,
            fabric,
            currentLayout,
            config,
            resolutionStep,
            broadcast,
            "RIGHT",
          );
        else if (config.strategy === HEURISTIC.TOPOGRAPHIC_SMART)
          placement = executeTopographicSweep(
            rotatedVertices,
            rBox,
            fBox,
            fabric,
            currentLayout,
            config,
            resolutionStep,
            broadcast,
            "SMART",
          );
        else
          placement = executeTopLeftSweep(
            rotatedVertices,
            rBox,
            fBox,
            fabric,
            currentLayout,
            config,
            resolutionStep,
            broadcast,
          );

        if (placement) {
          currentLayout.push({
            ...pieceRef,
            piece: {
              ...pieceRef.piece,
              vertices: rotatedVertices,
              width: rBox.w,
              height: rBox.h,
            },
            x: placement.x,
            y: placement.y,
          });
        } else {
          allPlaced = false;
          break;
        }
      }

      if (allPlaced) {
        let totalUsedArea = 0;
        currentLayout.forEach((inst) => {
          const worldPoly = inst.piece.vertices.map((v) => ({
            x: inst.x + v.x,
            y: inst.y + v.y,
          }));
          totalUsedArea += getPolygonArea(worldPoly);
        });

        // 1. Generate the machinable cut line
        const cutLineRadius = config.cutRadius || 50;
        const cutLine = generateBottomCutLine(
          currentLayout,
          fBox,
          fabric, // <-- THE FIX: Pass the fabric object here
          5,
          cutLineRadius,
        );

        // 2. Build a closed polygon representing the consumed slice of the table
        const slicePoly = [
          { X: Math.round(fBox.x * 1000), Y: Math.round(fBox.y * 1000) },
          {
            X: Math.round((fBox.x + fBox.w) * 1000),
            Y: Math.round(fBox.y * 1000),
          },
        ];
        // Trace the cut line backwards to close the loop
        for (let i = cutLine.length - 1; i >= 0; i--) {
          slicePoly.push({
            X: Math.round(cutLine[i].x * 1000),
            Y: Math.round(cutLine[i].y * 1000),
          });
        }

        // 3. Perfect Boolean Intersection using Clipper
        const subj = new ClipperLib.Paths();
        subj.push(slicePoly);
        const clip = new ClipperLib.Paths();
        const fabPoly = fabric.edgeProfile.map((p) => ({
          X: Math.round(p.x * 1000),
          Y: Math.round(p.y * 1000),
        }));
        clip.push(fabPoly);

        const cleanSubj = ClipperLib.Clipper.SimplifyPolygons(
          subj,
          ClipperLib.PolyFillType.pftNonZero,
        );
        const cleanClip = ClipperLib.Clipper.SimplifyPolygons(
          clip,
          ClipperLib.PolyFillType.pftNonZero,
        );

        const solution = new ClipperLib.Paths();
        const c = new ClipperLib.Clipper();
        c.StrictlySimple = true; // Force strict parsing

        // Use the cleaned paths
        c.AddPaths(cleanSubj, ClipperLib.PolyType.ptSubject, true);
        c.AddPaths(cleanClip, ClipperLib.PolyType.ptClip, true);
        c.Execute(
          ClipperLib.ClipType.ctIntersection,
          solution,
          ClipperLib.PolyFillType.pftNonZero,
          ClipperLib.PolyFillType.pftNonZero,
        );

        // 4. Calculate final area of the true Boolean shape
        let usableArea = 0;
        for (let i = 0; i < solution.length; i++) {
          usableArea +=
            Math.abs(ClipperLib.Clipper.Area(solution[i])) / 1000000;
        }

        const score = usableArea === 0 ? 0 : (totalUsedArea / usableArea) * 100;

        // THE FIX: Save the cutLine directly into the result object so it persists to local storage!
        const resultObj = {
          score: score,
          layout: currentLayout,
          sequence: attemptOrder,
          cutLine: cutLine,
        };
        generationResults.push(resultObj);

        // THE FIX: LIVE-STREAMING LEADERBOARD
        // Instantly push this successful run to the global pool and sort it
        globalBestResults.push(resultObj);
        globalBestResults.sort((a, b) => b.score - a.score);
        globalBestResults = globalBestResults
          .filter(
            (value, index, self) =>
              index ===
              self.findIndex(
                (t) => t.score.toFixed(2) === value.score.toFixed(2),
              ),
          )
          .slice(0, 10);

        lastKnownUiPayload = globalBestResults.map((r, idx) => ({
          id: idx + 1,
          score: r.score,
          layout: r.layout,
          cutLine: r.cutLine,
        }));
      }

      // Intermittent UI Broadcast (streams the live leaderboard ~10 times per generation)
      if (
        popIdx > 0 &&
        popIdx % Math.max(1, Math.floor(population.length / 10)) === 0
      ) {
        self.postMessage({
          type: "update",
          topIterations: lastKnownUiPayload,
          currentGen: gen + 1,
          totalGens: config.generations,
          genProgress: (popIdx / population.length) * 100,
        });
      }
    }

    // Breed the Next Generation
    if (gen < config.generations - 1 && generationResults.length > 0) {
      let nextPopulation = [];
      const eliteCount = Math.min(config.elitism, generationResults.length);
      for (let i = 0; i < eliteCount; i++)
        nextPopulation.push(generationResults[i].sequence);

      while (nextPopulation.length < config.populationSize) {
        const p1Idx = Math.floor(
          Math.random() * (generationResults.length / 2),
        );
        const p2Idx = Math.floor(
          Math.random() * (generationResults.length / 2),
        );

        let child = crossoverOX1(
          generationResults[p1Idx].sequence,
          generationResults[p2Idx].sequence,
        );
        child = mutateSequence(child, config.mutationRate);
        nextPopulation.push(child);
      }
      population = nextPopulation;
    }
  }

  // Final Job Done Broadcast
  self.postMessage({
    type: "done",
    topIterations: lastKnownUiPayload,
    currentGen: config.generations,
    totalGens: config.generations,
    genProgress: 100,
  });
};
