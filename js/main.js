//version no. 3.2
import { SpjsClient } from './spjs.js';
import { Visualizer } from './canvas.js';
import { WidgetWindow } from './window.js';

const viz = new Visualizer('bgCanvas');
let spjs;

// Global state tracking
let machineConfig = { axes: { x: {}, y: {}, z: {}, a: {} } };
let currentPos = { x: 0, y: 0, z: 0, a: 0 };

// --- 1. WINDOW SETUP ---

// Connection Window (Left side)
const connWin = new WidgetWindow('conn-widget', 'Connection', 5, 5, 350);

// DRO Window (Locked to Top Right)
// We set width to 210 to give a tiny bit of internal padding for our 200px elements
const droWidth = 210;
const droWin = new WidgetWindow('dro-widget', '☭', window.innerWidth - (droWidth + 5), 5, droWidth);
droWin.el.classList.add('transparent-window');

// Logic to keep it locked to top right even if window resizes
window.addEventListener('resize', () => {
    droWin.el.style.left = (window.innerWidth - (droWidth + 5)) + 'px';
    droWin.el.style.top = '5px';
});

// Setup Header State Indicator
const droHeaderArea = droWin.el.querySelector('.window-title-area');
const stateIndicator = document.createElement('span');
stateIndicator.id = 'header-machine-state';
stateIndicator.className = 'header-stat';
stateIndicator.innerText = 'OFFLINE';
droHeaderArea.appendChild(stateIndicator);

// --- 2. INJECT UI CONTENT ---

const gearBtn = document.createElement('button');
gearBtn.innerHTML = '⚙️';
gearBtn.className = 'gear-btn';
connWin.el.querySelector('.window-title-area').appendChild(gearBtn);

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
    <div class="console-input-wrap"><span>&gt;</span><input type="text" id="gcode-input" placeholder="Enter G-code..." autocomplete="off"></div>
`;

droWin.content.innerHTML = `
    <div class="dro-column-wrap">
        <div class="jog-pad">
            <button class="jog-btn" onmousedown="jog('z', 1, event)">Z+</button>
            <button class="jog-btn" onmousedown="jog('y', 1, event)">Y+</button>
            <button class="jog-btn" onmousedown="jog('a', 1, event)">A+</button>
            
            <button class="jog-btn" onmousedown="jog('x', -1, event)">X-</button>
            <button class="jog-btn home-all" id="btn-home-all" style="font-size:10px">HOME</button>
            <button class="jog-btn" onmousedown="jog('x', 1, event)">X+</button>
            
            <button class="jog-btn" onmousedown="jog('a', -1, event)">A-</button>
            <button class="jog-btn" onmousedown="jog('y', -1, event)">Y-</button>
            <button class="jog-btn" onmousedown="jog('z', -1, event)">Z-</button>
        </div>

        <div class="jog-slider-wrap">
            <div class="jog-label-row">
                <span id="jog-dist-readout">1.00</span><span style="font-size:9px">mm</span>
            </div>
            <input type="range" id="jog-slider" min="0" max="100" value="50">
        </div>

        ${['x', 'y', 'z', 'a'].map(ax => `
            <div class="dro-row">
                <div class="axis-control-group" style="width:30px">
                    <div class="axis-main-label" style="font-size:18px">${ax.toUpperCase()}</div>
                    <div class="axis-hover-btns" style="left:0; right:auto;">
                        <button id="home-${ax}" style="display:none">H</button>
                        <button onclick="zeroAxis('${ax}')">0</button>
                    </div>
                </div>
                <div class="dro-readout">
                    <span id="dro-${ax}">0.0000</span>
                </div>
            </div>
        `).join('')}
    </div>
