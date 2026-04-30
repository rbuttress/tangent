// js/ui/fabrics.js
//version no. 2.2

export class FabricMenu {
  // THE FIX: Added vizRef to the constructor parameters!
  constructor(containerEl, vizRef, serverUrl = "http://localhost:3000") {
    this.serverUrl = serverUrl;
    this.fabrics = [];
    this.viz = vizRef;
    this.activeFabric =
      this.viz && this.viz.loadedFabric ? this.viz.loadedFabric : null;

    // Map the floating window content area to your existing sidebarEl variable
    this.sidebarEl = containerEl;
    if (!this.sidebarEl) return;

    this.renderMenu();
    this.fetchFabrics();

    document.addEventListener("click", () => this.closeContextMenu());
    document.addEventListener("FABRIC_DATABASE_UPDATED", () =>
      this.fetchFabrics(),
    );
  }

  renderMenu() {
    this.container = document.createElement("div");
    this.container.id = "fabric-menu-container";

    this.container.innerHTML = `
            <div class="sidebar-header" style="display: flex; justify-content: space-between; align-items: center;">
                <button id="btn-add-fabric" class="glass-btn small-btn">+</button>
            </div>
            <div class="sidebar-content fabric-grid" id="fabric-list-container">
                </div>
        `;

    this.sidebarEl.appendChild(this.container);
    this.container.querySelector("#btn-add-fabric").onclick = () =>
      this.openFabricModal();
    this.headerLabel = this.container.querySelector("#materials-header-label");
  }

  async fetchFabrics() {
    const listContainer = this.container.querySelector(
      "#fabric-list-container",
    );
    try {
      const response = await fetch(`${this.serverUrl}/api/fabrics`);
      let data = await response.json();

      this.fabrics = data.reverse();
      listContainer.innerHTML = "";

      if (this.fabrics.length === 0) {
        listContainer.style.display = "block";
        listContainer.innerHTML = `<span style="color: var(--text-muted); font-size: 10px;">No fabrics created.</span>`;
        return;
      }

      listContainer.style.display = "grid";

      this.fabrics.forEach((fabric) => {
        const item = document.createElement("div");
        item.className = "fabric-thumbnail";
        if (this.activeFabric && this.activeFabric.id === fabric.id)
          item.classList.add("selected");

        const thumbCanvas = this.generateThumbnail(fabric);
        item.appendChild(thumbCanvas);

        item.onclick = () => this.selectFabric(fabric, item);
        item.oncontextmenu = (e) => this.showContextMenu(e, fabric);

        const wMM = Math.round(fabric.width);
        const hMM =
          fabric.type === "roll" ? "Roll" : Math.round(fabric.height) + "mm";

        item.onmouseenter = () => {
          const hudContent = `
            <div class="hud-title" style="color: ${fabric.color};">${fabric.name.toUpperCase()}</div>
            <div class="hud-desc">Dimensions: ${wMM} x ${hMM}</div>
            <div class="hud-desc">Type: ${fabric.type === "roll" ? "Continuous Roll" : "Sheet/Scrap"}</div>
          `;

          document.dispatchEvent(
            new CustomEvent("SHOW_HUD", { detail: { content: hudContent } }),
          );
        };
        item.onmouseleave = () => {
          document.dispatchEvent(new CustomEvent("HIDE_HUD"));
        };

        listContainer.appendChild(item);
      });
    } catch (e) {
      console.error("Fabric sync error:", e);
    }
  }

