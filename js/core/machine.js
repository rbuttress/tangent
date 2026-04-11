//js/core/machine.js
//version no. 1.0

export class MachineState {
    constructor() {
        this.currentPos = { x: 0, y: 0, z: 0, a: 0 };
        this.config = { axes: { x: {}, y: {}, z: {}, a: {} } };
        this.status = "OFFLINE";
        this.qr = 0;
        this.listeners = [];
    }

    // Subscribe to changes
    onUpdate(callback) {
        this.listeners.push(callback);
    }

    notify() {
        this.listeners.forEach(cb => cb(this));
    }

    updatePosition(sr) {
        ['x', 'y', 'z', 'a'].forEach(ax => {
            if (sr[`pos${ax}`] !== undefined) {
                this.currentPos[ax] = sr[`pos${ax}`];
            }
        });
        if (sr.stat !== undefined) this.status = sr.stat;
        this.notify();
    }

    updateConfig(r) {
        ['x', 'y', 'z', 'a'].forEach(ax => {
            if (r[ax]) {
                this.config.axes[ax] = { ...this.config.axes[ax], ...r[ax] };
            }
        });
        this.notify();
    }
}

export const machine = new MachineState();