`;

// Elements
const consoleEl = connWin.content.querySelector('#console');
const portList = connWin.content.querySelector('#portList');
const gcodeInput = connWin.content.querySelector('#gcode-input');
const jogSlider = document.getElementById('jog-slider');
const jogReadout = document.getElementById('jog-dist-readout');

// Constants
const STATE_MAP = { 0:"INIT", 1:"READY", 2:"ALARM", 3:"STOPPED", 4:"END", 5:"RUNNING", 6:"HOLD", 9:"HOMING" };

// --- 3. LOGIC FUNCTIONS ---

function logToConsole(msg) {
    if (!msg) return;
    const div = document.createElement('div');
    div.style.borderBottom = '1px solid #222';
    div.style.padding = '2px 0';
    if (msg.includes('"sr":')) div.style.color = '#4ec9b0';
    else if (msg.includes('"qr":')) div.style.color = '#ce9178';
    div.innerText = `> ${msg.trim()}`;
    consoleEl.appendChild(div);
    if (consoleEl.childNodes.length > 100) consoleEl.removeChild(consoleEl.firstChild);
    requestAnimationFrame(() => { consoleEl.scrollTop = consoleEl.scrollHeight; });
}

function getLogDistance(val) {
    const minVal = Math.log(0.01);
    const maxVal = Math.log(100);
    const scale = (maxVal - minVal) / 100;
    return Math.exp(minVal + scale * val);
}

jogSlider.oninput = () => {
    const dist = getLogDistance(jogSlider.value);
    jogReadout.innerText = dist.toFixed(dist < 1 ? 2 : 1);
};

window.jog = (axis, dir, event) => {
    if (!spjs) return;
    let step = getLogDistance(jogSlider.value);
    if (event.shiftKey) step *= 10;
    if (event.ctrlKey || event.metaKey) step *= 100;

    const target = currentPos[axis] + (dir * step);
    spjs.send(`send ${portList.value} G90 G0 ${axis.toUpperCase()}${target.toFixed(4)}\n`);
    logToConsole(`JOG: ${axis.toUpperCase()} to ${target.toFixed(4)}`);
};

window.zeroAxis = (axis) => {
    if (!spjs) return;
    spjs.send(`send ${portList.value} G28.3 ${axis}0\n`);
    logToConsole(`Zeroed ${axis}`);
};

window.homeAxis = (axis) => {
    if (!spjs) return;
    spjs.send(`send ${portList.value} G28.2 ${axis.toUpperCase()}0\n`);
};

document.getElementById('btn-home-all').onclick = () => {
    if (!spjs) return;
    const canHome = (ax) => (machineConfig.axes[ax].sn > 0 || machineConfig.axes[ax].sx > 0);
    // Mandatory Sequence: Z -> A -> X -> Y
    if (canHome('z')) spjs.send(`send ${portList.value} G28.2 Z0\n`);
    if (canHome('a')) spjs.send(`send ${portList.value} G28.2 A0\n`);
    if (canHome('x')) spjs.send(`send ${portList.value} G28.2 X0\n`);
    if (canHome('y')) spjs.send(`send ${portList.value} G28.2 Y0\n`);
};

function updateDRO(sr) {
    ['x', 'y', 'z', 'a'].forEach(ax => {
        const val = sr[`pos${ax}`];
        if (val !== undefined) {
            currentPos[ax] = val;
            document.getElementById(`dro-${ax}`).innerText = val.toFixed(4);
        }
    });

    if (sr.stat !== undefined) {
        const stateEl = document.getElementById('header-machine-state');
        stateEl.innerText = STATE_MAP[sr.stat] || "UNKNOWN";
        stateEl.style.color = sr.stat === 5 ? "#4ec9b0" : "#f44747";
        stateEl.style.borderColor = sr.stat === 5 ? "#4ec9b0" : "#f44747";
    }
}

const connectServer = async () => {
    const url = connWin.content.querySelector('#spjsAddr').value;
    localStorage.setItem('spjs-addr', url);
    spjs = new SpjsClient(url);

    spjs.onPorts = (ports) => {
        portList.innerHTML = "";
        const savedPort = localStorage.getItem('last-port');
        ports.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.Name; opt.innerText = p.Name;
            if(p.Name === savedPort) opt.selected = true;
            portList.appendChild(opt);
        });
    };

    spjs.onData = (data) => {
        logToConsole(data);
        try {
            const json = JSON.parse(data);
            const sr = json.sr || (json.r && json.r.sr);
            if (sr) updateDRO(sr);

            if (json.r) {
                ['x','y','z','a'].forEach(ax => {
                    if (json.r[ax]) {
                        machineConfig.axes[ax] = { ...machineConfig.axes[ax], ...json.r[ax] };
                        const btn = document.getElementById(`home-${ax}`);
                        if (btn) {
                            btn.style.display = (machineConfig.axes[ax].sn > 0 || machineConfig.axes[ax].sx > 0) ? 'block' : 'none';
                            btn.onclick = () => window.homeAxis(ax);
                        }
                    }
                });
            }
            if (json.qr !== undefined) droWin.setStatus(`QR: ${json.qr}`, json.qr > 5);
        } catch (e) {}
    };

    try {
        await spjs.connect();
        connWin.setStatus("SPJS CONNECTED", true);
        spjs.list();
    } catch (e) { connWin.setStatus("CONN ERROR", false); }
};

// --- 4. EVENT LISTENERS ---

connWin.content.querySelector('#btnConnectSPJS').onclick = connectServer;

connWin.content.querySelector('#btnOpenPort').onclick = () => {
    if (!spjs) return;
    const port = portList.value;
    localStorage.setItem('last-port', port);
    spjs.open(port); 
    setTimeout(() => {
        spjs.send(`send ${port} \n\n`);
        spjs.send(`send ${port} {"sr":""}\n`);
        ['x','y','z','a'].forEach(ax => spjs.send(`send ${port} {"${ax}":""}\n`));
    }, 2000);
};

connWin.content.querySelector('#btnDisconnect').onclick = () => {
    if (spjs) {
        spjs.send(`close ${portList.value}`);
        spjs.socket.close();
        connWin.setStatus("DISCONNECTED", false);
        spjs = null;
    }
};

gearBtn.onclick = () => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-window" style="width: 95vw; max-width: 1200px;">
            <div class="window-header"><span class="window-title">Machine Config</span></div>
            <div class="modal-body">
                ${['x', 'y', 'z', 'a'].map(ax => `
                    <div class="settings-group">
                        <h4>${ax.toUpperCase()} Axis</h4>
                        <div class="settings-grid">${Object.keys(machineConfig.axes[ax]).sort().map(key => `
                            <div class="setting-item">
                                <label>${key}</label>
                                <input type="text" data-axis="${ax}" data-key="${key}" value="${machineConfig.axes[ax][key]}" class="machine-setting-input">
                            </div>`).join('')}
                        </div>
                    </div>`).join('')}
            </div>
            <div class="modal-footer"><button id="closeModal">Cancel</button><button id="saveSettings" style="background:#4ec9b0">Push Changes</button></div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('closeModal').onclick = () => modal.remove();
    document.getElementById('saveSettings').onclick = () => {
        let changes = { x:{}, y:{}, z:{}, a:{} };
        modal.querySelectorAll('.machine-setting-input').forEach(i => {
            const val = parseFloat(i.value);
            if (val !== machineConfig.axes[i.dataset.axis][i.dataset.key]) changes[i.dataset.axis][i.dataset.key] = val;
        });
        spjs.send(`send ${portList.value} ${JSON.stringify(changes)}\n`);
        modal.remove();
    };
};

gcodeInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        spjs.send(`send ${portList.value} ${gcodeInput.value.trim()}\n`);
        gcodeInput.value = '';
    }
};

if (localStorage.getItem('spjs-addr')) connectServer();