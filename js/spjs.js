//version no. 1.2
export class SpjsClient {
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.onData = null; 
        this.onPorts = null; 
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket(this.url);
            this.socket.onopen = () => resolve();
            this.socket.onerror = (err) => reject(err);
            this.socket.onmessage = (event) => this._handleMessage(event);
        });
    }

    _handleMessage(event) {
        const msg = JSON.parse(event.data);
        if (msg.SerialPorts && this.onPorts) {
            this.onPorts(msg.SerialPorts);
        }
        if (msg.D && this.onData) {
            this.onData(msg.D);
        }
    }

    send(cmd) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(cmd);
        }
    }

    list() { this.send("list"); }

    open(portName) {
        // Open the hardware port
        this.send(`open ${portName} 115200 tinyg`);
        // CRITICAL: Tell SPJS to pipe that port's data to this WebSocket
        this.send(`watch ${portName}`);
    }
}