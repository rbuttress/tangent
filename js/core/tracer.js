// js/core/fabricTracer.js
//version no. 1.1

import { machine } from "./machine.js";

export class FabricTracer {
  constructor(droReference, serverUrl = "http://localhost:3000") {
    this.dro = droReference;
    this.serverUrl = serverUrl;

    this.isTracing = false;
    this.tracePoints = [];
    this.pendingFabricData = null;

    this.aButtonPressTime = 0;
    this.longPressThreshold = 2000;
    this.aButtonDown = false;

    document.addEventListener("START_FABRIC_TRACE", (e) =>
      this.startTrace(e.detail),
    );
  }

  startTrace(fabricData) {
    this.isTracing = true;
    this.tracePoints = [];
    this.pendingFabricData = fabricData;
    this.showTracingUI();
    console.log("TRACE MODE ACTIVE: Move tool to top-left corner and press A.");

    document.dispatchEvent(
      new CustomEvent("TRACE_UPDATED", { detail: this.tracePoints }),
    );
  }

  handleAButton(isPressed) {
    if (!this.isTracing) return;

    if (isPressed && !this.aButtonDown) {
      this.aButtonDown = true;
      this.aButtonPressTime = Date.now();
    } else if (!isPressed && this.aButtonDown) {
      this.aButtonDown = false;
      const pressDuration = Date.now() - this.aButtonPressTime;

      if (
        pressDuration > this.longPressThreshold &&
        this.tracePoints.length > 0
      ) {
        this.finishTrace();
      } else {
        this.addPoint();
      }
    }
  }

  addPoint() {
    const currentX = machine.currentPos.x;
    const currentY = machine.currentPos.y;

    this.tracePoints.push({ x: currentX, y: currentY });

    const msg =
      this.tracePoints.length === 1
        ? "Point 1 logged. Move along the edge and press A."
        : `Point ${this.tracePoints.length} logged. Press A for next, or HOLD A for 2 sec to finish.`;

    this.updateTracingUI(msg);

    document.dispatchEvent(
      new CustomEvent("TRACE_UPDATED", { detail: this.tracePoints }),
    );
  }

  async finishTrace() {
    this.isTracing = false;
    this.removeTracingUI();

    const startP = this.tracePoints[0];
    const endP = this.tracePoints[this.tracePoints.length - 1];

    const dropLength =
      this.pendingFabricData.type === "roll"
        ? 10000
        : this.pendingFabricData.height || 10000;

    this.tracePoints.push({ x: endP.x, y: endP.y - dropLength });
    this.tracePoints.push({ x: startP.x, y: startP.y - dropLength });

    const w = Math.abs(endP.x - startP.x);

    const finalizedFabric = {
      id: Date.now().toString(),
      name: this.pendingFabricData.name,
      color: this.pendingFabricData.color,
      type: this.pendingFabricData.type,
      edgeProfile: [...this.tracePoints],
      width: w,
      height: dropLength,
    };

    try {
      await fetch(`${this.serverUrl}/api/fabrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalizedFabric),
      });
      document.dispatchEvent(new CustomEvent("FABRIC_DATABASE_UPDATED"));

      document.dispatchEvent(
        new CustomEvent("FABRIC_LOADED", {
          detail: { fabric: finalizedFabric, isFreshTrace: true },
        }),
      );
    } catch (e) {
      console.error("Failed to save traced fabric:", e);
    }

    this.tracePoints = [];
    document.dispatchEvent(new CustomEvent("TRACE_UPDATED", { detail: [] }));
  }

  // --- Simple UI Overlays ---
  showTracingUI() {
    const overlay = document.createElement("div");
    overlay.id = "tracing-overlay";

    // THE FIX: Massive z-index, fixed to top-center, pointer-events managed
    overlay.style.cssText =
      "position: fixed; top: 30px; left: 50%; transform: translateX(-50%); z-index: 9999; pointer-events: none;";

    overlay.innerHTML = `
        <div class="glass-modal-content" style="text-align: center; pointer-events: auto; padding: 15px 25px; width: auto; min-width: 350px;">
            <h3 style="color: var(--accent-red); font-size: 14px; margin-bottom: 8px;">● RECORDING TRACE</h3>
            
            <div id="tracing-msg" style="font-size: 12px; font-weight: bold; margin-bottom: 15px; color: var(--text-main);">
                Move tool to top-left corner and press A.
            </div>
            
            <button class="glass-btn secondary" id="btn-cancel-trace" style="margin: 0;">Cancel Trace</button>
        </div>
    `;

    document.getElementById("modal-layer").appendChild(overlay);

    document.getElementById("btn-cancel-trace").onclick = () => {
      this.isTracing = false;
      this.tracePoints = [];
      this.removeTracingUI();
      document.dispatchEvent(new CustomEvent("CANVAS_NEEDS_REDRAW"));
    };
  }

  updateTracingUI(msg) {
    const msgEl = document.getElementById("tracing-msg");
    if (msgEl) msgEl.innerText = msg;
  }

  removeTracingUI() {
    const overlay = document.getElementById("tracing-overlay");
    if (overlay) overlay.remove();
  }
}
