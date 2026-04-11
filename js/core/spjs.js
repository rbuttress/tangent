//js/core/spjs.js
//version no. 1.2

export class SpjsClient {
    constructor() {
        this.socket = null;
        this.onData = null;
        this.onPorts = null;
    }

    connect(url) {
        return new Promise((resolve, reject) => {
            if (!url) return reject("No URL provided");
            this.socket = new WebSocket(url);

            this.socket.onopen = () => {
                console.log("SPJS: WebSocket Opened");
                resolve();
            };
            
            this.socket.onerror = (err) => {
                console.error("SPJS: WebSocket Error", err);
                reject(err);
            };

            this.socket.onmessage = (event) => {
                const msg = event.data;
                // Log raw data to browser console for debugging
                console.log("SPJS RAW:", msg);

                if (this.onData) this.onData(msg);

                // Detect Port List
                if (msg.includes('SerialPorts')) {
                    try {
                        const json = JSON.parse(msg);
                        console.log("SPJS: Parsed Ports", json.SerialPorts);
                        if (this.onPorts) this.onPorts(json.SerialPorts);
                    } catch (e) {
                        console.error("SPJS: Failed to parse port JSON", e);
                    }
                }
            };
        });
    }

    send(msg) {
        if (this.socket && this.socket.readyState === 1) {
            this.socket.send(msg);
        } else {
            console.warn("SPJS: Attempted to send while socket closed:", msg);
        }
    }

    list() {
        console.log("SPJS: Requesting port list...");
        this.send("list\n");
    }

    open(port, baud = 115200) {
        this.send(`open ${port} ${baud}\n`);
    }
}