//js/core/spjs.js
//version no. 1.4

export class SpjsClient {
    constructor() {
        this.socket = null;
        this.onData = null;
        this.onPorts = null;
        this.onOpenSuccess = null;
        this.onOpenFail = null;
        this.isConnected = false; // Track server connection
    }

connect(url) {
        return new Promise((resolve, reject) => {
            // --- THE FIX: Kill ghost sockets before spawning a new one ---
            if (this.socket) {
                // Remove old event listeners so they don't fire during teardown
                this.socket.onopen = null;
                this.socket.onclose = null;
                this.socket.onerror = null;
                this.socket.onmessage = null;
                this.socket.close();
            }

            this.socket = new WebSocket(url);
            
            this.socket.onopen = () => {
                this.isConnected = true;
                resolve();
            };
            
            this.socket.onclose = () => { this.isConnected = false; };
            this.socket.onerror = (err) => { this.isConnected = false; reject(err); };
            
            this.socket.onmessage = (event) => {
                const msg = event.data;
                if (this.onData) this.onData(msg);

                try {
                    const json = JSON.parse(msg);
                    if (json.SerialPorts) {
                        if (this.onPorts) this.onPorts(json.SerialPorts);
                    }
                    if (json.Cmd === "Open") this.onOpenSuccess?.(json.Port);
                    if (json.Cmd === "OpenFail") this.onOpenFail?.(json.Desc);
                } catch (e) {
                    // Ignore non-JSON messages
                }
            };
        });
    }

    send(msg) {
        if (this.isConnected) this.socket.send(msg.trim() + "\n");
    }

    list() { 
        if (this.isConnected) this.send("list"); 
    }
    
    open(port, baud = 115200) {
        if (this.isConnected) this.socket.send(`open ${port} ${baud}\n`);
    }
}