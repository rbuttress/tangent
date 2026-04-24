// js/ui/cursor.js
//version no. 1.0

export class CursorHUD {
  constructor() {
    this.el = document.createElement("div");
    this.el.id = "cursor-hud";
    document.body.appendChild(this.el);

    this.isVisible = false;

    // 1. Global Mouse Tracker
    document.addEventListener("mousemove", (e) => {
      if (!this.isVisible) return;

      // The CSS transform handles the "Up and Right" offset automatically
      let x = e.clientX;
      let y = e.clientY;

      // Optional: Basic boundary detection to prevent it from clipping off the top/right of the screen
      const rect = this.el.getBoundingClientRect();
      if (x + 15 + rect.width > window.innerWidth)
        x = window.innerWidth - rect.width - 15;
      if (y - 15 - rect.height < 0) y = rect.height + 15;

      this.el.style.left = x + "px";
      this.el.style.top = y + "px";
    });

    // 2. Global Event Listeners (Extensible API)
    document.addEventListener("SHOW_HUD", (e) => {
      this.el.innerHTML = e.detail.content;
      this.el.classList.add("visible");
      this.isVisible = true;
    });

    document.addEventListener("HIDE_HUD", () => {
      this.el.classList.remove("visible");
      this.isVisible = false;
    });
  }
}
