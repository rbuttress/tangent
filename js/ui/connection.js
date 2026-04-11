//js/ui/connection.js
//version no. 1.0
import { machine } from '../core/machine.js';

export class ConnectionUI {
    constructor(win, spjs) {
        this.win = win;
        this.spjs = spjs;
        this.render();
        this.attachEvents();
    }

    render() {
        this.win.content.innerHTML = `
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

        // Add the Gear Button to the window header dynamically
        const headerArea = this.win.el.querySelector('.window-title-area');
        if (!headerArea.querySelector('.gear-btn')) {
            const gearBtn = document.createElement('button');
            gearBtn.innerHTML = '⚙️';
            gearBtn.className = 'gear-btn';
            gearBtn.onclick = () => this.showSettingsModal();
            headerArea.appendChild(gearBtn);
        }
    }

    attachEvents() {
        const c = this.win.content;
        this.consoleEl = c.querySelector('#console');
        this.portList = c.querySelector('#portList');
        this.gcodeInput = c.querySelector('#gcode-input');

        c.querySelector('#btnConnectSPJS').onclick = () => this.connectServer();
        c.querySelector('#btnDisconnect').onclick = () => this.disconnect();
        c.querySelector('#btnOpenPort').onclick = () => this.openPort();

        this.gcodeInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const cmd = this.gcodeInput.value.trim();
                if (cmd && this.spjs && this.portList.value) {
                    this.spjs.send(`send ${this.portList.value} ${cmd}\n`);
                    this.gcodeInput.value = '';
                    this.logToConsole(`USER: ${cmd}`);
                }
            }
        };

        // Hook into machine state updates to update the header status text
        machine.onUpdate(() => {
            this.win.setStatus(this.spjs?.socket?.readyState === 1 ? "CONNECTED" : "OFFLINE", machine.status === 5);
        });
    }

    async connectServer() {
        const url = this.win.content.querySelector('#spjsAddr').value;
        localStorage.setItem('spjs-addr', url);
        
        try {
            await this.spjs.connect(url);
            this.logToConsole("Server Connected");
            this.spjs.onPorts = (ports) => this.updatePortList(ports);
            this.spjs.list();
        } catch (e) {
            this.logToConsole("Connection Error: " + e);
        }
    }

    updatePortList(ports) {
        this.portList.innerHTML = "";
        const savedPort = localStorage.getItem('last-port');
        ports.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.Name;
            opt.innerText = p.Name;
            if(p.Name === savedPort) opt.selected = true;
            this.portList.appendChild(opt);
        });
    }

    openPort() {
        const port = this.portList.value;
        localStorage.setItem('last-port', port);
        this.spjs.open(port);
        this.logToConsole(`Opening ${port}...`);
        
        setTimeout(() => {
            this.spjs.send(`send ${port} \n\n`);
            this.spjs.send(`send ${port} {"sr":""}\n`);
            ['x','y','z','a'].forEach(ax => this.spjs.send(`send ${port} {"${ax}":""}\n`));
        }, 2000);
    }

    disconnect() {
        if (this.spjs) {
            this.spjs.send(`close ${this.portList.value}`);
            this.spjs.socket.close();
            this.logToConsole("Disconnected.");
        }
    }

   logToConsole(msg) {
    if (!msg || !this.consoleEl) return;
    
    // FILTER: Ignore empty feedback objects to keep the console readable
    if (msg.trim() === '{"r":{},"f":[1,0,7,11]}' || msg.includes('"r":{}')) {
        return; 
    }

    const div = document.createElement('div');
    div.style.borderBottom = '1px solid #222';
    div.style.padding = '2px 0';
    
    // Highlight Status Reports
    if (msg.includes('"sr":')) {
        div.style.color = '#4ec9b0'; // Teal
    } else if (msg.includes('"qr":')) {
        div.style.color = '#ce9178'; // Orange/Ginger
    }
    
    div.innerText = msg.startsWith('>') ? msg : `> ${msg.trim()}`;
    this.consoleEl.appendChild(div);
    
    // Auto-scroll
    if (this.consoleEl.childNodes.length > 50) this.consoleEl.removeChild(this.consoleEl.firstChild);
    this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
}

    showSettingsModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-window" style="width: 95vw; max-width: 1200px;">
                <div class="window-header">
                    <span class="window-title">Full Machine Configuration</span>
                    <button id="refreshSettings" style="font-size:10px; padding:2px 5px; width:auto;">Re-Probe</button>
                </div>
                <div class="modal-body" style="grid-template-columns: 1fr;">
                    ${['x', 'y', 'z', 'a'].map(ax => `
                        <div class="settings-group" style="margin-bottom:15px;">
                            <h4 style="border-bottom: 1px solid #444; color:#569cd6; margin-bottom:10px;">${ax.toUpperCase()} AXIS</h4>
                            <div class="settings-grid">
                                ${this.generateSettingsFields(ax)}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="modal-footer">
                    <button id="closeModal">Cancel</button>
                    <button id="saveSettings" style="background:#4ec9b0; color:#000; font-weight:bold;">Push Changes</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('closeModal').onclick = () => modal.remove();
        document.getElementById('refreshSettings').onclick = () => {
            ['x','y','z','a'].forEach(ax => this.spjs.send(`send ${this.portList.value} {"${ax}":""}\n`));
            modal.remove();
        };
        document.getElementById('saveSettings').onclick = () => this.saveSettings(modal);
    }

    generateSettingsFields(axisKey) {
        const settings = machine.config.axes[axisKey];
        if (!settings || Object.keys(settings).length === 0) return `<p>No data received.</p>`;
        return Object.keys(settings).sort().map(key => `
            <div class="setting-item">
                <label>${key}</label>
                <input type="text" data-axis="${axisKey}" data-key="${key}" value="${settings[key]}" class="machine-setting-input">
            </div>
        `).join('');
    }

    saveSettings(modal) {
        let changes = { x:{}, y:{}, z:{}, a:{} };
        modal.querySelectorAll('.machine-setting-input').forEach(i => {
            const val = parseFloat(i.value);
            const ax = i.dataset.axis;
            const key = i.dataset.key;
            if (val !== machine.config.axes[ax][key]) {
                changes[ax][key] = val;
            }
        });
        this.spjs.send(`send ${this.portList.value} ${JSON.stringify(changes)}\n`);
        modal.remove();
    }
}