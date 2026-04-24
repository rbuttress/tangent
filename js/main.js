// js/main.js
//version no. 4.2

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

// 1. Initialize core background logic
const spjs = new SpjsClient();
const controller = new ControllerManager(spjs);
const nesterController = new Nester();
const cursorHUD = new CursorHUD();

// 2. Initialize the Floating Windows (x, y, width, height)
// Left Side: Assets
const connWin = new WidgetWindow("conn-widget", "Connection", 5, 5, 450, 1000);
const filesWin = new WidgetWindow("files-widget", "Files", 5, 170, 300, 600);
filesWin.flexGrow = true; // Fill vertical space

const fabricsWin = new WidgetWindow(
  "fabrics-widget",
  "Materials",
  5,
  480,
  200,
  400,
);
fabricsWin.autoFit = true; // Hugs content height

const queueWin = new WidgetWindow(
  "queue-widget",
  "Queue",
  window.innerWidth - 305,
  220,
  295,
  200,
);
queueWin.autoFit = true;

// Right Side: Operations
const droWin = new WidgetWindow(
  "dro-widget",
  "DRO",
  window.innerWidth - 305,
  5,
  300,
  450,
);

const gcodeWin = new WidgetWindow(
  "gcode-widget",
  "G-Code",
  window.innerWidth - 305,
  220,
  295,
  150,
);
gcodeWin.flexGrow = true; // Fill remaining vertical space

const rankingWin = new WidgetWindow(
  "ranking-widget",
  "Nesting",
  window.innerWidth - 305,
  380,
  295,
  400,
);
rankingWin.autoFit = true; // Hugs content height based on results

// Organize windows on the left and right edges
WidgetWindow.organizeEdge("left");
WidgetWindow.organizeEdge("right");

// 3. Mount Content directly into the Windows
const connection = new ConnectionUI(connWin, spjs, controller);
const dro = new DRO(droWin, spjs);
const viz = new Visualizer("bgCanvas", controller);

const rankingMenu = new RankingMenu(rankingWin.content);

// THE FIX: We pass the specific window's internal content div to the class
const fileBrowser = new FileBrowser(filesWin.content);
const fabricMenu = new FabricMenu(fabricsWin.content);
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

function processMachineLine(line) {
  connection.logToConsole(line);
  try {
    const json = JSON.parse(line);
    const sr = json.sr || (json.r && json.r.sr);
    if (sr) machine.updatePosition(sr);
    if (json.r) machine.updateConfig(json.r);
  } catch (e) {}
}

function tracerGamepadLoop() {
  const gamepads = navigator.getGamepads();
  const pad = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3];
  if (pad && pad.buttons.length > 0) {
    const aPressed = pad.buttons[0].pressed;
    fabricTracer.handleAButton(aPressed);
  }
  requestAnimationFrame(tracerGamepadLoop);
}

// 5. Start Background Processes
controller.start();
tracerGamepadLoop();
