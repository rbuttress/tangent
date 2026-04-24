// js/ui/window.js
//version no. 2.2

export class WidgetWindow {
  static instances = [];

  constructor(
    id,
    title,
    defaultX,
    defaultY,
    width = 350,
    preferredHeight = 400,
  ) {
    this.id = id;
    this.preferredHeight = preferredHeight;
    this.snappedEdge = null;

    this.flexGrow = false;
    this.autoFit = false;

    const savedState = JSON.parse(localStorage.getItem("win_" + id)) || {};
    const startX = savedState.x !== undefined ? savedState.x : defaultX;
    const startY = savedState.y !== undefined ? savedState.y : defaultY;
    const startWidth = savedState.w !== undefined ? savedState.w : width;
    this.isMinimized = savedState.min || false;

    this.el = document.createElement("div");
    this.el.id = id;
    this.el.className = `window ${this.isMinimized ? "minimized" : ""}`;
    this.el.style.left = startX + "px";
    this.el.style.top = startY + "px";
    this.el.style.width = startWidth + "px";
    this.el.style.height = this.isMinimized
      ? "40px"
      : this.preferredHeight + "px";

    this.el.innerHTML = `
            <div class="resizer-l"></div>
            <div class="window-header">
                <div class="window-title-area">
                    <span class="window-title">${title.toUpperCase()}</span>
                    <span class="status-text" style="font-size:10px; margin-left:8px;"></span>
                </div>
                <div class="window-controls"><button class="min-btn" title="Minimize">_</button></div>
            </div>
            <div class="window-content"></div>
            <div class="resizer-r"></div>
        `;

    document.getElementById("ui-layer").appendChild(this.el);
    this.content = this.el.querySelector(".window-content");
    this.statusEl = this.el.querySelector(".status-text");

    WidgetWindow.instances.push(this);
    this.initEvents();
    setTimeout(() => {
      this.checkSnapOnLoad(startX);
    }, 50);

    const observer = new MutationObserver(() => {
      if (this.autoFit && this.snappedEdge && !this.isMinimized) {
        WidgetWindow.organizeEdge(this.snappedEdge);
      }
    });
    observer.observe(this.content, { childList: true, subtree: true });
  }

  saveState() {
    localStorage.setItem(
      "win_" + this.id,
      JSON.stringify({
        x: this.el.offsetLeft,
        y: this.el.offsetTop,
        w: this.el.offsetWidth,
        min: this.isMinimized,
      }),
    );
  }

  checkSnapOnLoad(x) {
    const snapZone = 30;
    if (x <= snapZone) this.snappedEdge = "left";
    else if (window.innerWidth - (x + this.el.offsetWidth) <= snapZone)
      this.snappedEdge = "right";
    if (this.snappedEdge) WidgetWindow.organizeEdge(this.snappedEdge);
  }

  setStatus(text, isOnline = false) {
    this.statusEl.innerText = text;
    this.statusEl.style.color = isOnline ? "#2BEA64" : "var(--text-muted)";
  }

  setMinimized(state) {
    if (this.isMinimized === state) return;
    this.isMinimized = state;
    this.el.classList.toggle("minimized", this.isMinimized);
    if (!this.isMinimized && !this.snappedEdge)
      this.el.style.height = this.preferredHeight + "px";
    this.saveState();
    if (this.snappedEdge) WidgetWindow.organizeEdge(this.snappedEdge);
  }

  replaceMinWithEStop(callback) {
    const minBtn = this.el.querySelector(".min-btn");
    if (minBtn) {
      minBtn.innerHTML = "🛑";
      minBtn.className = "estop-btn";
      minBtn.style.opacity = "1";
      minBtn.title = "FEED HOLD";
      minBtn.onclick = (e) => {
        e.stopPropagation();
        callback();
      };
    }
  }

