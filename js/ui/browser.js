// js/ui/browser.js
//version no. 2.3

export class FileBrowser {
  constructor(containerEl, serverUrl = "http://localhost:3000") {
    this.container = containerEl;
    this.serverUrl = serverUrl;
    this.fileTree = [];
    this.parsedFilesCache = {};
    this.expandedGroups = new Set();

    // --- THE FIX: Curve Tessellation & Optimization Constants ---
    this.curveConfig = {
      // How many line segments make up a perfect 360-degree circle?
      // 36 = rough (10° steps), 72 = smooth (5° steps), 360 = ultra-smooth (1° steps)
      circleSegments: 360 / 2,

      // Safety limit: Never generate microscopic segments that choke the TinyG buffer (mm)
      minSegLength: 0.5,

      // Decimation limit (radians): Delete intermediate points on flat lines.
      // 0.05 rad = ~2.8 degrees. Any angle smaller than this gets merged.
      collinearAngle: 0.05,
    };

    if (!this.container) {
      console.error("FileBrowser requires a container element.");
      return;
    }

    this.initDOM();
    this.fetchFiles();
  }

  initDOM() {
    this.container.innerHTML = `
        <div id="file-list-container" style="display: flex; flex-direction: column; gap: 4px; padding-top: 4px;">
            <span style="color: var(--text-muted); font-size: 10px;">Loading files...</span>
        </div>
    `;
  }

  sortTreeByDate(nodes) {
    nodes.sort((a, b) => {
      const timeA = new Date(
        a.mtime || a.lastModified || a.date || 0,
      ).getTime();
      const timeB = new Date(
        b.mtime || b.lastModified || b.date || 0,
      ).getTime();
      return timeB - timeA;
    });

    nodes.forEach((node) => {
      if (node.children && node.children.length > 0) {
        this.sortTreeByDate(node.children);
      }
    });

    return nodes;
  }

  async fetchFiles() {
    const listContainer = this.container.querySelector("#file-list-container");
    try {
      const response = await fetch(`${this.serverUrl}/api/files`);
      const rawTree = await response.json();

      this.fileTree = this.sortTreeByDate(rawTree);

      listContainer.innerHTML = "";
      if (this.fileTree.length === 0) {
        listContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 10px; padding: 10px;">No DXF files found in /dxf/</span>`;
        return;
      }
      this.renderFileTree(this.fileTree, listContainer);
    } catch (e) {
      listContainer.innerHTML = `<span style="color:red; font-size: 10px; padding: 10px;">Failed to load files.</span>`;
    }
  }

  renderFileTree(nodes, parentElement, depth = 0) {
    nodes.forEach((node) => {
      if (node.type === "folder") {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.className = "folder-summary";
        summary.style.setProperty("--depth", depth);
        summary.innerText = `📁 ${node.name}`;

        details.appendChild(summary);

        const folderContent = document.createElement("div");
        folderContent.className = "folder-content";

        this.renderFileTree(node.children, folderContent, depth + 1);

        details.appendChild(folderContent);
        parentElement.appendChild(details);
      } else if (
        node.type === "file" &&
        node.name.toLowerCase().endsWith(".dxf")
      ) {
        const item = document.createElement("div");
        item.className = "file-item";

        let dateStr = "";
        const rawDate = node.mtime || node.lastModified || node.date;
        if (rawDate) {
          const d = new Date(rawDate);
          dateStr =
            d.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }) +
            ", " +
            d.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            });
        }

        item.innerHTML = `
            <div class="file-item-header" style="align-items: flex-start;">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span>📄 ${node.name}</span>
                    ${dateStr ? `<span style="font-size: 8px; font-weight: normal; color: rgba(150, 150, 150, 0.7);">${dateStr}</span>` : ""}
                </div>
            </div>
            <div class="dxf-accordion-content" id="content-${node.name.replace(/\./g, "-")}">
                <span style="font-size: 10px; color: var(--text-muted);">Parsing...</span>
            </div>
        `;

        const header = item.querySelector(".file-item-header");
        header.style.setProperty("--depth", depth);
        header.onclick = () => this.toggleAccordion(node, item);

