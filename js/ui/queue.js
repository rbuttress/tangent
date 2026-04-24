// js/ui/queue.js
//version no. 4.2

export class QueueMenu {
  constructor(containerEl) {
    this.container = containerEl;
    this.groups = {};

    if (!this.container) return;
    this.initDOM();
    this.loadState();

    document.addEventListener("PATTERN_SELECTED", (e) => {
      const piece = e.detail.piece;
      this.addPiece("Selected Patterns", piece, 1);
      this.syncToCanvas("SPAWN_INSTANCE", piece);
    });

    document.addEventListener("GROUP_SELECTED", (e) => {
      const pieces = e.detail.pieces;
      const groupName = e.detail.groupName.replace(/_/g, " ");
      pieces.forEach((piece) => {
        this.addPiece(groupName, piece, 1);
        this.syncToCanvas("SPAWN_INSTANCE", piece);
      });
    });
  }

  initDOM() {
    const html = `
            <div id="queue-list" style="display: flex; flex-direction: column; margin-bottom: 10px; max-height: 350px; overflow-y: auto;"></div>
            <div class="queue-actions">
                <button class="q-action-btn" id="btn-nest-settings" title="Meta-Heuristics">⚙️</button>
                <button class="q-action-btn play" id="btn-run-nest" title="Start Nesting">▶</button>
                <button class="q-action-btn stop" id="btn-stop-nest" title="Stop Nesting">⏹</button>
            </div>
        `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    wrapper.style.cssText =
      "display: flex; flex-direction: column; height: 100%;";
    this.container.appendChild(wrapper);

    this.listContainer = this.container.querySelector("#queue-list");

    // Play Button -> Sends array to Nester
    this.container.querySelector("#btn-run-nest").onclick = () => {
      const allItems = this.getFlattenedQueue();
      if (allItems.length === 0) return alert("Queue is empty!");
      document.dispatchEvent(
        new CustomEvent("RUN_NESTING", { detail: allItems }),
      );
    };

    // Stop Button -> Halts the Web Worker
    this.container.querySelector("#btn-stop-nest").onclick = () => {
      document.dispatchEvent(new Event("STOP_NESTING"));
    };

    // Settings Button -> Opens Modal
    this.container.querySelector("#btn-nest-settings").onclick = () =>
      this.openSettingsModal();
  }

  // --- DATA MANAGEMENT ---

  addPiece(groupName, piece, countDelta) {
    if (!this.groups[groupName]) {
      this.groups[groupName] = { items: {} };
    }

    const g = this.groups[groupName];
    if (!g.items[piece.name]) {
      g.items[piece.name] = { piece: piece, count: 0 };
    }

    g.items[piece.name].count += countDelta;

    if (g.items[piece.name].count <= 0) {
      delete g.items[piece.name];
    }
    if (Object.keys(g.items).length === 0) {
      delete this.groups[groupName];
    }

    this.saveState();
    this.render();
  }

  updateGroup(groupName, countDelta, deleteWholeGroup = false) {
    const g = this.groups[groupName];
    if (!g) return;

    Object.values(g.items).forEach((item) => {
      const actualDelta = deleteWholeGroup ? -item.count : countDelta;
      for (let i = 0; i < Math.abs(actualDelta); i++) {
        this.syncToCanvas(
          actualDelta > 0 ? "SPAWN_INSTANCE" : "REMOVE_INSTANCE",
          item.piece,
        );
      }
      this.addPiece(groupName, item.piece, actualDelta);
    });
  }

  updateItem(groupName, piece, countDelta, deleteWholeItem = false) {
    const item = this.groups[groupName]?.items[piece.name];
    if (!item) return;

    const actualDelta = deleteWholeItem ? -item.count : countDelta;
    for (let i = 0; i < Math.abs(actualDelta); i++) {
      this.syncToCanvas(
        actualDelta > 0 ? "SPAWN_INSTANCE" : "REMOVE_INSTANCE",
        piece,
      );
    }
    this.addPiece(groupName, piece, actualDelta);
  }

  getFlattenedQueue() {
    const flat = [];
    Object.values(this.groups).forEach((g) => {
      Object.values(g.items).forEach((item) => {
        for (let i = 0; i < item.count; i++) {
          flat.push({ ...item.piece, id: item.piece.name + "_" + i });
        }
      });
    });
    return flat;
  }

