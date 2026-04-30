//js/ui/dro.js
//version no. 1.3
import { machine } from "../core/machine.js";

export class DRO {
  constructor(win, spjs) {
    this.win = win;
    this.spjs = spjs;

    this.editingAxis = null;
    this.editString = "";

    this.render();
    this.attachEvents();

    this.win.replaceMinWithEStop(() => this.triggerFeedHold());

    machine.onUpdate(() => this.updateUI());
  }

  triggerFeedHold() {
    const port = localStorage.getItem("last-port");
    if (!port) return;

    this.spjs.send(`send ${port} !\n`);

    const btn = this.win.el.querySelector(".estop-btn");
    btn.classList.add("active");

    this.showHoldMenu(btn);
  }

  showHoldMenu(anchorEl) {
    const existing = document.querySelector(".hold-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.className = "hold-menu";

    const rect = anchorEl.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.left = `${rect.left - 75}px`;

    menu.innerHTML = `
            <button id="hold-resume">RESUME</button>
            <button id="hold-clear">CLEAR</button>
        `;
    document.body.appendChild(menu);

    document.getElementById("hold-resume").onclick = () => {
      const port = localStorage.getItem("last-port");
      this.spjs.send(`send ${port} ~\n`);
      this.cleanupHold(menu);
    };

    document.getElementById("hold-clear").onclick = () => {
      const port = localStorage.getItem("last-port");
      this.spjs.send(`send ${port} %\n`);
      this.cleanupHold(menu);
      console.log("Job Cleared. Coordinates preserved.");
    };
  }

  cleanupHold(menu) {
    menu.remove();
    const btn = this.win.el.querySelector(".estop-btn");
    if (btn) btn.classList.remove("active");
  }

  render() {
    const arrows = { x: "←0", y: "↑0", z: "↘0", a: "↺0" };

    this.win.content.innerHTML = `
            <div class="dro-column-wrap">
                <div class="jog-pad">
                    <button class="jog-btn" data-axis="z" data-dir="1">Z+</button>
                    <button class="jog-btn" data-axis="y" data-dir="1">Y+</button>
                    <button class="jog-btn" data-axis="a" data-dir="1">A+</button>
                    
                    <button class="jog-btn" data-axis="x" data-dir="-1">X-</button>
                    <button class="jog-btn home-all" id="btn-home-all" style="font-size:10px">HOME</button>
                    <button class="jog-btn" data-axis="x" data-dir="1">X+</button>
                    
                    <button class="jog-btn" data-axis="a" data-dir="-1">A-</button>
                    <button class="jog-btn" data-axis="y" data-dir="-1">Y-</button>
                    <button class="jog-btn" data-axis="z" data-dir="-1">Z-</button>
                </div>

                <div class="jog-slider-wrap">
                    <div class="jog-label-row">
                        <span id="jog-dist-readout">1.00</span><span style="font-size:9px">mm</span>
                    </div>
                    <input type="range" id="jog-slider" min="0" max="100" value="50">
                </div>

                ${["x", "y", "z", "a"]
                  .map(
                    (ax) => `
                    <div class="dro-row">
                        <div class="axis-control-group" style="width:30px">
                            <div class="axis-main-label" style="font-size:18px">${ax.toUpperCase()}</div>
                            
                            <div class="axis-hover-btns" style="left:auto; right:0; display:flex; gap:2px; align-items:center;">
                                <button class="axis-go-zero-trigger" data-axis="${ax}" style="width: 22px; padding: 0;" title="Go To Zero">${arrows[ax]}</button>
                                <button class="axis-zero-trigger" data-axis="${ax}" style="width: 22px; padding: 0;" title="Set to Zero">∅</button>
                                <button class="axis-home-trigger" data-axis="${ax}" style="display:none; width: 22px; padding: 0;" id="btn-home-${ax}" title="Home Axis">♜</button>
                            </div>
                        </div>
                        <div class="dro-readout">
                            <span id="dro-val-${ax}" class="dro-val-edit" data-axis="${ax}" style="cursor:text;" title="Click to manually edit position">0.0000</span>
                        </div>
                    </div>
                `,
                  )
                  .join("")}
            </div>
        `;

    const headerArea = this.win.el.querySelector(".window-title-area");
    if (!headerArea.querySelector("#header-machine-state")) {
      const stateIndicator = document.createElement("span");
      stateIndicator.id = "header-machine-state";
      stateIndicator.className = "header-stat";
      stateIndicator.innerText = "OFFLINE";
      headerArea.appendChild(stateIndicator);
    }
  }

  attachEvents() {
    const c = this.win.content;
    this.slider = c.querySelector("#jog-slider");
    this.readout = c.querySelector("#jog-dist-readout");

    this.slider.oninput = () => {
      const dist = this.getLogDistance(this.slider.value);
      this.readout.innerText = dist.toFixed(dist < 1 ? 2 : 1);
    };

    c.querySelectorAll(".jog-btn[data-axis]").forEach((btn) => {
      btn.onmousedown = (e) =>
        this.handleJog(btn.dataset.axis, parseInt(btn.dataset.dir), e);
    });

    c.querySelector("#btn-home-all").onclick = () => this.homeAll();

    c.querySelectorAll(".axis-go-zero-trigger").forEach((btn) => {
      btn.onclick = () => this.goZeroAxis(btn.dataset.axis);
    });

    c.querySelectorAll(".axis-zero-trigger").forEach((btn) => {
      btn.onclick = () => this.zeroAxis(btn.dataset.axis);
    });

    c.querySelectorAll(".axis-home-trigger").forEach((btn) => {
      btn.onclick = () => this.homeAxis(btn.dataset.axis);
    });

    // --- THE FIX: Inline Editing Triggers ---
    c.querySelectorAll(".dro-val-edit").forEach((span) => {
      span.onclick = (e) => {
        e.stopPropagation(); // Prevent the global document click from immediately canceling
        this.startEditing(span.dataset.axis);
      };
    });

    // Cancel edit if user clicks anywhere else on the screen
    document.addEventListener("click", () => {
      if (this.editingAxis) this.cancelEditing();
    });

    // Capture phase listener: stops 'main.js' from triggering tools when typing numbers
    document.addEventListener(
      "keydown",
      (e) => {
        if (!this.editingAxis) return;

        e.stopPropagation(); // Prevent canvas hotkeys (like 'v', 'd')

        if (e.key === "Backspace" || e.key === "Enter" || e.key === "Escape") {
          e.preventDefault(); // Stop browser scrolling/navigating
        }

        if (e.key === "Escape") {
          this.cancelEditing();
        } else if (e.key === "Enter") {
          this.commitEditing();
        } else if (e.key === "Backspace") {
          this.editString = this.editString.slice(0, -1);
          this.updateEditDisplay();
        } else if (/^[0-9.-]$/.test(e.key)) {
          if (e.key === "." && this.editString.includes(".")) return;
          if (e.key === "-" && this.editString.length > 0) return; // Only allow '-' at the very start

          // CRITICAL Z-AXIS SAFETY: Force a negative sign if they type a positive number into Z
          if (this.editingAxis === "z") {
            if (e.key !== "-" && this.editString === "") {
              this.editString = "-";
            }
          }

          this.editString += e.key;
          this.updateEditDisplay();
        }
      },
      { capture: true },
    );
  }

  // --- INLINE DRO EDITING ---

  startEditing(axis) {
    if (this.editingAxis) this.cancelEditing(); // Clean up old edit if switching directly

    this.editingAxis = axis;
    this.editString = "";
    const span = this.win.content.querySelector(`#dro-val-${axis}`);
    span.style.color = "#ff3c3c";
    this.updateEditDisplay();
  }

  cancelEditing() {
    if (!this.editingAxis) return;
    const span = this.win.content.querySelector(`#dro-val-${this.editingAxis}`);
    if (span) span.style.color = "";
    this.editingAxis = null;
    this.updateUI(); // Snap back to true machine coordinates immediately
  }

  commitEditing() {
    if (!this.editingAxis) return;
    const port = localStorage.getItem("last-port");

    let val = parseFloat(this.editString);
    if (port && !isNaN(val)) {
      // Ultimate Z-Axis safety check before dispatch
      if (this.editingAxis === "z") {
        val = -Math.abs(val);
      }
      this.spjs.send(
        `send ${port} G90 G0 ${this.editingAxis.toUpperCase()}${val.toFixed(4)}\n`,
      );
      console.log(
        `UI JOG: Rapid ${this.editingAxis.toUpperCase()} to ${val.toFixed(4)}`,
      );
    }
    this.cancelEditing();
  }

  updateEditDisplay() {
    if (!this.editingAxis) return;
    const span = this.win.content.querySelector(`#dro-val-${this.editingAxis}`);

    // Handle the visual mask for typing
    if (this.editString === "") {
      span.innerText = "0.0000";
      return;
    }
    if (this.editString === "-") {
      span.innerText = "-0.0000";
      return;
    }

    let val = parseFloat(this.editString);
    if (!isNaN(val)) {
      if (this.editingAxis === "z") val = -Math.abs(val);
      span.innerText = val.toFixed(4); // Automatically pads out to standard DRO look
    }
  }

  // -------------------------

  getLogDistance(val) {
    const minVal = Math.log(0.01);
    const maxVal = Math.log(100);
    const scale = (maxVal - minVal) / 100;
    return Math.exp(minVal + scale * val);
  }

  handleJog(axis, dir, event) {
    if (!this.spjs) return;

    let step = this.getLogDistance(this.slider.value);
    if (event.shiftKey) step *= 10;
    if (event.ctrlKey || event.metaKey) step *= 100;

    const port = localStorage.getItem("last-port");
    if (port) {
      const moveAmt = (dir * step).toFixed(4);
      const cmd = `G91 G0 ${axis.toUpperCase()}${moveAmt}\nG90`;
      this.spjs.send(`send ${port} ${cmd}\n`);
      console.log(`UI JOG: ${axis.toUpperCase()} ${moveAmt}mm (Relative)`);
    }
  }

  goZeroAxis(axis) {
    const port = localStorage.getItem("last-port");
    if (port) {
      this.spjs.send(`send ${port} G90 G0 ${axis.toUpperCase()}0\n`);
      console.log(`UI JOG: Rapid ${axis.toUpperCase()} to 0`);
    }
  }

  zeroAxis(axis) {
    const port = localStorage.getItem("last-port");
    if (port) this.spjs.send(`send ${port} G28.3 ${axis.toUpperCase()}0\n`);
  }

  homeAxis(axis) {
    const port = localStorage.getItem("last-port");
    if (!port) return;

    this.spjs.send(`send ${port} G28.2 ${axis.toUpperCase()}0\n`);

    setTimeout(() => {
      this.spjs.send(`send ${port} {"sr":""}\n`);
    }, 1000);
  }

  homeAll() {
    const port = localStorage.getItem("last-port");
    if (!port) return;

    const axes = ["z", "a", "x"];
    let cmd = "";
    axes.forEach((ax) => {
      const conf = machine.config.axes[ax];
      if (conf && (conf.sn > 0 || conf.sx > 0)) {
        cmd += `G28.2 ${ax.toUpperCase()}0 `;
      }
    });

    if (cmd) {
      this.spjs.send(`send ${port} ${cmd.trim()}\n`);
    }

    setTimeout(() => {
      this.spjs.send(`send ${port} G28.3 Y0\n`);
    }, 100);

    [2000, 5000, 10000].forEach((delay) => {
      setTimeout(() => this.spjs.send(`send ${port} {"sr":""}\n`), delay);
    });
  }

  updateUI() {
    ["x", "y", "z", "a"].forEach((ax) => {
      const valEl = this.win.content.querySelector(`#dro-val-${ax}`);

      // THE FIX: Do not overwrite the value if the user is actively typing in it
      if (valEl && this.editingAxis !== ax) {
        valEl.innerText = machine.currentPos[ax].toFixed(4);
      }

      const homeBtn = this.win.content.querySelector(`#btn-home-${ax}`);
      const conf = machine.config.axes[ax];
      if (homeBtn && conf) {
        homeBtn.style.display = conf.sn > 0 || conf.sx > 0 ? "block" : "none";
      }
    });

    const stateEl = document.getElementById("header-machine-state");
    const STATE_MAP = {
      0: "INIT",
      1: "READY",
      2: "ALARM",
      3: "STOPPED",
      4: "END",
      5: "RUNNING",
      6: "HOLD",
      9: "HOMING",
    };
    if (stateEl) {
      stateEl.innerText = STATE_MAP[machine.status] || "OFFLINE";
      stateEl.style.color = machine.status === 5 ? "#4ec9b0" : "#f44747";
    }

    const dx = machine.targetPos.x - machine.currentPos.x;
    const dy = machine.targetPos.y - machine.currentPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const distEl = document.getElementById("target-delta");
    if (distEl) {
      distEl.innerText = `Δ: ${dist.toFixed(2)}mm`;
      distEl.style.color = dist > 1 ? "#900" : "#2e7d32";
    }
  }
}
