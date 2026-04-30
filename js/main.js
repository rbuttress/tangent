// js/main.js
//version no. 4.6

import { machine } from "./core/machine.js";
import { SpjsClient } from "./core/spjs.js";
import { WidgetWindow } from "./ui/window.js";
import { DRO } from "./ui/dro.js";
import { ConnectionUI } from "./ui/connection.js";
import { Visualizer } from "./visualizer/canvas.js";
import { ControllerManager } from "./core/controller.js";
import { FileBrowser } from "./ui/browser.js";
import { FabricMenu } from "./ui/fabrics.js";
import { FabricTracer } from "./core/tracer.js";
import { QueueMenu } from "./ui/queue.js";
import { Nester } from "./core/nester.js";
import { CursorHUD } from "./ui/cursor.js";
import { RankingMenu } from "./ui/ranking.js";
import { GCodeManager } from "./ui/gcode.js";
import { Toolbar } from "./ui/toolbar.js";

// 1. Initialize core background logic
const spjs = new SpjsClient();
const controller = new ControllerManager(spjs);
const nesterController = new Nester();
const cursorHUD = new CursorHUD();

// 2. Initialize the Floating Windows (x, y, width, height)
const connWin = new WidgetWindow("conn-widget", "Connection", 5, 5, 450, 1000);
const filesWin = new WidgetWindow("files-widget", "Files", 5, 170, 300, 600);
filesWin.flexGrow = true;

window.NestConfig = JSON.parse(localStorage.getItem("nestConfig")) || {};

const fabricsWin = new WidgetWindow(
  "fabrics-widget",
  "Materials",
  5,
  480,
  200,
  400,
);
fabricsWin.autoFit = true;

const queueWin = new WidgetWindow(
  "queue-widget",
  "Queue",
  window.innerWidth - 305,
  220,
  295,
  200,
);
queueWin.autoFit = true;

const droWin = new WidgetWindow(
  "dro-widget",
  "DRO",
  window.innerWidth - 305,
  5,
  320,
  450,
);

const gcodeWin = new WidgetWindow(
  "gcode-widget",
  "G-Code Exporter",
  window.innerWidth - 305,
  window.innerHeight - 410,
  305,
  400,
);
gcodeWin.flexGrow = true;

const rankingWin = new WidgetWindow(
  "ranking-widget",
  "Nesting",
  window.innerWidth - 305,
  380,
  295,
  400,
);
rankingWin.autoFit = true;

// Organize windows on the left and right edges
WidgetWindow.organizeEdge("left");
WidgetWindow.organizeEdge("right");

// 3. Mount Content directly into the Windows
const connection = new ConnectionUI(connWin, spjs, controller);
const dro = new DRO(droWin, spjs);
const viz = new Visualizer("bgCanvas", controller);

const toolbar = new Toolbar(viz);
const gcodeManager = new GCodeManager(gcodeWin, viz);

const rankingMenu = new RankingMenu(rankingWin.content);

const fileBrowser = new FileBrowser(filesWin.content);
const fabricMenu = new FabricMenu(fabricsWin.content, viz);
const queueMenu = new QueueMenu(queueWin.content);
const fabricTracer = new FabricTracer(dro);

// Ensure target starts where the machine actually is
machine.targetPos.x = machine.currentPos.x;
machine.targetPos.y = machine.currentPos.y;

// 4. Data Routing & Events
document.addEventListener("RUN_NESTING", () => {
  nesterController.startNesting(viz.loadedFabric, viz.placedInstances);
});

document.addEventListener("STOP_NESTING", () => {
  nesterController.stopNesting();
});

