//version no. 2.0
import { SpjsClient } from './spjs.js';
import { Visualizer } from './canvas.js';
import { WidgetWindow } from './window.js';

const viz = new Visualizer('bgCanvas');
let spjs;

const connWin = new WidgetWindow('conn-widget', 'TinyG Connection', 20, 20, 350);

connWin.content.innerHTML = `
    <div style="flex-shrink: 0; margin-bottom: 10px;">
        <input type="text" id="spjsAddr" value="${localStorage.getItem('spjs-addr') || 'ws://localhost:8989/ws'}" style="width:100%">
        <div style="display:flex; gap:5px; margin-top:5px;">
            <button id="btnConnectSPJS" style="flex:2">Connect Server</button>
            <button id="btnDisconnect" style="flex:1; background:#444;">Disconnect</button>
        </div>
        <hr style="border:0; border-top:1px solid #444; margin:10px 0;">
        <select id="portList" style="width:100%"><option>Scan for ports...</option></select>
        <button id="btnOpenPort" style="width:100%; margin-top:5px">Connect TinyG</button>
    </div>

    <div id="console"></div>

    <div class="console-input-wrap">
        <span>&gt;</span>
        <input type="text" id="gcode-input" placeholder="Enter G-code..." autocomplete="off">
    </div>
`;

const consoleEl = connWin.content.querySelector('#console');
const portList = connWin.content.querySelector('#portList');
const gcodeInput = connWin.content.querySelector('#gcode-input');
const btnConnect = connWin.content.querySelector('#btnConnectSPJS');
const btnDisconnect = connWin.content.querySelector('#btnDisconnect');
const btnOpen = connWin.content.querySelector('#btnOpenPort');

//version no. 2.2
function logToConsole(msg) {
    if (!msg) return;
    const div = document.createElement('div');
    div.style.borderBottom = '1px solid #222';
    div.style.padding = '2px 0';
    div.innerText = `> ${msg.trim()}`;
    consoleEl.appendChild(div);

    // Prune old entries
    if (consoleEl.childNodes.length > 100) consoleEl.removeChild(consoleEl.firstChild);

    // CRITICAL: Auto-scroll to bottom
    // We use requestAnimationFrame to ensure the DOM has rendered the new div
    requestAnimationFrame(() => {
        consoleEl.scrollTop = consoleEl.scrollHeight;
    });
}
// Function to handle the actual connection logic
const connectServer = async () => {
    const url = connWin.content.querySelector('#spjsAddr').value;
    localStorage.setItem('spjs-addr', url); // Save for refresh
    
    spjs = new SpjsClient(url);

    spjs.onPorts = (ports) => {
        portList.innerHTML = "";
        const savedPort = localStorage.getItem('last-port');
        ports.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.Name;
            opt.innerText = p.Name;
            if(p.Name === savedPort) opt.selected = true;
            portList.appendChild(opt);
        });
    };

    spjs.onData = (data) => {
        logToConsole(data);
        if (data.includes('"sr":')) connWin.setStatus("TINYG ONLINE", true);
    };

    try {
        await spjs.connect();
        connWin.setStatus("SPJS CONNECTED", true);
        logToConsole("Server Connected");
        spjs.list();
    } catch (e) {
        connWin.setStatus("CONN ERROR", false);
    }
};

btnConnect.onclick = connectServer;

btnOpen.onclick = () => {
    if (!spjs) return;
    const port = portList.value;
    localStorage.setItem('last-port', port);
    
    spjs.open(port); 
    logToConsole(`Attempting to open ${port}...`);
    
    setTimeout(() => {
        logToConsole(`Initializing...`);
        spjs.send(`send ${port} \n\n`);
        spjs.send(`send ${port} {"sr":""}\n`);
    }, 2000);
};

btnDisconnect.onclick = () => {
    if (!spjs) return;
    const port = portList.value;
    logToConsole(`Closing port ${port} and disconnecting...`);
    
    // Commands to SPJS to release the hardware
    spjs.send(`close ${port}`);
    spjs.socket.close();
    
    connWin.setStatus("DISCONNECTED", false);
    spjs = null;
};

// Auto-reconnect on page load
if (localStorage.getItem('spjs-addr')) {
    logToConsole("Auto-reconnecting...");
    connectServer();
}

// Global "Cleanup" on window close
window.onbeforeunload = () => {
    if (spjs && portList.value) {
        spjs.send(`close ${portList.value}`);
    }
};

gcodeInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        const cmd = gcodeInput.value.trim();
        const port = portList.value;
        if (cmd && spjs && port) {
            spjs.send(`send ${port} ${cmd}\n`);
            gcodeInput.value = '';
        }
    }
};