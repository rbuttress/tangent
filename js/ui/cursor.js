// js/ui/cursor.js
//version no. 2.1

export class CursorHUD {
  constructor() {
    this.el = document.createElement("div");
    this.el.id = "cursor-hud";
    document.body.appendChild(this.el);

    this.uiHoverContent = null;
    this.lastCanvasCoords = { x: 0, y: 0 };

    // 1. Global Mouse Tracker & State Machine
    document.addEventListener("mousemove", (e) => {
      const isCanvas =
        e.target.id === "bgCanvas" || e.target.closest("#bgCanvas");

      // --- THE FIX: Strict Visibility Priority ---
      if (this.uiHoverContent) {
        // Priority 1: UI Elements (Thumbnails, Context Menus)
        this.el.className = "visible";
        this.el.innerHTML = this.uiHoverContent;
      } else if (isCanvas) {
        // Priority 2: Canvas Coordinates
        this.el.className = "visible canvas-mode";
        this.el.innerHTML = `(${this.lastCanvasCoords.x.toFixed(2)}, ${this.lastCanvasCoords.y.toFixed(2)})`;
      } else {
        // Priority 3: Hidden
        this.el.className = "";
      }

      // Position tracking
      let x = e.clientX;
      let y = e.clientY;
      const rect = this.el.getBoundingClientRect();
      if (x + 15 + rect.width > window.innerWidth)
        x = window.innerWidth - rect.width - 15;
      if (y - 15 - rect.height < 0) y = rect.height + 15;

      this.el.style.left = x + 15 + "px";
      this.el.style.top = y + 15 + "px";
    });

    // 2. Continually store the raw canvas coordinates
    document.addEventListener("CANVAS_COORDS", (e) => {
      this.lastCanvasCoords = e.detail;
      // Instantly update the text if we are currently in canvas mode
      if (!this.uiHoverContent && this.el.classList.contains("canvas-mode")) {
        this.el.innerHTML = `(${this.lastCanvasCoords.x.toFixed(2)}, ${this.lastCanvasCoords.y.toFixed(2)})`;
      }
    });

    // 3. UI Overrides (Popups, Fabric Details)
    document.addEventListener("SHOW_HUD", (e) => {
      this.uiHoverContent = e.detail.content;
      this.el.className = "visible";
      this.el.innerHTML = this.uiHoverContent;
    });

    document.addEventListener("HIDE_HUD", () => {
      this.uiHoverContent = null;
      this.el.className = "";
    });
  }
}