  syncToCanvas(eventName, piece) {
    document.dispatchEvent(
      new CustomEvent(eventName, { detail: { piece: piece } }),
    );
  }

  saveState() {
    localStorage.setItem("nestingQueueState", JSON.stringify(this.groups));
  }

  loadState() {
    const saved = localStorage.getItem("nestingQueueState");
    if (saved) {
      try {
        this.groups = JSON.parse(saved);
        this.render();
      } catch (e) {
        console.error("Failed to parse queue state", e);
      }
    } else {
      this.render();
    }
  }

  // --- UI RENDERING ---

  generateThumbnail(piece) {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32; // THE FIX: Increased thumbnail size
    const ctx = canvas.getContext("2d");

    const maxDim = Math.max(piece.width, piece.height);
    const scale = 26 / (maxDim || 1); // Left a 3px padding margin inside the canvas

    ctx.save();
    ctx.translate(16, 16);
    ctx.scale(scale, -scale);
    ctx.translate(-piece.width / 2, piece.height / 2);

    ctx.strokeStyle = "#4a90e2";
    ctx.lineWidth = 1.5 / scale;
    ctx.fillStyle = "rgba(74, 144, 226, 0.2)";

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

  render() {
    this.listContainer.innerHTML = "";

    if (Object.keys(this.groups).length === 0) {
      this.listContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 10px; font-style: italic; padding: 4px;">No patterns selected...</div>`;
      return;
    }

    for (const [groupName, groupData] of Object.entries(this.groups)) {
      const gDiv = document.createElement("div");
      gDiv.className = "queue-group-container";

      // Group Header (Left click add, Right click remove)
      gDiv.innerHTML = `
                <div class="queue-header" title="Left-click to add, Right-click to remove">
                    <span class="header-title" style="flex: 1;">${groupName.toUpperCase()}</span>
                    <button class="header-del-btn" title="Delete entire group">✕</button>
                </div>
                <div class="group-items"></div>
            `;

      const header = gDiv.querySelector(".queue-header");

      // THE FIX: Intercept Left & Right Clicks on the header
      header.onclick = (e) => {
        e.preventDefault();
        this.updateGroup(groupName, 1);
      };
      header.oncontextmenu = (e) => {
        e.preventDefault(); // Prevents the browser menu from showing
        this.updateGroup(groupName, -1);
      };

      // THE FIX: Stop the delete click from bubbling up and triggering an "add"
      gDiv.querySelector(".header-del-btn").onclick = (e) => {
        e.stopPropagation();
        this.updateGroup(groupName, 0, true);
      };

      const itemsContainer = gDiv.querySelector(".group-items");

      // Render Inline Grid Items
      for (const [pieceName, item] of Object.entries(groupData.items)) {
        const iDiv = document.createElement("div");
        iDiv.className = "queue-item";
        iDiv.title = `${pieceName}\nLeft-click to add, Right-click to remove`;

        const thumb = this.generateThumbnail(item.piece);

        iDiv.innerHTML = `
                    <div class="thumb-wrapper" style="width: 32px; height: 32px; position: relative;">
                        <span class="item-count">${item.count}</span>
                    </div>
                    <button class="q-del-btn" title="Remove piece completely">✕</button>
                `;

        iDiv
          .querySelector(".thumb-wrapper")
          .insertBefore(thumb, iDiv.querySelector(".item-count"));

        // THE FIX: Direct manipulation for individual shapes
        iDiv.onclick = (e) => {
          e.preventDefault();
          this.updateItem(groupName, item.piece, 1);
        };
        iDiv.oncontextmenu = (e) => {
          e.preventDefault();
          this.updateItem(groupName, item.piece, -1);
        };
        iDiv.querySelector(".q-del-btn").onclick = (e) => {
          e.stopPropagation();
          this.updateItem(groupName, item.piece, 0, true);
        };

        itemsContainer.appendChild(iDiv);
      }

      this.listContainer.appendChild(gDiv);
    }
  }

  //version no. 2.8
  openSettingsModal() {
    const modalLayer = document.getElementById("modal-layer");
    if (!modalLayer) return;

    const savedConfig = JSON.parse(localStorage.getItem("nestConfig")) || {};

    const currentConfig = window.NestConfig || {
      strategy: savedConfig.strategy || "TOPOGRAPHIC_SWEEP",
      space: savedConfig.space !== undefined ? savedConfig.space : 5,
      rotations:
        savedConfig.rotations !== undefined ? savedConfig.rotations : 2,

      // --- NEW META-HEURISTICS ---
      generations: savedConfig.generations || 10,
      populationSize: savedConfig.populationSize || 10,
      elitism: savedConfig.elitism !== undefined ? savedConfig.elitism : 2,
      mutationRate:
        savedConfig.mutationRate !== undefined ? savedConfig.mutationRate : 15,
      initialSort: savedConfig.initialSort || "AREA_DESC",
    };

    const modalHtml = `
            <div class="glass-modal-overlay" id="nest-settings-overlay">
                <div class="glass-modal-content" style="max-width: 500px;">
                    <h3>Evolutionary Meta-Heuristics</h3>
                    
                    <div class="form-row">
                        <div class="form-group" style="flex: 2;">
                            <label>Placement Strategy</label>
                            <select id="nest-strategy">
                                <option value="TOP_LEFT_SWEEP" ${currentConfig.strategy === "TOP_LEFT_SWEEP" ? "selected" : ""}>Raster Sweep</option>
                                <option value="GRAVITY_DROP" ${currentConfig.strategy === "GRAVITY_DROP" ? "selected" : ""}>Buoyancy Slide</option>
                                <option value="CENTER_SPIRAL" ${currentConfig.strategy === "CENTER_SPIRAL" ? "selected" : ""}>Cluster Orbit</option>
                                <option value="EXACT_NFP_LOCK" ${currentConfig.strategy === "EXACT_NFP_LOCK" ? "selected" : ""}>Minkowski NFP</option>
                                <option value="TOPOGRAPHIC_SWEEP" ${currentConfig.strategy === "TOPOGRAPHIC_SWEEP" ? "selected" : ""}>Topographic Wave</option>
                            </select>
                        </div>
                        <div class="form-group" style="flex: 1;">
                            <label>Rotations</label>
                            <select id="nest-rotations">
                                <option value="1" ${currentConfig.rotations === 1 ? "selected" : ""}>0° Only</option>
                                <option value="2" ${currentConfig.rotations === 2 ? "selected" : ""}>0°, 180°</option>
                                <option value="4" ${currentConfig.rotations === 4 ? "selected" : ""}>0°, 90°, 180°, 270°</option>
                                <option value="360" ${currentConfig.rotations === 360 ? "selected" : ""}>Free (1°)</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label>Seed Sorting</label>
                            <select id="nest-sort">
                                <option value="AREA_DESC" ${currentConfig.initialSort === "AREA_DESC" ? "selected" : ""}>Largest Area First</option>
                                <option value="RANDOM" ${currentConfig.initialSort === "RANDOM" ? "selected" : ""}>Completely Random</option>
                            </select>
                        </div>
                        <div class="form-group">
    <label>Spacing (mm)</label>
    <input type="number" id="nest-space" value="${currentConfig.space}" min="0" step="any">
</div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label>Generations (Cycles)</label>
                            <input type="number" id="nest-gen" value="${currentConfig.generations}" min="1">
                        </div>
                        <div class="form-group">
                            <label>Population / Gen</label>
                            <input type="number" id="nest-pop" value="${currentConfig.populationSize}" min="2">
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label>Elitism (Survivors)</label>
                            <input type="number" id="nest-elite" value="${currentConfig.elitism}" min="0">
                        </div>
                        <div class="form-group">
                            <label>Mutation Rate (%)</label>
                            <input type="number" id="nest-mut" value="${currentConfig.mutationRate}" min="0" max="100">
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button class="glass-btn secondary" id="btn-cancel-nest">Cancel</button>
                        <button class="glass-btn primary" id="btn-save-nest">Save & Tune Engine</button>
                    </div>
                </div>
            </div>
        `;

    modalLayer.innerHTML = modalHtml;

    document.getElementById("btn-cancel-nest").onclick = () =>
      (modalLayer.innerHTML = "");

    document.getElementById("btn-save-nest").onclick = () => {
      // THE FIX: Parse the value first, and only default to 5 if it's literally NaN (blank)
      const spaceVal = parseFloat(document.getElementById("nest-space").value);

      window.NestConfig = {
        strategy: document.getElementById("nest-strategy").value,
        space: isNaN(spaceVal) ? 5 : spaceVal, // <--- THE FIX
        rotations:
          parseInt(document.getElementById("nest-rotations").value) || 2,
        generations: parseInt(document.getElementById("nest-gen").value) || 10,
        populationSize:
          parseInt(document.getElementById("nest-pop").value) || 10,
        elitism: parseInt(document.getElementById("nest-elite").value) || 2,
        mutationRate: parseInt(document.getElementById("nest-mut").value) || 15,
        initialSort: document.getElementById("nest-sort").value,
      };

      localStorage.setItem("nestConfig", JSON.stringify(window.NestConfig));
      document.dispatchEvent(
        new CustomEvent("NEST_CONFIG_UPDATED", { detail: window.NestConfig }),
      );
      modalLayer.innerHTML = "";
    };
  }

  addToQueue(data, type) {
    // Check if exact item/group already exists, increment if so
    const existingId = type === "single" ? data.name : data[0].name + "_group";
    const existingIndex = this.queue.findIndex((q) => q.id === existingId);

    if (existingIndex > -1) {
      this.queue[existingIndex].count += 1;
    } else {
      this.queue.push({
        id: existingId,
        type: type,
        pieces: type === "single" ? [data] : data,
        count: 1,
        nestingEnabled: true,
      });
    }

    this.updateUI();
  }

  updateItem(groupName, piece, countDelta, deleteWholeItem = false) {
    // 1. Look up the item using direct object keys instead of an array .findIndex()
    const item = this.groups[groupName]?.items[piece.name];

    // If it doesn't exist, exit safely
    if (!item) return;

    // 2. Calculate how many we are adding or removing
    const actualDelta = deleteWholeItem ? -item.count : countDelta;

    // 3. Sync the exact number of additions/removals to the Canvas
    for (let i = 0; i < Math.abs(actualDelta); i++) {
      this.syncToCanvas(
        actualDelta > 0 ? "SPAWN_INSTANCE" : "REMOVE_INSTANCE",
        piece,
      );
    }

    // 4. Update the Queue's internal data state
    this.addPiece(groupName, piece, actualDelta);
  }

  updateUI() {
    this.wrapper.innerHTML = "";

    this.queue.forEach((item) => {
      const el = document.createElement("div");
      el.className = `queue-item ${item.type === "group" ? "queue-item-group" : ""}`;

      item.pieces.forEach((piece) => {
        const canvas = this.generateShapeCanvas(piece);
        el.appendChild(canvas);
      });

      const controls = document.createElement("div");
      controls.className = "queue-controls";
      controls.innerHTML = `
                <button class="queue-btn btn-del" title="Remove">✖</button>
                <div class="qty-controls">
                    <button class="btn-minus">-</button>
                    <button class="btn-plus">+</button>
                </div>
            `;

      const countLabel = document.createElement("div");
      countLabel.className = "queue-count";
      countLabel.innerText = item.count;

      el.appendChild(controls);
      el.appendChild(countLabel);

      controls.querySelector(".btn-plus").onclick = () =>
        this.updateItem(item.id, "inc");
      controls.querySelector(".btn-minus").onclick = () =>
        this.updateItem(item.id, "dec");
      controls.querySelector(".btn-del").onclick = () =>
        this.updateItem(item.id, "del");

      this.wrapper.appendChild(el);
    });

    // THE FIX: Save the entire queue to memory every time the UI updates
    localStorage.setItem("cuttingQueue", JSON.stringify(this.queue));

    document.dispatchEvent(
      new CustomEvent("QUEUE_UPDATED", { detail: this.queue }),
    );
  }

  generateShapeCanvas(piece) {
    const canvas = document.createElement("canvas");
    const MAX_SIZE = 125;
    canvas.width = MAX_SIZE;
    canvas.height = MAX_SIZE;
    const ctx = canvas.getContext("2d");

    const scale = (MAX_SIZE - 20) / Math.max(piece.width, piece.height);

    ctx.save();
    ctx.translate(MAX_SIZE / 2, MAX_SIZE / 2);

    // THE FIX: Match the thumbnail inversion logic
    ctx.scale(scale, -scale);
    ctx.translate(-piece.width / 2, piece.height / 2);

    ctx.strokeStyle = "#4a90e2";
    ctx.lineWidth = 2 / scale;

    ctx.beginPath();
    piece.vertices.forEach((v, i) => {
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    return canvas;
  }
}
