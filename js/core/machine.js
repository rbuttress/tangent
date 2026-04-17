//js/core/machine.js
//version no. 1.0

export class MachineState {
    constructor() {
        this.currentPos = { x: 0, y: 0, z: 0, a: 0 };
        this.targetPos = { x: 0, y: 0, z: 0, a: 0 };
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

// js/core/machine.js

updatePosition(sr) {
    let changed = false;
    ['x', 'y', 'z', 'a'].forEach(ax => {
        if (sr[`pos${ax}`] !== undefined) {
            // Check if value actually changed to avoid unnecessary notifies
            if (this.currentPos[ax] !== sr[`pos${ax}`]) {
                this.currentPos[ax] = sr[`pos${ax}`];
                changed = true;
            }
        }
    });
    
    if (sr.stat !== undefined && this.status !== sr.stat) {
        this.status = sr.stat;
        changed = true;
        
        // If we just finished homing or stopped, force a config refresh
        // to make sure we have the latest offsets
        if (this.status === 3 || this.status === 1) {
            // We can't call spjs from here (circular dependency), 
            // so we rely on the notify to let the UI handle it.
        }
    }

    if (changed) this.notify();
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