document.addEventListener("UNDO_ACTION", () => viz.undo());
document.addEventListener("REDO_ACTION", () => viz.redo());

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  // Undo / Redo triggers
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === "z") {
      if (e.shiftKey) viz.redo();
      else viz.undo();
      return;
    }
    if (e.key.toLowerCase() === "y") {
      viz.redo();
      return;
    }
  }

  if (e.key === "Enter") {
    document.dispatchEvent(new Event("ROUTINE_NEXT"));
  }

  // --- THE FIX: Cascading Escape Logic ---
  if (e.key === "Escape") {
    // 1. If a nesting mask exists, clear the mask first and stop.
    if (viz.selection.nestingMaskBox || viz.selection.nestingMaskPoly) {
      viz.selection.clearNestingMask();
      document.dispatchEvent(
        new CustomEvent("NESTING_MASK_UPDATED", { detail: null }),
      );
      viz.saveState();
      return;
    }

    // 2. If no mask exists, fall through to clear selection and drawing state.
    viz.selection.clear();
    viz.activeDrawing = [];
    if (viz.currentTool && viz.currentTool.isDrawing !== undefined) {
      viz.currentTool.isDrawing = false;
    }
    if (viz.currentTool && viz.currentTool.reset) {
      viz.currentTool.reset();
    }
    if (viz.currentTool && viz.currentTool.cancel) {
      viz.currentTool.cancel();
    }
    viz.saveState();
    return;
  }

  // Delete Selection Logic
  if (e.key === "Delete" || e.key === "Backspace") {
    const selected = viz.selection.getAll();
    if (selected.length > 0) {
      selected.forEach((inst) => {
        const index = viz.placedInstances.indexOf(inst);
        if (index > -1) {
          viz.placedInstances.splice(index, 1);
        }
      });

      viz.selection.clear();
      viz.saveState();

      // Tell the Queue Menu to reconstruct itself
      document.dispatchEvent(
        new CustomEvent("SYNC_QUEUE", { detail: viz.placedInstances }),
      );
    }
    return;
  }

  const key = e.key.toLowerCase();

  if (key === "v") {
    viz.setTool("SELECT");
    document.dispatchEvent(
      new CustomEvent("TOOL_CHANGED", { detail: "SELECT" }),
    );
    document.body.style.cursor = "crosshair";
    return;
  } else if (key === "d") {
    viz.setTool("DRAW_POLY");
    document.dispatchEvent(
      new CustomEvent("TOOL_CHANGED", { detail: "DRAW_POLY" }),
    );
    document.body.style.cursor = "crosshair";
    return;
  }

  if (viz.currentTool && viz.currentTool.onKeyDown) {
    viz.currentTool.onKeyDown(e);
  }
});

let lineBuffer = "";
spjs.onData = (data) => {
  try {
    const wrapper = JSON.parse(data);
    if (wrapper.D) {
      lineBuffer += wrapper.D;
      while (lineBuffer.includes("\n")) {
        const nlIndex = lineBuffer.indexOf("\n");
        const rawLine = lineBuffer.substring(0, nlIndex).trim();
        lineBuffer = lineBuffer.substring(nlIndex + 1);
        if (rawLine) processMachineLine(rawLine);
      }
    }
    if (wrapper.QCnt !== undefined) {
      machine.qr = wrapper.QCnt;
      droWin.setStatus(`QR: ${wrapper.QCnt}`, wrapper.QCnt > 20);
      machine.notify();

      if (!window.hasAutoMinimized) {
        connWin.setMinimized(true);
        window.hasAutoMinimized = true;
      }
    }
  } catch (e) {
    connection.logToConsole(data);
  }
};

document.addEventListener("MACHINE_FEEDBACK", (e) => {
  const rawLine = e.detail;
  connection.logToConsole(rawLine);

  try {
    const json = JSON.parse(rawLine);
    const sr = json.sr || (json.r && json.r.sr);
    if (sr) {
      machine.updatePosition(sr);
      if (sr.qr !== undefined) {
        droWin.setStatus(`Buffer: ${sr.qr}`, sr.qr > 10);
      }
    }

    if (json.qr !== undefined) {
      droWin.setStatus(`Buffer: ${json.qr}`, json.qr > 10);
    }

    if (json.r) machine.updateConfig(json.r);

    machine.notify();
  } catch (err) {}
});

document.addEventListener("STREAM_GCODE_JOB", () => {
  if (!window.hasAutoMinimized) {
    connWin.setMinimized(true);
    window.hasAutoMinimized = true;
  }
});

function processMachineLine(line) {
  connection.logToConsole(line);
  try {
    const json = JSON.parse(line);
    const sr = json.sr || (json.r && json.r.sr);
    if (sr) machine.updatePosition(sr);
    if (json.r) machine.updateConfig(json.r);
  } catch (e) {}
}

let padLastA = false;
let padLastStart = false;
let padLastAPressTime = 0;

function handleGamepadInput() {
  const gamepads = navigator.getGamepads();
  const pad = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3];

  if (pad && pad.buttons.length > 0) {
    const aPressed = pad.buttons[0].pressed;
    const startPressed = pad.buttons[9] ? pad.buttons[9].pressed : false;

    // Standard A button logic for tracing
    fabricTracer.handleAButton(aPressed);

    // 1. START Button: Begin the routine
    if (startPressed && !padLastStart) {
      document.dispatchEvent(new Event("ROUTINE_START"));
    }
    padLastStart = startPressed;

    // 2. DOUBLE 'A' Button: Continue the routine
    if (aPressed && !padLastA) {
      const now = Date.now();
      if (now - padLastAPressTime < 400) {
        // 400ms double-click window
        document.dispatchEvent(new Event("ROUTINE_NEXT"));
        padLastAPressTime = 0; // Reset to prevent a triple-click firing twice
      } else {
        padLastAPressTime = now;
      }
    }
    padLastA = aPressed;
  }
  requestAnimationFrame(handleGamepadInput);
}

// 5. Start Background Processes
controller.start();
handleGamepadInput();