  initEvents() {
    const header = this.el.querySelector(".window-header");
    const minBtn = this.el.querySelector(".min-btn");
    const resizerL = this.el.querySelector(".resizer-l");
    const resizerR = this.el.querySelector(".resizer-r");
    const snapZone = 30;

    if (minBtn) minBtn.onclick = () => this.setMinimized(!this.isMinimized);

    // --- THE FIX: Resize Logic ---
    const startResize = (e, isLeft) => {
      e.preventDefault(); // Prevents text selection while dragging
      e.stopPropagation();

      let startX = e.clientX;
      let startWidth = this.el.offsetWidth;
      let startLeft = this.el.offsetLeft;

      // Lock global pointer events so the iframe/canvas doesn't steal the mouse
      document.body.style.pointerEvents = "none";
      this.el.style.pointerEvents = "auto";

      const onMouseMove = (moveEvent) => {
        let newWidth;
        if (isLeft) {
          const diff = startX - moveEvent.clientX;
          newWidth = startWidth + diff;
          if (newWidth > 200) {
            // Enforce minimum width
            this.el.style.width = newWidth + "px";
            this.el.style.left = startLeft - diff + "px";
          }
        } else {
          const diff = moveEvent.clientX - startX;
          newWidth = startWidth + diff;
          if (newWidth > 200) {
            this.el.style.width = newWidth + "px";
          }
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.pointerEvents = "";

        this.saveState();

        // Re-organize stack in case the width change wrapped text and altered the height of an autoFit window
        if (this.snappedEdge) {
          WidgetWindow.organizeEdge(this.snappedEdge);
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    resizerL.onmousedown = (e) => startResize(e, true);
    resizerR.onmousedown = (e) => startResize(e, false);

    // --- Window Dragging Logic ---
    header.onmousedown = (e) => {
      if (["BUTTON", "INPUT", "SELECT"].includes(e.target.tagName)) return;

      WidgetWindow.instances.forEach((w) => (w.el.style.zIndex = "100"));
      this.el.style.zIndex = "101";
      this.el.classList.add("dragging");

      let startX = e.clientX - this.el.offsetLeft;
      let startY = e.clientY - this.el.offsetTop;
      const oldEdge = this.snappedEdge;
      this.snappedEdge = null;

      if (oldEdge) WidgetWindow.organizeEdge(oldEdge);

      const onMove = (moveEvent) => {
        let newX = moveEvent.clientX - startX;
        let newY = moveEvent.clientY - startY;

        if (newX <= snapZone) newX = 10;
        else if (window.innerWidth - (newX + this.el.offsetWidth) <= snapZone)
          newX = window.innerWidth - this.el.offsetWidth - 10;

        this.el.style.left = newX + "px";
        this.el.style.top = Math.max(10, newY) + "px";
      };

      const onUp = () => {
        this.el.classList.remove("dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        const currentX = this.el.offsetLeft;
        if (currentX <= snapZone) this.snappedEdge = "left";
        else if (
          window.innerWidth - (currentX + this.el.offsetWidth) <=
          snapZone
        )
          this.snappedEdge = "right";

        if (this.snappedEdge) {
          WidgetWindow.organizeEdge(this.snappedEdge);
        } else if (!this.isMinimized) {
          this.el.style.height = this.preferredHeight + "px";
        }

        this.saveState();
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
  }

  // --- UPGRADED GLOBAL STACKING ENGINE ---
  static organizeEdge(edge) {
    const margin = 10;
    let edgeWindows = WidgetWindow.instances.filter(
      (w) => w.snappedEdge === edge,
    );
    edgeWindows.sort((a, b) => a.el.offsetTop - b.el.offsetTop);

    const minWindows = edgeWindows.filter((w) => w.isMinimized);
    const openWindows = edgeWindows.filter((w) => !w.isMinimized);

    const totalMinHeight = minWindows.length * 40;
    const totalMargins = margin * (edgeWindows.length + 1);
    let availableHeight = window.innerHeight - totalMinHeight - totalMargins;

    // Phase 1: Pre-calculate Auto-Fit windows based on real DOM content
    openWindows.forEach((w) => {
      if (w.autoFit) {
        // THE FIX: Temporarily strip CSS height and transitions to force a DOM shrink-wrap
        const oldHeight = w.el.style.height;
        const oldTransition = w.el.style.transition;

        w.el.style.transition = "none";
        w.el.style.height = "auto";

        // Read the pure, perfectly hugged height of the elements
        const requiredHeight = w.el.offsetHeight;

        // Restore the CSS instantly
        w.el.style.height = oldHeight;
        void w.el.offsetHeight; // Force reflow so the transition doesn't glitch
        w.el.style.transition = oldTransition;

        // Cap it so it doesn't grow taller than 60% of the screen
        w.preferredHeight = Math.min(requiredHeight, window.innerHeight * 0.6);
      }
    });

    const fixedWindows = openWindows.filter((w) => !w.flexGrow);
    const flexWindows = openWindows.filter((w) => w.flexGrow);

    let totalFixed = fixedWindows.reduce(
      (sum, w) => sum + w.preferredHeight,
      0,
    );

    let fixedScale = 1;
    if (totalFixed > availableHeight && flexWindows.length === 0) {
      fixedScale = availableHeight / totalFixed;
    }

    let flexHeight = 0;
    if (flexWindows.length > 0) {
      flexHeight = Math.max(
        150,
        (availableHeight - totalFixed) / flexWindows.length,
      );
    }

    let currentY = margin;
    edgeWindows.forEach((w) => {
      w.el.style.left =
        edge === "left"
          ? margin + "px"
          : window.innerWidth - w.el.offsetWidth - margin + "px";
      w.el.style.top = currentY + "px";

      if (w.isMinimized) {
        currentY += 40 + margin;
      } else {
        let assignedHeight = w.flexGrow
          ? flexHeight
          : w.preferredHeight * fixedScale;
        if (assignedHeight > availableHeight) assignedHeight = availableHeight;
        w.el.style.height = assignedHeight + "px";
        currentY += assignedHeight + margin;
        availableHeight -= assignedHeight;
      }
    });
  }
}

window.addEventListener("resize", () => {
  WidgetWindow.organizeEdge("left");
  WidgetWindow.organizeEdge("right");
});
