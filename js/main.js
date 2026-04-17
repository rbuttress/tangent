//js/main.js
//version no. 4.0

import { machine } from './core/machine.js';
import { SpjsClient } from './core/spjs.js';
import { WidgetWindow } from './ui/window.js';
import { DRO } from './ui/dro.js';
import { ConnectionUI } from './ui/connection.js';
import { Visualizer } from './visualizer/canvas.js';
import { ControllerManager } from './core/controller.js';

// 1. Initialize non-UI logic first
const spjs = new SpjsClient();
const controller = new ControllerManager(spjs);

// 2. Initialize the Window Containers (the boxes)
const connWin = new WidgetWindow('conn-widget', 'TinyG Connection', 5, 5, 420);
// Initial DRO placement variables
const droPadding = 5;
const droWidth = 210;
const droWin = new WidgetWindow('dro-widget', 'Control', window.innerWidth - droWidth - droPadding, 5, droWidth);
droWin.el.classList.add('transparent-window');
// --- THE FIX: Lock DRO to the right edge on resize ---
window.addEventListener('resize', () => {
    // We calculate this using the element's actual offsetWidth just in case 
    // you implement manual window resizing for the DRO later!
    const currentWidth = droWin.el.offsetWidth; 
    droWin.el.style.left = (window.innerWidth - currentWidth - droPadding) + 'px';
});

// 3. Initialize the UI Components (the content)
// Now connWin and controller are defined, so this won't crash
const connection = new ConnectionUI(connWin, spjs, controller);
const dro = new DRO(droWin, spjs);
const viz = new Visualizer('bgCanvas', controller);

// Ensure target starts where the machine actually is
machine.targetPos.x = machine.currentPos.x;
machine.targetPos.y = machine.currentPos.y;

// 4. Data Routing (The Switchboard)
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

// 5. Start Polling
controller.start();