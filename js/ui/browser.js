// js/ui/browser.js
//version no. 2.2

export class FileBrowser {
  constructor(containerEl, serverUrl = "http://localhost:3000") {
    this.container = containerEl;
    this.serverUrl = serverUrl;
    this.fileTree = [];
    this.parsedFilesCache = {};
    this.expandedGroups = new Set();

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

  // --- THE FIX: Recursive Time Sorting ---
  sortTreeByDate(nodes) {
    // 1. Sort the current level by time (Descending: newest first)
    nodes.sort((a, b) => {
      // Fallback to 0 (1970) if the server didn't send a date, pushing it to the bottom
      const timeA = new Date(
        a.mtime || a.lastModified || a.date || 0,
      ).getTime();
      const timeB = new Date(
        b.mtime || b.lastModified || b.date || 0,
      ).getTime();
      return timeB - timeA;
    });

    // 2. Drill down and sort all child folders recursively
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

      // THE FIX: Sort the tree before assigning it
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

        // THE FIX: Format the date cleanly (e.g., "Oct 24, 2:30 PM")
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

        // THE FIX: Inject the date label below the filename inside the flex header
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

  optimizeGeometry(vertices, distanceTolerance = 2, angleTolerance = 0.1) {
    if (!vertices || vertices.length < 3) return vertices;

    const optimized = [];
    let lastKept = vertices[0];
    optimized.push({ x: lastKept.x, y: lastKept.y, isCurve: false });

    for (let i = 1; i < vertices.length - 1; i++) {
      const pt = vertices[i];
      const next = vertices[i + 1];
      const dist = Math.hypot(pt.x - lastKept.x, pt.y - lastKept.y);

      if (dist >= distanceTolerance) {
        const angle1 = Math.atan2(pt.y - lastKept.y, pt.x - lastKept.x);
        const angle2 = Math.atan2(next.y - pt.y, next.x - pt.x);
        let angleDiff = Math.abs(angle1 - angle2);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

        if (angleDiff >= angleTolerance) {
          const isCurve = angleDiff < 0.5;
          optimized.push({ x: pt.x, y: pt.y, isCurve: isCurve });
          lastKept = pt;
        }
      }
    }

    const last = vertices[vertices.length - 1];
    optimized.push({ x: last.x, y: last.y, isCurve: false });
    return optimized;
  }

  normalizeDxfData(rawJson) {
    const processedFile = { fabrics: {}, maxDimension: 0 };
    if (!rawJson.blocks) return processedFile;

    const CURVE_TOLERANCE = 1.0;

    for (const [blockName, block] of Object.entries(rawJson.blocks)) {
      const cutPathEntity = block.entities.find(
        (e) => e.type === "POLYLINE" && e.layer === "1",
      );
      if (!cutPathEntity) continue;

      let fabricGroup = "UNASSIGNED";
      if (blockName.includes("_FABRIC_")) {
        fabricGroup = "FABRIC_" + blockName.split("_FABRIC_")[1];
      }

      const simplifiedVertices = this.optimizeGeometry(
        cutPathEntity.vertices,
        CURVE_TOLERANCE,
      );

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
