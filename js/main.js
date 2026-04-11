//js/main.js
//version no. 3.4 (Refactored)
console.log("Main.js start");
import { machine } from './core/machine.js';
import { SpjsClient } from './core/spjs.js';
import { WidgetWindow } from './ui/window.js';
import { DRO } from './ui/dro.js';
import { ConnectionUI } from './ui/connection.js';
import { Visualizer } from './visualizer/canvas.js';

console.log("Main.js finished loading");
// 1. Init Hardware Comm
const spjs = new SpjsClient(); 

// 2. Init Windows
const connWin = new WidgetWindow('conn-widget', 'TinyG Connection', 5, 5, 350);
const droWin = new WidgetWindow('dro-widget', '☭', window.innerWidth - 225, 5, 210);

// 3. Bind UI Modules
const connection = new ConnectionUI(connWin, spjs);
const dro = new DRO(droWin, spjs);
const viz = new Visualizer('bgCanvas');

// 4. Data Routing
//js/main.js
//version no. 3.7

let lineBuffer = ""; // Persistent buffer for streaming data
spjs.onData = (data) => {
    try {
        const wrapper = JSON.parse(data);

        // 1. Handle Machine Data (Inside "D")
        if (wrapper.D) {
            lineBuffer += wrapper.D;
            while (lineBuffer.includes("\n")) {
                const nlIndex = lineBuffer.indexOf("\n");
                const rawLine = lineBuffer.substring(0, nlIndex).trim();
                lineBuffer = lineBuffer.substring(nlIndex + 1);
                if (rawLine) processMachineLine(rawLine);
            }
        } 
        
        // 2. Handle SPJS Queue Reports (The QR/QCnt)
        // This is the "Command Buffer" indicator you are looking for
        if (wrapper.QCnt !== undefined) {
            machine.qr = wrapper.QCnt;
            // Update the DRO window header badge
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
        
        // Some TinyG versions send qr inside the machine JSON line too
        if (json.qr !== undefined) {
            machine.qr = json.qr;
            droWin.setStatus(`QR: ${json.qr}`, json.qr > 20);
            machine.notify();
        }
    } catch (e) {}
}
