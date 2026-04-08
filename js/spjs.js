//version no. 1.0
export class SpjsClient {
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.onData = null; // Callback for TinyG responses
        this.onPorts = null; // Callback for port lists
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
        if (this.socket?.readyState === 1) this.socket.send(cmd);
    }

    list() { this.send("list"); }

    open(portName) {
        this.send(`open ${portName} 115200 tinyg`);
    }
}