  generateThumbnail(fabric) {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");

    if (!fabric.edgeProfile || fabric.edgeProfile.length === 0) return canvas;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    fabric.edgeProfile.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const polyWidth = maxX - minX;
    let polyHeight = maxY - minY;

    if (fabric.type === "roll" && polyHeight > polyWidth) {
      polyHeight = polyWidth;
      minY = maxY - polyHeight;
    }

    const safeWidth = polyWidth > 0 ? polyWidth : 1;
    const scale = 80 / safeWidth;

    ctx.save();
    ctx.translate(50, 10);
    ctx.scale(scale, -scale);

    const centerX = minX + polyWidth / 2;
    ctx.translate(-centerX, -maxY);

    ctx.fillStyle = fabric.color;
    ctx.beginPath();
    fabric.edgeProfile.forEach((p, i) => {
      const drawY = Math.max(p.y, minY);
      if (i === 0) ctx.moveTo(p.x, drawY);
      else ctx.lineTo(p.x, drawY);
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    return canvas;
  }

  selectFabric(fabricData, elementNode) {
    const allItems = this.container.querySelectorAll(".fabric-thumbnail");
    allItems.forEach((el) => el.classList.remove("selected"));

    elementNode.classList.add("selected");
    this.activeFabric = fabricData;

    document.dispatchEvent(
      new CustomEvent("FABRIC_LOADED", {
        detail: { fabric: fabricData, isFreshTrace: false },
      }),
    );
  }

  showContextMenu(e, fabric) {
    e.preventDefault();
    this.closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.id = "fabric-context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    menu.innerHTML = `
            <div class="context-menu-item" id="ctx-edit">Edit Metadata</div>
            <div class="context-menu-item" id="ctx-sync">Update (Save Canvas State)</div>
            <div class="context-menu-item" id="ctx-dup">Duplicate</div>
            <div class="context-menu-item danger" id="ctx-del">Delete</div>
        `;

    document.body.appendChild(menu);

    menu.querySelector("#ctx-edit").onclick = () =>
      this.openFabricModal(fabric);
    menu.querySelector("#ctx-dup").onclick = () => this.duplicateFabric(fabric);
    menu.querySelector("#ctx-del").onclick = () => this.deleteFabric(fabric.id);

    const syncBtn = menu.querySelector("#ctx-sync");
    if (this.viz && this.activeFabric && this.activeFabric.id === fabric.id) {
      syncBtn.onclick = async () => {
        if (this.viz.loadedFabric) {
          const payload = {
            ...this.activeFabric,
            edgeProfile: this.viz.loadedFabric.edgeProfile,
          };
          await this.updateFabricOnServer(payload);
          this.closeContextMenu();
        }
      };
    } else {
      syncBtn.style.opacity = "0.4";
      syncBtn.style.pointerEvents = "none";
      syncBtn.title = "Fabric must be active on canvas to sync.";
    }
  }

  closeContextMenu() {
    const existing = document.getElementById("fabric-context-menu");
    if (existing) existing.remove();
  }

  async duplicateFabric(fabric) {
    const duplicate = JSON.parse(JSON.stringify(fabric));
    duplicate.id = Date.now().toString();
    duplicate.name = "Copy of " + fabric.name;

    await this.saveFabricToServer(duplicate);
  }

  async deleteFabric(id) {
    if (!confirm("Delete this fabric?")) return;
    try {
      await fetch(`${this.serverUrl}/api/fabrics/${id}`, { method: "DELETE" });
      if (this.activeFabric && this.activeFabric.id === id) {
        this.activeFabric = null;
        // Tell canvas to clear the fabric
        document.dispatchEvent(
          new CustomEvent("FABRIC_LOADED", {
            detail: { fabric: null, isFreshTrace: false },
          }),
        );
      }
      this.fetchFabrics();
    } catch (e) {
      console.error("Delete failed", e);
    }
  }

  openFabricModal(existingFabric = null) {
    const modalLayer = document.getElementById("modal-layer");
    if (!modalLayer) return;

    const isEdit = existingFabric !== null;

    const fName = isEdit ? existingFabric.name : "";
    const fColor = isEdit ? existingFabric.color : "#EA2B2B";
    const fType = isEdit ? existingFabric.type : "sheet";
    const fWidth = isEdit ? existingFabric.width : "";
    const fHeight = isEdit
      ? existingFabric.type === "roll"
        ? ""
        : existingFabric.height
      : "";

    const modalHtml = `
            <div class="glass-modal-overlay" id="fabric-overlay">
                <div class="glass-modal-content">
                    <h3>${isEdit ? "Edit Fabric" : "Create New Fabric"}</h3>

                    <button class="glass-btn primary" id="btn-trace-fabric" style="width: 100%; margin-bottom: 15px; background: rgba(43, 234, 100, 0.2); border-color: rgba(43, 234, 100, 0.4);">
                        <span style="font-size: 16px;">✜</span> ${isEdit ? "Retrace Leading Edge" : "Trace Edge via Controller"}
                    </button>
                    
                    <div class="form-group">
                        <label>Fabric Name</label>
                        <input type="text" id="fab-name" value="${fName}" placeholder="e.g. Red Denim">
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label>Color</label>
                            <input type="color" id="fab-color" value="${fColor}">
                        </div>
                        <div class="form-group">
                            <label>Type</label>
                            <select id="fab-type">
                                <option value="sheet" ${fType === "sheet" ? "selected" : ""}>Sheet / Scrap</option>
                                <option value="roll" ${fType === "roll" ? "selected" : ""}>Continuous Roll</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label>Width (mm)</label>
                            <input type="number" id="fab-width" value="${fWidth}" placeholder="1500">
                        </div>
                        <div class="form-group" id="height-group" style="${fType === "roll" ? "opacity:0.3" : ""}">
                            <label>Height (mm)</label>
                            <input type="number" id="fab-height" value="${fHeight}" placeholder="1000" ${fType === "roll" ? "disabled" : ""}>
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button class="glass-btn secondary" id="btn-cancel-fab">Cancel</button>
                        <button class="glass-btn primary" id="btn-save-fab">${isEdit ? "Update Fabric" : "Save Fabric"}</button>
                    </div>
                </div>
            </div>
        `;

    modalLayer.innerHTML = modalHtml;

    const typeSelect = document.getElementById("fab-type");
    const heightGroup = document.getElementById("height-group");
    const heightInput = document.getElementById("fab-height");

    document.getElementById("btn-trace-fabric").onclick = () => {
      const pendingFabricData = {
        id: isEdit ? existingFabric.id : Date.now().toString(),
        name: document.getElementById("fab-name").value || "Traced Fabric",
        color: document.getElementById("fab-color").value,
        type: typeSelect.value,
        width: parseFloat(document.getElementById("fab-width").value) || 0,
        height:
          typeSelect.value === "roll"
            ? 10000
            : parseFloat(heightInput.value) || 0,
      };

      modalLayer.innerHTML = "";
      document.dispatchEvent(
        new CustomEvent("START_FABRIC_TRACE", { detail: pendingFabricData }),
      );
    };

    typeSelect.onchange = (e) => {
      if (e.target.value === "roll") {
        heightGroup.style.opacity = "0.3";
        heightInput.disabled = true;
        heightInput.value = "";
      } else {
        heightGroup.style.opacity = "1";
        heightInput.disabled = false;
      }
    };

    document.getElementById("btn-cancel-fab").onclick = () =>
      (modalLayer.innerHTML = "");

    document.getElementById("btn-save-fab").onclick = async () => {
      const fWidth =
        parseFloat(document.getElementById("fab-width").value) || 0;
      const fHeight =
        typeSelect.value === "roll"
          ? 10000
          : parseFloat(heightInput.value) || 0;

      let finalProfile = [];

      if (
        isEdit &&
        existingFabric.edgeProfile &&
        existingFabric.edgeProfile.length > 0
      ) {
        // 1. Find the exact mathematical boundaries of the old profile
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        existingFabric.edgeProfile.forEach((p) => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });

        const oldWidth = maxX - minX;
        const oldHeight = maxY - minY;

        // 2. Proportionally scale every point to the new dimensions
        finalProfile = existingFabric.edgeProfile.map((p) => {
          let newX = p.x;
          let newY = p.y;

          // Scale X (Width)
          if (oldWidth > 0) {
            newX = minX + ((p.x - minX) / oldWidth) * fWidth;
          }

          // Scale Y (Height)
          if (oldHeight > 0) {
            // Because Y goes down in our canvas, we scale down from the top (maxY)
            newY = maxY - ((maxY - p.y) / oldHeight) * fHeight;
          }

          return { x: newX, y: newY };
        });
      } else {
        // Generate a fresh zero-normalized rectangle if no profile existed
        finalProfile = [
          { x: 0, y: 0 },
          { x: fWidth, y: 0 },
          { x: fWidth, y: -fHeight },
          { x: 0, y: -fHeight },
        ];
      }

      const payload = {
        id: isEdit ? existingFabric.id : Date.now().toString(),
        name: document.getElementById("fab-name").value || "Unnamed Fabric",
        color: document.getElementById("fab-color").value,
        type: typeSelect.value,
        width: fWidth,
        height: fHeight,
        edgeProfile: finalProfile,
      };

      if (isEdit) {
        await this.updateFabricOnServer(payload);
      } else {
        await this.saveFabricToServer(payload);
      }
      modalLayer.innerHTML = "";
    };
  }

  async saveFabricToServer(fabricData) {
    try {
      const response = await fetch(`${this.serverUrl}/api/fabrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fabricData),
      });
      if (response.ok) this.fetchFabrics();
    } catch (e) {
      console.error("POST failed:", e);
    }
  }

  async updateFabricOnServer(fabricData) {
    try {
      const response = await fetch(
        `${this.serverUrl}/api/fabrics/${fabricData.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fabricData),
        },
      );
      if (response.ok) {
        if (this.activeFabric && this.activeFabric.id === fabricData.id) {
          this.activeFabric = fabricData;
        }
        this.fetchFabrics();
      }
    } catch (e) {
      console.error("PUT failed:", e);
    }
  }
}
