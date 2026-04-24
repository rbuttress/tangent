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
  TOPOGRAPHIC_SWEEP: "TOPOGRAPHIC_SWEEP", // Add this
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
          ClipperLib.Clipper.MinkowskiSum(invP, offsetPaths[i], solution, true);

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

// STRATEGY 5: Topographic Wave (Contour-hugging Raster)
function executeTopographicSweep(
  rotatedVertices,
  rBox,
  fBox,
  fabric,
  currentLayout,
  config,
  step,
  broadcast,
) {
  const topContour = [];

  // Phase 1: Map the absolute ceiling for this specific shape
  // We drop the shape down from the bounding box just until it fits inside the fabric
  for (let x = fBox.x; x <= fBox.x + fBox.w - rBox.w; x += step) {
    let y = fBox.y;
    while (y >= fBox.y - fBox.h + rBox.h) {
      const testPoly = rotatedVertices.map((v) => ({
        x: v.x + x,
        y: v.y + y - rBox.y,
      }));
      if (isPolygonInside(testPoly, fabric.edgeProfile, config.space)) {
        topContour.push({ x: x, startY: y }); // Save the ceiling coordinate
        break;
      }
      y -= step;
    }
  }

  // Phase 2: Push the wave downward
  let lastFrameTime = 0;

  // We sweep a depth offset from 0 down to the bottom of the fabric
  for (let depth = 0; depth <= fBox.h; depth += step) {
    // At the current depth, scan across our contour columns
    for (const col of topContour) {
      const testX = col.x;
      const testY = col.startY - depth; // Apply the depth offset to the ceiling

      // Don't test if the wave has pushed this column below the fabric
      if (testY < fBox.y - fBox.h + rBox.h) continue;

      // Non-blocking 60FPS UI Broadcast
      if (Date.now() - lastFrameTime > 16) {
        broadcast(testX, testY);
        lastFrameTime = Date.now();
      }

      // Test for collisions against other pieces.
      // Because we are iterating depth row-by-row, the VERY FIRST valid spot
      // we find is mathematically guaranteed to be the highest possible fit!
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
        else if (config.strategy === HEURISTIC.TOPOGRAPHIC_SWEEP)
          placement = executeTopographicSweep(
            rotatedVertices,
            rBox,
            fBox,
            fabric,
            currentLayout,
            config,
            resolutionStep,
            broadcast,
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
        let gMinX = Infinity,
          gMaxX = -Infinity,
          gMinY = Infinity,
          gMaxY = -Infinity;
        let totalUsedArea = 0;

        currentLayout.forEach((inst) => {
          const worldPoly = inst.piece.vertices.map((v) => ({
            x: inst.x + v.x,
            y: inst.y + v.y,
          }));
          totalUsedArea += getPolygonArea(worldPoly);
          worldPoly.forEach((p) => {
            if (p.x < gMinX) gMinX = p.x;
            if (p.x > gMaxX) gMaxX = p.x;
            if (p.y < gMinY) gMinY = p.y;
            if (p.y > gMaxY) gMaxY = p.y;
          });
        });

        const rect = { minX: gMinX, maxX: gMaxX, minY: gMinY, maxY: gMaxY };
        const clippedFabric = clipPolygonAgainstRect(fabric.edgeProfile, rect);
        const usableArea = getPolygonArea(clippedFabric);
        const score = usableArea === 0 ? 0 : (totalUsedArea / usableArea) * 100;

        const resultObj = {
          score: score,
          layout: currentLayout,
          sequence: attemptOrder,
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
