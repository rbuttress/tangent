//js/core/controller.js
//version no. 6.5

import { machine } from "./machine.js";

export class ControllerManager {
  constructor(spjs) {
    this.spjs = spjs;
    this.gamepadIndex = null;
    this.onInput = null;

    this.virtualTarget = null;
    this.wasDriving = false;
    this.isYExtended = false;

    this.config = {
      deadzone: 0.5,
      ltThreshold: 0.15,
      minFeed: 800,
      maxFeed: 4000,
      pollInterval: 50,
      yExtension: 450,
      angleSnapThreshold: 0.35,
      maxLinesInFlight: 4, // Strict streaming limit for jobs
    };

    this.activeAngle = null;
    this.drivingAngle = null;
    this.buttonStates = {};

    window.addEventListener(
      "gamepadconnected",
      (e) => (this.gamepadIndex = e.gamepad.index),
    );

    // --- FLOW CONTROL STATE ---
    this.linesInFlight = 0;
    this.currentJobLines = [];
    this.currentJobIndex = 0;

    this.isStreaming = false;
    this.isPaused = false;

    // Real-time Feedrate Override Multiplier
    this.feedOverride = 1.0;

    document.addEventListener("FEED_OVERRIDE", (e) => {
      this.feedOverride = e.detail;
    });

    document.addEventListener("MACHINE_FEEDBACK", (e) => {
      const now = new Date().toISOString().split("T")[1];
      try {
        let msg = e.detail;
        if (typeof msg === "string") msg = JSON.parse(msg);

        // 1. Log Physical Position updates
        if (msg.sr) {
          const s = msg.sr;
          console.log(
            `%c[<-RX][${now}] POS: X${s.posx ?? "?"} Y${s.posy ?? "?"} Z${s.posz ?? "?"} A${s.posa ?? "?"}`,
            "color: #00cccc; font-size: 9px;",
          );
        }

        // 2. THE JOB GATEKEEPER: "r" means TinyG successfully parsed a line.
        // We do NOT touch machine.qr here to prevent breaking the gamepad's native rate-limiting.
        if (msg.r !== undefined || msg.er !== undefined) {
          this.linesInFlight = Math.max(0, this.linesInFlight - 1);
          if (this.isStreaming) this.pumpQueue();
        }
      } catch (err) {}
    });

    document.addEventListener("STREAM_GCODE_JOB", (e) =>
      this.streamJob(e.detail),
    );

    document.addEventListener("PAUSE_JOB", () => {
      if (!this.isStreaming || this.isPaused) return;
      this.isPaused = true;
      const port = localStorage.getItem("last-port");
      if (port) this.spjs.send(`send ${port} !\n`);
      console.log(
        "%c[G-CODE] Job Paused.",
        "color: #ffaa00; font-weight: bold;",
      );
    });

    document.addEventListener("RESUME_JOB", () => {
      if (!this.isStreaming || !this.isPaused) return;
      this.isPaused = false;
      const port = localStorage.getItem("last-port");
      if (port) {
        this.spjs.send(`send ${port} ~\n`);
        console.log(
          "%c[G-CODE] Job Resumed.",
          "color: #2BEA64; font-weight: bold;",
        );
        this.pumpQueue();
      }
    });

    document.addEventListener("ABORT_JOB", () => {
      if (!this.isStreaming) return;
      const port = localStorage.getItem("last-port");
      if (port) this.triggerStop(port, "UI BUTTON: Job Aborted");
    });
  }

  sendToMachine(gcode) {
    const now = new Date().toISOString().split("T")[1];
    const port = localStorage.getItem("last-port");
    if (!port) return;

    const cleanGcode = gcode.split(";")[0].trim();
    if (!cleanGcode) return;

    console.log(
      `%c[TX->][${now}] ${cleanGcode} (Flight: ${this.linesInFlight + 1}/${this.config.maxLinesInFlight})`,
      "color: #ffffff; background: #333; padding: 2px;",
    );

    const payload = {
      P: port,
      Data: [{ D: cleanGcode + "\n", Id: "n" + this.currentJobIndex }],
    };
    this.spjs.send("sendjson " + JSON.stringify(payload));
  }

