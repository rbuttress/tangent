//js/ui/dro.js
//version no. 1.1
import { machine } from "../core/machine.js";

export class DRO {
  constructor(win, spjs) {
    this.win = win;
    this.spjs = spjs;
    this.render();
    this.attachEvents();

    // Replace minimize with E-Stop
    this.win.replaceMinWithEStop(() => this.triggerFeedHold());

    machine.onUpdate(() => this.updateUI());
  }

  triggerFeedHold() {
    const port = localStorage.getItem("last-port");
    if (!port) return;

    // 1. Send immediate Feedhold to TinyG
    // ! is a real-time character, it does not need \n
    this.spjs.send(`send ${port} !\n`);

    const btn = this.win.el.querySelector(".estop-btn");
    btn.classList.add("active");

    // 2. Show the context menu
    this.showHoldMenu(btn);
  }

  showHoldMenu(anchorEl) {
    // Remove existing if any
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
      // ~ is Cycle Start (Resume)
      this.spjs.send(`send ${port} ~\n`);
      this.cleanupHold(menu);
    };

    document.getElementById("hold-clear").onclick = () => {
      const port = localStorage.getItem("last-port");
      // % is Hard Reset / Clear Buffer
      // Also send a feedhold to be safe
      this.spjs.send(`send ${port} %\n`);

      // Clear our local application buffer if you have one
      // machine.jobQueue = [];

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
                            <div class="axis-hover-btns" style="left:0; right:auto;">
                                <button class="axis-home-trigger" data-axis="${ax}" style="display:none" id="btn-home-${ax}">H</button>
                                <button class="axis-zero-trigger" data-axis="${ax}">0</button>
                            </div>
                        </div>
                        <div class="dro-readout">
                            <span id="dro-val-${ax}">0.0000</span>
                        </div>
                    </div>
                `,
                  )
                  .join("")}
            </div>
        `;

    // Move state indicator to header (matching v3.2)
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

    // Logarithmic Slider Update
    this.slider.oninput = () => {
      const dist = this.getLogDistance(this.slider.value);
      this.readout.innerText = dist.toFixed(dist < 1 ? 2 : 1);
    };

    // Jog Buttons
    c.querySelectorAll(".jog-btn[data-axis]").forEach((btn) => {
      btn.onmousedown = (e) =>
        this.handleJog(btn.dataset.axis, parseInt(btn.dataset.dir), e);
    });

    // Homing & Zeroing
    c.querySelector("#btn-home-all").onclick = () => this.homeAll();
    c.querySelectorAll(".axis-zero-trigger").forEach((btn) => {
      btn.onclick = () => this.zeroAxis(btn.dataset.axis);
    });
    c.querySelectorAll(".axis-home-trigger").forEach((btn) => {
      btn.onclick = () => this.homeAxis(btn.dataset.axis);
    });
  }

  getLogDistance(val) {
    const minVal = Math.log(0.01);
    const maxVal = Math.log(100);
    const scale = (maxVal - minVal) / 100;
    return Math.exp(minVal + scale * val);
  }

  handleJog(axis, dir, event) {
    if (!this.spjs) return;

    // 1. Get step size from local slider
    let step = this.getLogDistance(this.slider.value);
    if (event.shiftKey) step *= 10;
    if (event.ctrlKey || event.metaKey) step *= 100;

    const port = localStorage.getItem("last-port");
    if (port) {
      // Calculate the signed movement amount
      const moveAmt = (dir * step).toFixed(4);

      // CRITICAL FIX:
      // 1. G91 puts the machine in Relative mode.
      // 2. G0 executes the rapid move by the moveAmt.
      // 3. G90 immediately puts the machine back in Absolute mode for safety.
      const cmd = `G91 G0 ${axis.toUpperCase()}${moveAmt}\nG90`;

      this.spjs.send(`send ${port} ${cmd}\n`);

      console.log(`UI JOG: ${axis.toUpperCase()} ${moveAmt}mm (Relative)`);
    }
  }

  zeroAxis(axis) {
    const port = localStorage.getItem("last-port");
    if (port) this.spjs.send(`send ${port} G28.3 ${axis}0\n`);
  }

  homeAxis(axis) {
    const port = localStorage.getItem("last-port");
    if (!port) return;

    // Send home command
    this.spjs.send(`send ${port} G28.2 ${axis.toUpperCase()}0\n`);

    // Force a status report request after a short delay to ensure
    // the UI syncs with the new zero position
    setTimeout(() => {
      this.spjs.send(`send ${port} {"sr":""}\n`);
    }, 1000);
  }

  homeAll() {
    const port = localStorage.getItem("last-port");
    if (!port) return;

    // Ordered sequence: Z -> A -> X (Y is intentionally excluded to be zeroed instead)
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

    // Always zero the Y axis shortly after initiating the homing cycle
    setTimeout(() => {
      this.spjs.send(`send ${port} G28.3 Y0\n`);
    }, 100);

    // Long-running homing cycles need multiple sync points
    [2000, 5000, 10000].forEach((delay) => {
      setTimeout(() => this.spjs.send(`send ${port} {"sr":""}\n`), delay);
    });
  }

  updateUI() {
    // Update Axis Numbers
    ["x", "y", "z", "a"].forEach((ax) => {
      const valEl = this.win.content.querySelector(`#dro-val-${ax}`);
      if (valEl) valEl.innerText = machine.currentPos[ax].toFixed(4);

      // Update Home Button Visibility
      const homeBtn = this.win.content.querySelector(`#btn-home-${ax}`);
      const conf = machine.config.axes[ax];
      if (homeBtn && conf) {
        homeBtn.style.display = conf.sn > 0 || conf.sx > 0 ? "block" : "none";
      }
    });

    // Calculate distance to ghost
    // Update Header Status
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