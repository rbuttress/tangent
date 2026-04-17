//js/core/controller.js
//version no. 4.1
import { machine } from './machine.js';

export class ControllerManager {
    constructor(spjs) {
        this.spjs = spjs;
        this.gamepadIndex = null;
        this.onInput = null;
        
        this.virtualTarget = null;
        this.wasDriving = false; 

        // State for the Y-Axis material reveal toggle
        this.isYExtended = false;

        this.config = {
            deadzone: 0.5,
            ltThreshold: 0.15,
            minFeed: 800,
            maxFeed: 4000,
            pollInterval: 50 
        };

        this.activeAngle = null;
        this.buttonStates = {}; 

        window.addEventListener("gamepadconnected", (e) => this.gamepadIndex = e.gamepad.index);
    }

    start() {
        const visualLoop = () => {
            this.updateHeadingOnly();
            requestAnimationFrame(visualLoop);
        };
        visualLoop();

        setInterval(() => {
            this.processMachineInputs();
        }, this.config.pollInterval);
    }

    updateHeadingOnly() {
        if (this.gamepadIndex === null) return;
        const gp = navigator.getGamepads()[this.gamepadIndex];
        if (!gp) return;

        const lx = gp.axes[0];
        const ly = gp.axes[1];
        const mag = Math.hypot(lx, ly);
        
        if (mag > this.config.deadzone) {
            this.activeAngle = Math.atan2(-ly, lx); 
        } else {
            this.activeAngle = null;
        }
    }

    processMachineInputs() {
        if (this.gamepadIndex === null) return;
        const gp = navigator.getGamepads()[this.gamepadIndex];
        const port = localStorage.getItem('last-port');
        if (!gp || !port) return;

        // Modifier Bumpers
        const lb = gp.buttons[4].pressed;
        const rb = gp.buttons[5].pressed;

        // --- FACE BUTTON CHORDS ---

        // A Button (Index 0) -> A Axis
        this.handleButton(0, gp.buttons[0].pressed, () => {
            if (lb && rb) {
                this.spjs.send(`send ${port} G90 G0 A0`);
                this.log("Go to A 0");
            } else if (lb) {
                this.spjs.send(`send ${port} G28.2 A0`);
                this.log("Homing A Axis...");
            } else if (rb) {
                this.spjs.send(`send ${port} G28.3 A0`);
                this.log("Zeroing A Axis...");
            }
        });

        // B Button (Index 1) -> Z Axis & E-Stop
        this.handleButton(1, gp.buttons[1].pressed, () => {
            if (lb && rb) {
                this.spjs.send(`send ${port} G90 G0 Z0`);
                this.log("Go to Z 0");
            } else if (lb) {
                this.spjs.send(`send ${port} G28.2 Z0`);
                this.log("Homing Z Axis...");
            } else if (rb) {
                this.spjs.send(`send ${port} G28.3 Z0`);
                this.log("Zeroing Z Axis...");
            } else {
                // If NO bumpers are pressed, B is Emergency Stop
                this.triggerStop(port, "B BUTTON: Emergency Stop");
            }
        });

        // X Button (Index 2) -> X Axis
        this.handleButton(2, gp.buttons[2].pressed, () => {
            if (lb && rb) {
                this.spjs.send(`send ${port} G90 G0 X0`);
                this.log("Go to X 0");
            } else if (lb) {
                this.spjs.send(`send ${port} G28.2 X0`);
                this.log("Homing X Axis...");
            } else if (rb) {
                this.spjs.send(`send ${port} G28.3 X0`);
                this.log("Zeroing X Axis...");
            }
        });

        // Y Button (Index 3) -> Y Axis & Reveal Toggle
        this.handleButton(3, gp.buttons[3].pressed, () => {
            if (lb && rb) {
                this.spjs.send(`send ${port} G90 G0 Y0`);
                this.log("Go to Y 0");
            } else if (lb) {
                // Home Z, A, X normally, but only Zero the Y axis.
                this.spjs.send(`send ${port} G28.2 Z0 A0 X0`);
                setTimeout(() => this.spjs.send(`send ${port} G28.3 Y0`), 100);
                this.isYExtended = false; // Reset toggle state
                this.log("Homing Z, A, X and Zeroing Y...");
            } else if (rb) {
                this.spjs.send(`send ${port} G28.3 Y0`);
                this.isYExtended = false; // Reset toggle state
                this.log("Zeroing Y Axis...");
            } else {
                // Y by itself: Reveal Toggle
                if (this.isYExtended) {
                    this.spjs.send(`send ${port} G91 G0 Y50`);
                    this.spjs.send(`send ${port} G90`);
                    this.isYExtended = false;
                    this.log("Y Retracted (+50mm)");
                } else {
                    this.spjs.send(`send ${port} G91 G0 Y-50`);
                    this.spjs.send(`send ${port} G90`);
                    this.isYExtended = true;
                    this.log("Y Extended (-50mm)");
                }
            }
        });


        // --- VECTOR DRIVE LOGIC ---
        const lt = gp.buttons[6].value;

        if (this.activeAngle === null || lt <= this.config.ltThreshold) {
            if (this.wasDriving) {
                this.triggerStop(port, "Trigger Released: Stopped");
            }
            return;
        }

        if (!this.wasDriving) {
            this.wasDriving = true;
            this.virtualTarget = { ...machine.currentPos };
            this.spjs.send(`send ${port} G90`); 
        }

        if (machine.qr > 4) return;

        this.executeStreamingStride(lt, port);
    }

    executeStreamingStride(lt, port) {
        if (!this.virtualTarget) return;

        const pressure = (lt - this.config.ltThreshold) / (1 - this.config.ltThreshold);
        const feed = this.config.minFeed + (pressure * (this.config.maxFeed - this.config.minFeed));

        const stride = (feed / 60) * (this.config.pollInterval / 1000) * 1.5;

        const dx = Math.cos(this.activeAngle) * stride;
        const dy = Math.sin(this.activeAngle) * stride;

        this.virtualTarget.x += dx;
        this.virtualTarget.y += dy;

        const moveCmd = `G1 X${this.virtualTarget.x.toFixed(4)} Y${this.virtualTarget.y.toFixed(4)} F${Math.round(feed)}`;
        this.spjs.send(`send ${port} ${moveCmd}`);
        
        machine.targetPos.x = this.virtualTarget.x;
        machine.targetPos.y = this.virtualTarget.y;
        machine.notify();
    }

    triggerStop(port, msg) {
        this.spjs.send(`send ${port} !`);
        this.spjs.send(`send ${port} %`);

        setTimeout(() => {
            this.spjs.send(`send ${port} {"sr":""}`);
        }, 150);

        this.wasDriving = false;
        this.virtualTarget = null;
        this.log(msg);
    }

    handleButton(index, isPressed, callback) {
        if (isPressed && !this.buttonStates[index]) {
            callback();
        }
        this.buttonStates[index] = isPressed;
    }

    log(msg) {
        if (this.onInput) this.onInput(msg);
    }
}