  streamJob(gcodeString) {
    if (this.isStreaming) {
      console.warn("A job is already running!");
      return;
    }

    const port = localStorage.getItem("last-port");
    if (!port) return;

    this.currentJobLines = gcodeString
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith(";"));

    this.currentJobIndex = 0;
    this.isStreaming = true;
    this.isPaused = false;
    this.linesInFlight = 0;

    console.log(
      `%c[G-CODE] Starting Job: ${this.currentJobLines.length} commands.`,
      "color: #2BEA64; font-weight: bold;",
    );

    this.spjs.send(`send ${port} ~\n`);
    this.pumpQueue();
  }

  pumpQueue() {
    if (!this.isStreaming || this.isPaused) return;

    while (
      this.linesInFlight < this.config.maxLinesInFlight &&
      this.currentJobIndex < this.currentJobLines.length
    ) {
      let line = this.currentJobLines[this.currentJobIndex];

      // Intercept and scale F (Feedrate) commands on the fly during jobs!
      if (this.feedOverride !== 1.0 && line.includes("F")) {
        line = line.replace(/F(\d+(\.\d+)?)/g, (match, p1) => {
          return "F" + Math.round(parseFloat(p1) * this.feedOverride);
        });
      }

      this.sendToMachine(line);
      this.currentJobIndex++;
      this.linesInFlight++;
    }

    if (
      this.currentJobIndex >= this.currentJobLines.length &&
      this.linesInFlight === 0
    ) {
      this.isStreaming = false;
      console.log(
        "%c[JOB COMPLETE] All commands acknowledged.",
        "color: #2BEA64; font-weight: bold;",
      );
      document.dispatchEvent(new CustomEvent("JOB_COMPLETED"));
    }
  }

  start() {
    const visualLoop = () => {
      this.updateHeadingOnly();
      requestAnimationFrame(visualLoop);
    };
    visualLoop();

    setInterval(() => {
      this.processMachineInputs();
    }, this.config.pollInterval);
  }

  updateHeadingOnly() {
    if (this.gamepadIndex === null) return;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return;
    const lx = gp.axes[0],
      ly = gp.axes[1];
    const mag = Math.hypot(lx, ly);
    if (mag > this.config.deadzone) this.activeAngle = Math.atan2(-ly, lx);
    else this.activeAngle = null;
  }

  processMachineInputs() {
    // SAFETY: Ignore gamepad inputs if a G-code job is actively streaming
    if (this.gamepadIndex === null || this.isStreaming) return;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    const port = localStorage.getItem("last-port");
    if (!gp || !port) return;

    const lb = gp.buttons[4].pressed;
    const rb = gp.buttons[5].pressed;

    this.handleButton(0, gp.buttons[0].pressed, () => {
      if (lb && rb) {
        this.spjs.send(`send ${port} G90 G0 A0`);
        this.log("Go to A 0");
      } else if (lb) {
        this.spjs.send(`send ${port} G28.2 A0`);
        this.log("Homing A Axis...");
      } else if (rb) {
        this.spjs.send(`send ${port} G28.3 A0`);
        this.log("Zeroing A Axis...");
      }
    });

    this.handleButton(1, gp.buttons[1].pressed, () => {
      if (lb && rb) {
        this.spjs.send(`send ${port} G90 G0 Z0`);
        this.log("Go to Z 0");
      } else if (lb) {
        this.spjs.send(`send ${port} G28.2 Z0`);
        this.log("Homing Z Axis...");
      } else if (rb) {
        this.spjs.send(`send ${port} G28.3 Z0`);
        this.log("Zeroing Z Axis...");
      } else {
        this.triggerStop(port, "B BUTTON: Emergency Stop");
      }
    });

    this.handleButton(2, gp.buttons[2].pressed, () => {
      if (lb && rb) {
        this.spjs.send(`send ${port} G90 G0 X0`);
        this.log("Go to X 0");
      } else if (lb) {
        this.spjs.send(`send ${port} G28.2 X0`);
        this.log("Homing X Axis...");
      } else if (rb) {
        this.spjs.send(`send ${port} G28.3 X0`);
        this.log("Zeroing X Axis...");
      }
    });

    this.handleButton(3, gp.buttons[3].pressed, () => {
      if (lb && rb) {
        this.spjs.send(`send ${port} G90 G0 Y0`);
        this.log("Go to Y 0");
      } else if (lb) {
        this.spjs.send(`send ${port} G28.2 Z0 A0 X0`);
        setTimeout(() => this.spjs.send(`send ${port} G28.3 Y0`), 100);
        this.isYExtended = false;
        this.log("Homing Z, A, X and Zeroing Y...");
      } else if (rb) {
        this.spjs.send(`send ${port} G28.3 Y0`);
        this.isYExtended = false;
        this.log("Zeroing Y Axis...");
      } else {
        if (this.isYExtended) {
          this.spjs.send(`send ${port} G91 G0 Y${this.config.yExtension}`);
          this.spjs.send(`send ${port} G90`);
          this.isYExtended = false;
          this.log("Y Retracted (+50mm)");
        } else {
          this.spjs.send(`send ${port} G91 G0 Y-${this.config.yExtension}`);
          this.spjs.send(`send ${port} G90`);
          this.isYExtended = true;
          this.log("Y Extended (-50mm)");
        }
      }
    });

    const lt = gp.buttons[6].value;

    if (this.activeAngle === null || lt <= this.config.ltThreshold) {
      if (this.wasDriving) this.triggerStop(port, "Trigger Released: Stopped");
      return;
    }

    if (!this.wasDriving) {
      this.wasDriving = true;
      this.drivingAngle = this.activeAngle;
      this.virtualTarget = { ...machine.currentPos };
      this.spjs.send(`send ${port} G90`);
    } else {
      let angleDiff = Math.abs(this.activeAngle - this.drivingAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      if (angleDiff > this.config.angleSnapThreshold) {
        this.triggerStop(port, "Sharp Turn: Recalculating Vector");
        return;
      }
      this.drivingAngle = this.activeAngle;
    }

    // THE FIX: Gamepad ignores hardware buffer. The 50ms setInterval is a perfect native rate-limit.
    this.executeStreamingStride(lt, port);
  }

  executeStreamingStride(lt, port) {
    if (!this.virtualTarget) return;

    const pressure =
      (lt - this.config.ltThreshold) / (1 - this.config.ltThreshold);
    const feed =
      this.config.minFeed +
      pressure * (this.config.maxFeed - this.config.minFeed);
    const stride = (feed / 60) * (this.config.pollInterval / 1000) * 1.5;

    this.virtualTarget.x += Math.cos(this.activeAngle) * stride;
    this.virtualTarget.y += Math.sin(this.activeAngle) * stride;

    const moveCmd = `G1 X${this.virtualTarget.x.toFixed(4)} Y${this.virtualTarget.y.toFixed(4)} F${Math.round(feed)}`;
    this.spjs.send(`send ${port} ${moveCmd}`);

    machine.targetPos.x = this.virtualTarget.x;
    machine.targetPos.y = this.virtualTarget.y;
    machine.notify();
  }

  triggerStop(port, msg) {
    this.spjs.send(`send ${port} !`);
    this.spjs.send(`send ${port} %`);

    setTimeout(() => {
      this.spjs.send(`send ${port} {"sr":""}`);
    }, 150);

    // Revert application state back to normal
    this.isStreaming = false;
    this.isPaused = false;
    this.currentJobLines = [];
    this.currentJobIndex = 0;
    this.linesInFlight = 0;

    document.dispatchEvent(new CustomEvent("ABORT_JOB"));
    document.dispatchEvent(new CustomEvent("JOB_COMPLETED"));

    this.wasDriving = false;
    this.virtualTarget = null;
    this.drivingAngle = null;
    this.log(msg);
  }

  handleButton(index, isPressed, callback) {
    if (isPressed && !this.buttonStates[index]) callback();
    this.buttonStates[index] = isPressed;
  }

  log(msg) {
    if (this.onInput) this.onInput(msg);
  }
}
