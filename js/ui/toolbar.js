// js/ui/toolbar.js
//version no. 1.5

export class Toolbar {
  constructor(visualizer) {
    this.visualizer = visualizer;
    this.el = document.createElement("div");
    this.el.className = "tool-dock";
    document.body.appendChild(this.el);

    // Global smoothing variable for the freehand tools
    window.ToolSmoothing = 5;

    this.tools = [
      {
        id: "UNDO",
        icon: `<svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C20.48 10.9 16.89 8 12.5 8z"/></svg>`,
        title: "Undo (Ctrl+Z)",
        isAction: true,
      },
      {
        id: "REDO",
        icon: `<svg viewBox="0 0 24 24"><path d="M11.5 8C7.11 8 3.52 10.9 2.03 14.72l2.37.78c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L15 16h9V7l-3.6 3.6c-1.84-1.61-4.24-2.6-6.9-2.6z"/></svg>`,
        title: "Redo (Ctrl+Y)",
        isAction: true,
      },
      {
        id: "SELECT",
        icon: `<svg viewBox="0 0 24 24"><path d="M7 2l12 11.2-5.8.5 3.3 7.3-2.2.9-3.2-7.4-4.4 4.7z"/></svg>`,
        title: "Select & Move Tool (V)",
      },
      {
        id: "DRAW_POLY",
        icon: `<svg viewBox="0 0 24 24"><path d="M12 2l3 6.5 7 1-5 5 1.5 7-6.5-3.5-6.5 3.5 1.5-7-5-5 7-1z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
        title: "Draw Polyline Shape (D)",
      },
      {
        id: "BOX",
        icon: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
        title: "Draw Box Shape",
      },
      {
        id: "BOX_MASK",
        icon: `<svg viewBox="0 0 24 24"><path d="M3 3h18v18H3V3zm6 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill-rule="evenodd" fill="currentColor"/></svg>`,
        title: "Box Nesting Mask",
      },
      {
        id: "FREE_MASK",
        icon: `<svg viewBox="0 0 24 24"><path d="M12 2c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm-2 5c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm4 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM4 22v-2c0-3.31 2.69-6 6-6h4c3.31 0 6 2.69 6 6v2H4z" fill="currentColor"/></svg>`,
        title: "Freehand Nesting Mask",
      },
      {
        id: "POLY_MASK",
        icon: `<svg viewBox="0 0 24 24" fill-rule="evenodd" clip-rule="evenodd"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2zM9 10.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zm6 0c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5z" fill="currentColor"/></svg>`,
        title: "Polyline Nesting Mask",
      },
      {
        id: "CUT_FABRIC",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.12 15.88 c 3 -3, 6 -1, 9 -4 s 3 -5, 3 -7"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`,
        title: "Freehand Cut Fabric",
      },
      {
        id: "POLY_CUT",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`,
        title: "Polyline Cut Fabric",
      },
    ];

    this.render();
    this.createSmoothingSlider();

    document.addEventListener("TOOL_CHANGED", (e) =>
      this.updateActive(e.detail),
    );
  }

  createSmoothingSlider() {
    this.sliderContainer = document.createElement("div");
    this.sliderContainer.className = "tool-slider-container";
    this.sliderContainer.style.cssText = `
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-panel);
      padding: 10px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      display: none;
      flex-direction: column;
      align-items: center;
      margin-bottom: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      width: 120px;
    `;

    const label = document.createElement("label");
    label.innerText = `Smoothing: ${window.ToolSmoothing}`;
    label.style.fontSize = "10px";
    label.style.marginBottom = "5px";
    label.style.color = "var(--text-main)";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "20";
    slider.value = window.ToolSmoothing;
    slider.style.width = "100%";

    slider.oninput = (e) => {
      window.ToolSmoothing = parseInt(e.target.value);
      label.innerText = `Smoothing: ${window.ToolSmoothing}`;
    };

    this.sliderContainer.appendChild(label);
    this.sliderContainer.appendChild(slider);
    this.el.appendChild(this.sliderContainer);
  }

  render() {
    this.el.innerHTML = "";
    this.tools.forEach((tool) => {
      const btn = document.createElement("button");
      btn.className = "tool-btn";
      if (tool.id === "SELECT") btn.classList.add("active");

      btn.innerHTML = tool.icon;
      btn.title = tool.title;

      btn.onclick = () => {
        if (tool.isAction) {
          if (tool.id === "UNDO") this.visualizer.undo();
          if (tool.id === "REDO") this.visualizer.redo();
        } else {
          this.visualizer.setTool(tool.id);
          document.dispatchEvent(
            new CustomEvent("TOOL_CHANGED", { detail: tool.id }),
          );
        }
      };

      this.el.appendChild(btn);
    });

    if (this.sliderContainer) {
      this.el.appendChild(this.sliderContainer);
    }
  }

  updateActive(toolId) {
    this.el.querySelectorAll(".tool-btn").forEach((btn, index) => {
      if (!this.tools[index].isAction) {
        btn.classList.toggle("active", this.tools[index].id === toolId);
      }
    });

    if (toolId === "FREE_MASK" || toolId === "CUT_FABRIC") {
      this.sliderContainer.style.display = "flex";
    } else {
      this.sliderContainer.style.display = "none";
    }
  }
}
