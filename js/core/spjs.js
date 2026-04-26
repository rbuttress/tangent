// js/core/spjs.js
//version no. 1.7

export class SpjsClient {
  constructor() {
    this.socket = null;
    this.onData = null;
    this.onPorts = null;
    this.onOpenSuccess = null;
    this.onOpenFail = null;
    this.isConnected = false;
    this.serialBuffer = "";
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.socket.onopen =
          this.socket.onclose =
          this.socket.onerror =
          this.socket.onmessage =
            null;
        this.socket.close();
      }

      this.socket = new WebSocket(url);
      this.socket.onopen = () => {
        this.isConnected = true;
        resolve();
      };
      this.socket.onclose = () => {
        this.isConnected = false;
      };
      this.socket.onerror = (err) => {
        this.isConnected = false;
        reject(err);
      };

      this.socket.onmessage = (event) => {
        const msg = event.data;
        if (this.onData) this.onData(msg);

        try {
          const json = JSON.parse(msg);
          if (json.SerialPorts && this.onPorts) this.onPorts(json.SerialPorts);
          if (json.Cmd === "Open") this.onOpenSuccess?.(json.Port);
          if (json.Cmd === "OpenFail") this.onOpenFail?.(json.Desc);

          // DATA ASSEMBLY: Glue chunks into lines
          if (json.D !== undefined) {
            this.serialBuffer += json.D;
            let newlineIdx;
            while ((newlineIdx = this.serialBuffer.indexOf("\n")) !== -1) {
              const completeLine = this.serialBuffer
                .slice(0, newlineIdx)
                .trim();
              this.serialBuffer = this.serialBuffer.slice(newlineIdx + 1);

              if (completeLine.length > 0) {
                // Dispatch for Controller to hear
                document.dispatchEvent(
                  new CustomEvent("MACHINE_FEEDBACK", { detail: completeLine }),
                );
              }
            }
          }
        } catch (e) {}
      };
    });
  }

  // Raw command (use for list, version, etc)
  send(msg) {
    if (this.isConnected) this.socket.send(msg.trim() + "\n");
  }

  // THE FIX: Strict Packet Send
  // This uses the SPJS 'sendjson' command for hardware-level handshaking
  sendJson(port, gcode, id) {
    if (!this.isConnected) return;
    const packet = {
      P: port,
      Data: [{ D: gcode.trim() + "\n", Id: id.toString() }],
    };
    this.socket.send("sendjson " + JSON.stringify(packet) + "\n");
  }

  list() {
    this.send("list");
  }

  // Use tinyg_linemode for COM3
  open(port, baud = 115200, buffer = "tinyg_linemode") {
    if (this.isConnected) {
      this.socket.send(`open ${port} ${baud} ${buffer}\n`);
    }
  }
}
