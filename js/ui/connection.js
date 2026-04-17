//js/ui/connection.js
//version no. 2.1
import { machine } from '../core/machine.js';

export class ConnectionUI {
    constructor(win, spjs, controller) {
        this.win = win;
        this.spjs = spjs;
        this.controller = controller;
        
        this.autoConnectTried = false;
        this.connectedPort = null;
        
        // 1. Build the HTML
        this.render();
        
        // 2. Bind the Logic
        this.attachEvents();

        // 3. Initial One-Shot Connection Attempt
        this.connectServer();
    }

    render() {
        this.win.content.innerHTML = `
            <div style="flex-shrink: 0; margin-bottom: 10px;">
                <input type="text" id="spjsAddr" value="${localStorage.getItem('spjs-addr') || 'ws://localhost:8989/ws'}" style="width:100%">
                <div style="display:flex; gap:5px; margin-top:5px;">
                    <button id="btnConnectSPJS" style="flex:2">Connect SPJS</button>
                    <button id="btnDisconnect" style="flex:1; background:#444;">Stop SPJS</button>
                </div>
                <hr style="border:0; border-top:1px solid #ccc; margin:10px 0;">
                <select id="portList" style="width:100%"><option>Scan for ports...</option></select>
                <button id="btnOpenPort" style="width:100%; margin-top:5px">Connect TinyG</button>
            </div>
            <div id="console"></div>
            <div class="console-input-wrap">
                <span>&gt;</span>
                <input type="text" id="gcode-input" placeholder="Enter G-code..." autocomplete="off">
            </div>
        `;

        const headerArea = this.win.el.querySelector('.window-title-area');
        const existingBtns = headerArea.querySelectorAll('.gear-btn');
        existingBtns.forEach(b => b.remove());

        headerArea.style.cursor = 'pointer';
        headerArea.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON') {
                this.win.el.classList.toggle('minimized');
            }
        };

        let titleSpan = headerArea.querySelector('.window-title');
        if (titleSpan) {
            titleSpan.innerHTML = `Connection <span id="conn-indicator" style="color:#666; font-size:0.9em; margin-left:8px;">[Offline]</span>`;
        }

        const xboxBtn = document.createElement('button');
        xboxBtn.innerHTML = '🎮';
        xboxBtn.className = 'gear-btn xbox-btn';
        xboxBtn.onclick = () => this.showControllerModal();
        headerArea.appendChild(xboxBtn);

        const gearBtn = document.createElement('button');
        gearBtn.innerHTML = '⚙️';
        gearBtn.className = 'gear-btn';
        gearBtn.onclick = () => this.showSettingsModal();
        headerArea.appendChild(gearBtn);

        if (this.controller) {
            this.controller.onInput = (msg) => this.logToConsole(msg);
        }
    }

    attachEvents() {
        const c = this.win.content;
        
        this.consoleEl = c.querySelector('#console');
        this.portList = c.querySelector('#portList');
        this.gcodeInput = c.querySelector('#gcode-input');

        const btnConnect = c.querySelector('#btnConnectSPJS');
        const btnDisconnect = c.querySelector('#btnDisconnect');
        this.btnOpen = c.querySelector('#btnOpenPort'); 

        if (btnConnect) btnConnect.onclick = () => this.connectServer();
        if (btnDisconnect) btnDisconnect.onclick = () => this.disconnectSPJS();
        
        if (this.btnOpen) {
            this.btnOpen.onclick = () => {
                if (this.connectedPort) {
                    this.disconnectTinyG();
                } else {
                    this.openPort();
                }
            };
        }

        if (this.gcodeInput) {
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
        }

        this.spjs.onPorts = (ports) => this.updatePortList(ports);

        this.spjs.onOpenSuccess = (port) => {
            this.connectedPort = port;
            this.btnOpen.innerText = "Disconnect TinyG";
            this.btnOpen.style.background = "#900";
            this.updateTitleIndicator(`TinyG: ${port}`, "#4ec9b0");
            this.logToConsole(`PORT OPENED: ${port}`);
            
            this.initializeMachine(port);
            this.win.el.classList.add('minimized');
        };

        this.spjs.onOpenFail = (error) => {
            this.logToConsole(`OPEN FAILED: ${error}`);
            this.updateTitleIndicator("Port Busy", "#d28e00");
            this.autoConnectTried = false;
        };

        machine.onUpdate(() => {
            const isSocketOpen = this.spjs?.isConnected;
            if (typeof this.win.setStatus === 'function') {
                this.win.setStatus(isSocketOpen ? "CONNECTED" : "OFFLINE", machine.status === 5);
            }
        });
    }

    async connectServer() {
        const url = this.win.content.querySelector('#spjsAddr').value;
        localStorage.setItem('spjs-addr', url);
        
        // Reset auto-connect flag in case this is a manual reconnect attempt
        this.autoConnectTried = false; 
        
        try {
            await this.spjs.connect(url);
            this.logToConsole("SPJS Server Connected");
            this.updateTitleIndicator("SPJS Connected", "#d28e00");
            this.spjs.list();
        } catch (e) {
            this.logToConsole("SPJS not detected");
            this.updateTitleIndicator("SPJS Offline", "#900");
        }
    }

    updatePortList(ports) {
        if (this.connectedPort) return; 

        this.portList.innerHTML = "";
        const savedPort = localStorage.getItem('last-port');
        let savedPortData = null;

        ports.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.Name;
            
            const idData = p.Friendly || p.Manufacturer || "";
            // Add a visual indicator in the dropdown if SPJS says it is currently holding the port open
            const statusStr = p.IsOpen ? " (Currently Open)" : "";
            opt.innerText = `${p.Name} ${idData ? `(${idData})` : ""}${statusStr}`;
            
            this.portList.appendChild(opt);

            // Flag if the saved port exists in the current hardware list
            if (p.Name === savedPort) {
                savedPortData = p;
            }
        });

        // --- THE RESUME FIX ---
        if (savedPortData && !this.autoConnectTried) {
            this.autoConnectTried = true;
            this.portList.value = savedPortData.Name;
            
            if (savedPortData.IsOpen) {
                // The port survived the page refresh. Don't send 'open', just sync the UI.
                this.logToConsole(`Resuming existing connection to ${savedPortData.Name}...`);
                
                // Manually trigger the success sequence to minimize the window and probe the machine
                if (this.spjs.onOpenSuccess) this.spjs.onOpenSuccess(savedPortData.Name);
            } else {
                // The port exists but is physically closed, open it normally
                this.logToConsole(`Auto-connecting to last used port: ${savedPortData.Name}...`);
                this.openPort();
            }
        } 
        else if (savedPortData) {
            this.portList.value = savedPortData.Name;
        }
    }

    openPort() {
        const port = this.portList.value;
        if (!port || port.includes("Scan")) return;
        
        this.updateTitleIndicator(`Connecting...`, "#d28e00");
        localStorage.setItem('last-port', port);
        this.spjs.open(port);
    }

    disconnectTinyG() {
        if (!this.connectedPort) return;
        this.logToConsole(`Disconnecting from ${this.connectedPort}...`);
        
        if (this.spjs.isConnected) {
            this.spjs.socket.send(`close ${this.connectedPort}\n`);
        }

        this.connectedPort = null;
        this.btnOpen.innerText = "Connect TinyG";
        this.btnOpen.style.background = "";
        this.updateTitleIndicator("SPJS Connected", "#d28e00");
        this.spjs.list();
    }

    disconnectSPJS() {
        if (this.spjs) {
            if (this.connectedPort) this.disconnectTinyG();
            this.spjs.socket.close();
            this.logToConsole("SPJS Disconnected manually.");
            this.updateTitleIndicator("Offline", "#900");
        }
    }

    initializeMachine(port) {
        this.spjs.send(`send ${port} {"sv":1,"si":100}`); 
        this.spjs.send(`send ${port} {"sr":""}`);
        
        this.spjs.send(`send ${port} {"x":""}`);         
        this.spjs.send(`send ${port} {"y":""}`);         
        this.spjs.send(`send ${port} {"z":""}`);
        this.spjs.send(`send ${port} {"a":""}`);
        
        this.logToConsole("Machine Handshake Complete.");
    }

    updateTitleIndicator(text, color) {
        const indicator = this.win.el.querySelector('#conn-indicator');
        if (indicator) {
            indicator.style.color = color;
            indicator.innerText = `[${text}]`;
        }
    }

    logToConsole(msg) {
        if (!msg || !this.consoleEl) return;
        
        if (msg.trim() === '{"r":{},"f":[1,0,7,11]}' || msg.includes('"r":{}')) return; 

        const div = document.createElement('div');
        div.style.borderBottom = '1px solid #222';
        div.style.padding = '2px 0';
        
        if (msg.includes('"sr":')) {
            div.style.color = '#4ec9b0'; 
        } else if (msg.includes('"qr":')) {
            div.style.color = '#ce9178'; 
        }
        
        div.innerText = msg.startsWith('>') ? msg : `> ${msg.trim()}`;
        this.consoleEl.appendChild(div);
        
        if (this.consoleEl.childNodes.length > 50) this.consoleEl.removeChild(this.consoleEl.firstChild);
        this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
    }

    showControllerModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        
        modal.innerHTML = `
            <div class="modal-window" style="width: 400px;">
                <div class="window-header">
                    <span class="window-title">Controller Settings</span>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom:15px; font-size:11px; color:#900; font-weight:bold;">
                        SAFETY: Vector Drive relies on LT (BTN 6) as the Gas Pedal.
                    </div>
                    <div class="settings-group">
                        <h4>Vector Drive Configuration</h4>
                        <div class="setting-item">
                            <label>Deadzone (0.0-1.0)</label>
                            <input type="number" id="ctrl-deadzone" step="0.05" value="${this.controller.config.deadzone}">
                        </div>
                        <div class="setting-item">
                            <label>Max Feedrate (mm/min)</label>
                            <input type="number" id="ctrl-maxfeed" step="100" value="${this.controller.config.maxFeed}">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="closeCtrlModal">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const dzInput = modal.querySelector('#ctrl-deadzone');
        const feedInput = modal.querySelector('#ctrl-maxfeed');
        const closeBtn = modal.querySelector('#closeCtrlModal');

        dzInput.onchange = () => {
            this.controller.config.deadzone = parseFloat(dzInput.value);
            this.logToConsole(`Controller: Deadzone set to ${dzInput.value}`);
        };

        feedInput.onchange = () => {
            this.controller.config.maxFeed = parseFloat(feedInput.value);
            this.logToConsole(`Controller: Max Feedrate set to ${feedInput.value}`);
        };

        closeBtn.onclick = () => modal.remove();
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
            if(!this.connectedPort) return;
            ['x','y','z','a'].forEach(ax => this.spjs.send(`send ${this.connectedPort} {"${ax}":""}\n`));
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
        if(!this.connectedPort) return;
        let changes = { x:{}, y:{}, z:{}, a:{} };
        modal.querySelectorAll('.machine-setting-input').forEach(i => {
            const val = parseFloat(i.value);
            const ax = i.dataset.axis;
            const key = i.dataset.key;
            if (val !== machine.config.axes[ax][key]) {
                changes[ax][key] = val;
            }
        });
        this.spjs.send(`send ${this.connectedPort} ${JSON.stringify(changes)}\n`);
        modal.remove();
    }
}