        parentElement.appendChild(item);
      }
    });
  }

  async toggleAccordion(node, elementNode) {
    const isExpanded = elementNode.classList.contains("expanded");
    const allItems = this.container.querySelectorAll(".file-item");
    allItems.forEach((el) => el.classList.remove("expanded"));

    if (isExpanded) return;

    elementNode.classList.add("expanded");
    const contentContainer = elementNode.querySelector(
      ".dxf-accordion-content",
    );

    if (this.parsedFilesCache[node.path]) {
      this.renderParsedData(this.parsedFilesCache[node.path], contentContainer);
      return;
    }

    try {
      const response = await fetch(
        `${this.serverUrl}/api/parse?file=${encodeURIComponent(node.path)}`,
      );
      const rawJson = await response.json();

      const normalizedData = this.normalizeDxfData(rawJson);
      this.parsedFilesCache[node.path] = normalizedData;

      this.renderParsedData(normalizedData, contentContainer);
    } catch (e) {
      contentContainer.innerHTML = `<span style="color:red; font-size: 10px;">Parse failed.</span>`;
    }
  }

  // --- THE FIX: DXF Bulge (Arc) Interpolation ---
  // Transforms native DXF arcs into CNC-ready line segments based on your curveConfig
  interpolateBulges(vertices) {
    const expanded = [];

    for (let i = 0; i < vertices.length; i++) {
      const pt = vertices[i];
      expanded.push({ x: pt.x, y: pt.y, isCurve: false });

      if (pt.bulge && pt.bulge !== 0) {
        const nextPt = vertices[(i + 1) % vertices.length];

        // Prevent bulging back to the start if the polyline isn't truly closed
        if (
          i === vertices.length - 1 &&
          Math.hypot(pt.x - nextPt.x, pt.y - nextPt.y) < 0.01
        )
          continue;

        const arcPoints = this.calculateBulge(pt, nextPt, pt.bulge);
        expanded.push(...arcPoints);
      }
    }
    return expanded;
  }

  calculateBulge(p1, p2, bulge) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const chordLen = Math.hypot(dx, dy);
    if (chordLen === 0) return [];

    const radius = Math.abs(chordLen / (2 * Math.sin(2 * Math.atan(bulge))));
    const sagitta = Math.abs((chordLen / 2) * bulge);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const centerOffset = radius - sagitta;

    const isClockwise = bulge < 0;
    const perpX = (-dy / chordLen) * centerOffset * (isClockwise ? -1 : 1);
    const perpY = (dx / chordLen) * centerOffset * (isClockwise ? -1 : 1);

    const cx = midX + perpX;
    const cy = midY + perpY;

    let startAngle = Math.atan2(p1.y - cy, p1.x - cx);
    let endAngle = Math.atan2(p2.y - cy, p2.x - cx);

    let sweep = endAngle - startAngle;
    if (isClockwise && sweep > 0) sweep -= Math.PI * 2;
    if (!isClockwise && sweep < 0) sweep += Math.PI * 2;

    const fractionOfCircle = Math.abs(sweep) / (Math.PI * 2);
    let segments = Math.max(
      1,
      Math.ceil(this.curveConfig.circleSegments * fractionOfCircle),
    );

    const arcLength = radius * Math.abs(sweep);
    if (arcLength / segments < this.curveConfig.minSegLength) {
      segments = Math.max(
        1,
        Math.ceil(arcLength / this.curveConfig.minSegLength),
      );
    }

    const points = [];
    const angleStep = sweep / segments;
    // Skip first point to prevent duplicating the origin vertex
    for (let i = 1; i < segments; i++) {
      const currentAngle = startAngle + angleStep * i;
      points.push({
        x: cx + Math.cos(currentAngle) * radius,
        y: cy + Math.sin(currentAngle) * radius,
        isCurve: true,
      });
    }
    return points;
  }

  // --- THE FIX: Smart Geometry Optimization ---
  // Only deletes points if they lie on a flat, straight line.
  // Keeps all organic curves completely intact.
  optimizeGeometry(vertices) {
    if (!vertices || vertices.length < 3) return vertices;

    const optimized = [vertices[0]];
    let lastKept = vertices[0];

    for (let i = 1; i < vertices.length - 1; i++) {
      const pt = vertices[i];
      const next = vertices[i + 1];

      // ALWAYS keep points that we know are part of a true curve
      if (pt.isCurve) {
        optimized.push(pt);
        lastKept = pt;
        continue;
      }

      // Filter out overlapping glitch points
      const dist = Math.hypot(pt.x - lastKept.x, pt.y - lastKept.y);
      if (dist < 0.1) continue;

      const angle1 = Math.atan2(pt.y - lastKept.y, pt.x - lastKept.x);
      const angle2 = Math.atan2(next.y - pt.y, next.x - pt.x);
      let angleDiff = Math.abs(angle1 - angle2);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

      // If the angle deviates beyond our collinear tolerance, it's a corner or organic curve. Keep it!
      if (angleDiff > this.curveConfig.collinearAngle) {
        optimized.push({ x: pt.x, y: pt.y, isCurve: angleDiff < 0.5 });
        lastKept = pt;
      }
    }

    optimized.push(vertices[vertices.length - 1]);
    return optimized;
  }

  normalizeDxfData(rawJson) {
    const processedFile = { fabrics: {}, maxDimension: 0 };
    if (!rawJson.blocks) return processedFile;

    for (const [blockName, block] of Object.entries(rawJson.blocks)) {
      const cutPathEntity = block.entities.find(
        (e) => e.type === "POLYLINE" || e.type === "LWPOLYLINE",
      );
      if (!cutPathEntity) continue;

      let fabricGroup = "UNASSIGNED";
      if (blockName.includes("FABRIC_")) {
        fabricGroup = "FABRIC_" + blockName.split("FABRIC_")[1];
      }

      // 1. Expand any mathematical arcs (bulges) hidden in the DXF
      const interpolatedVertices = this.interpolateBulges(
        cutPathEntity.vertices,
      );

      // 2. Run the smart optimizer to clean up flat lines but preserve the curves
      const simplifiedVertices = this.optimizeGeometry(interpolatedVertices);

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      simplifiedVertices.forEach((v) => {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      });

      const width = maxX - minX;
      const height = maxY - minY;

      if (width > processedFile.maxDimension)
        processedFile.maxDimension = width;
      if (height > processedFile.maxDimension)
        processedFile.maxDimension = height;

      const zeroedVertices = simplifiedVertices.map((v) => ({
        x: v.x - minX,
        y: v.y - maxY,
        isCurve: v.isCurve,
      }));

      if (!processedFile.fabrics[fabricGroup])
        processedFile.fabrics[fabricGroup] = [];

      processedFile.fabrics[fabricGroup].push({
        name: blockName,
        width: width,
        height: height,
        vertices: zeroedVertices,
      });
    }
    return processedFile;
  }

  generatePatternThumbnail(piece, globalMaxDimension) {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");

    const scale = 80 / globalMaxDimension;
    ctx.save();
    ctx.translate(50, 50);
    ctx.scale(scale, -scale);
    ctx.translate(-piece.width / 2, piece.height / 2);

    ctx.strokeStyle = "#4a90e2";
    ctx.lineWidth = 1.5 / scale;
    ctx.fillStyle = "rgba(74, 144, 226, 0.1)";

    ctx.beginPath();
    piece.vertices.forEach((v, i) => {
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    return canvas;
  }

  renderParsedData(normalizedData, container) {
    container.innerHTML = "";
    if (Object.keys(normalizedData.fabrics).length === 0) {
      container.innerHTML = `<span style="font-size: 10px; color: var(--text-muted);">No pattern blocks found.</span>`;
      return;
    }

    for (const [fabricName, pieces] of Object.entries(normalizedData.fabrics)) {
      const groupDiv = document.createElement("div");
      groupDiv.className = "dxf-fabric-group";

      const header = document.createElement("div");
      header.className = "dxf-fabric-header";
      header.innerText = fabricName.replace(/_/g, " ");
      header.style.cursor = "pointer";
      header.title = "Add entire group to cutting queue";

      header.onclick = (e) => {
        e.stopPropagation();
        document.dispatchEvent(
          new CustomEvent("GROUP_SELECTED", {
            detail: { groupName: fabricName, pieces: pieces },
          }),
        );
      };

      groupDiv.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "dxf-pattern-grid";

      pieces.forEach((piece) => {
        const thumbBtn = document.createElement("div");
        thumbBtn.className = "dxf-pattern-thumb";
        thumbBtn.title = piece.name;

        const canvas = this.generatePatternThumbnail(
          piece,
          normalizedData.maxDimension,
        );
        thumbBtn.appendChild(canvas);

        thumbBtn.onclick = (e) => {
          e.stopPropagation();
          document.dispatchEvent(
            new CustomEvent("PATTERN_SELECTED", {
              detail: { piece: piece },
            }),
          );
        };

        grid.appendChild(thumbBtn);
      });

      groupDiv.appendChild(grid);
      container.appendChild(groupDiv);
    }
  }
}
