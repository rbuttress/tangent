//version no. 1.0
import { SpjsClient } from './spjs.js';
import { Visualizer } from './canvas.js';

const viz = new Visualizer('bgCanvas');
let spjs;

const consoleEl = document.getElementById('console');
const portList = document.getElementById('portList');

function log(msg) {
    const div = document.createElement('div');
    div.innerText = `> ${msg.substring(0, 60)}`;
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

document.getElementById('btnConnectSPJS').onclick = async () => {
    const url = document.getElementById('spjsAddr').value;
    spjs = new SpjsClient(url);

    // Set up callbacks
    spjs.onPorts = (ports) => {
        portList.innerHTML = "";
        ports.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.Name;
            opt.innerText = p.Name;
            portList.appendChild(opt);
        });
        log("Ports updated.");
    };

    spjs.onData = (data) => {
        // Here is where we will eventually update the Canvas 
        // based on the Status Reports (sr)
        if (data.includes('"sr":')) {
            log("Status Report Received");
        }
    };

    try {
        await spjs.connect();
        log("Server Connected");
        spjs.list();
    } catch (e) {
        log("Server Connection Failed");
    }
};

document.getElementById('btnOpenPort').onclick = () => {
    if (!spjs) return;
    const port = portList.value;
    spjs.open(port);
    log(`Opening ${port}...`);
};