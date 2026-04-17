//js/visualizer/canvas.js
//version no. 2.4
import { machine } from '../core/machine.js';

export class Visualizer {
    constructor(canvasId, controller) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.controller = controller; // Reference for joystick heading
        
        this.viewport = {
            offsetX: 0,
            offsetY: 0,       // Current smoothed gantry position
            targetY: 0,       // Destination for smooth scroll
            scale: 1.0
        };

        this.bounds = { width: 1600 };
        this.toolRadius = 10; // 20mm diameter

        this.init();
    }

    gantryToPx(x) {
        return {
            x: this.viewport.offsetX + (x * this.viewport.scale),
            y: this.viewport.offsetY
        };
    }

    worldToPx(x, y) {
        const machineY = machine.currentPos.y;
        return {
            x: this.viewport.offsetX + (x * this.viewport.scale),
            y: this.viewport.offsetY - ((y - machineY) * this.viewport.scale)
        };
    }

    init() {
        window.addEventListener('resize', () => this.resize());
        this.canvas.addEventListener('wheel', (e) => this.handleScroll(e), { passive: false });
        
        this.resize();
        this.viewport.offsetY = window.innerHeight / 2;
        this.viewport.targetY = this.viewport.offsetY;

        this.animate();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        const availableWidth = window.innerWidth - 100;
        this.viewport.scale = availableWidth / this.bounds.width;
        if (this.viewport.scale > 1.2) this.viewport.scale = 1.2;
        this.viewport.offsetX = (window.innerWidth - (this.bounds.width * this.viewport.scale)) / 2;
    }

    handleScroll(e) {
        e.preventDefault();
        const scrollSensitivity = 0.8; 
        this.viewport.targetY -= e.deltaY * scrollSensitivity;
    }

    animate() {
        const lerpFactor = 0.05;
        const diff = this.viewport.targetY - this.viewport.offsetY;
        
        if (Math.abs(diff) > 0.1) {
            this.viewport.offsetY += diff * lerpFactor;
        } else {
            this.viewport.offsetY = this.viewport.targetY;
        }

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.drawGrid();
        this.drawHeading(); // Vector Preview
        this.drawTool();    // Physical Machine

        requestAnimationFrame(() => this.animate());
    }

    drawGrid() {
        const { ctx, viewport, bounds, canvas } = this;
        const machineY = machine.currentPos.y;
        const leftEdge = this.viewport.offsetX;
        const rightEdge = this.viewport.offsetX + (bounds.width * viewport.scale);

        ctx.strokeStyle = '#d0d0d0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftEdge, 0); ctx.lineTo(leftEdge, canvas.height);
        ctx.moveTo(rightEdge, 0); ctx.lineTo(rightEdge, canvas.height);
        ctx.stroke();

        const dotSpacing = 10;
        ctx.fillStyle = '#bbb';
        const startY = Math.floor((machineY - (viewport.offsetY / viewport.scale)) / dotSpacing) * dotSpacing;
        const endY = startY + Math.floor(canvas.height / viewport.scale) + (dotSpacing * 2);

        for (let x = 0; x <= bounds.width; x += dotSpacing) {
            for (let y = startY; y <= endY; y += dotSpacing) {
                const screenPos = this.worldToPx(x, y);
                ctx.fillRect(screenPos.x - 0.5, screenPos.y - 0.5, 1, 1);
            }
        }

        ctx.strokeStyle = 'rgba(153, 0, 0, 0.4)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(leftEdge, viewport.offsetY);
        ctx.lineTo(rightEdge, viewport.offsetY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    drawHeading() {
        const { ctx, controller } = this;
        if (!controller || controller.activeAngle === null) return;

        const pos = machine.currentPos;
        const screenPos = this.gantryToPx(pos.x);
        
        const gp = navigator.getGamepads()[0];
        const lt = gp ? gp.buttons[6].value : 0;
        
        // Line length scales with LT pressure: 20px base + up to 100px extension
        const vectorLen = 20 + (lt * 100); 
        
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(screenPos.x, screenPos.y);
        ctx.lineTo(
            screenPos.x + Math.cos(controller.activeAngle) * vectorLen,
            screenPos.y - Math.sin(controller.activeAngle) * vectorLen
        );
        
        ctx.strokeStyle = `rgba(153, 0, 0, ${0.3 + (lt * 0.7)})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        
        // Arrowhead/Tip indicator
        ctx.fillStyle = `rgba(153, 0, 0, ${0.3 + (lt * 0.7)})`;
        ctx.beginPath();
        ctx.arc(
            screenPos.x + Math.cos(controller.activeAngle) * vectorLen,
            screenPos.y - Math.sin(controller.activeAngle) * vectorLen,
            3, 0, Math.PI * 2
        );
        ctx.fill();
        ctx.restore();
    }

    drawTool() {
        const { ctx, viewport } = this;
        const pos = machine.currentPos;
        const screenPos = this.gantryToPx(pos.x);

        // Z-Depth Visual
        const zLimit = -13;
        const zCurrent = Math.max(zLimit, Math.min(0, pos.z)); 
        const zProgress = zCurrent / zLimit; 
        const currentDia = 20 - (zProgress * 19);
        const currentAlpha = 0.1 + (zProgress * 0.9);

        ctx.save();
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, currentDia / 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(153, 0, 0, ${currentAlpha})`;
        ctx.fill();
        ctx.restore();

        // Tool Border
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, this.toolRadius * viewport.scale, 0, Math.PI * 2);
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 1;
        ctx.stroke();

        // A-Axis Vector (Knife Rotation)
        const adjustedAngle = Math.PI - pos.a; 
        const lineLen = this.toolRadius * viewport.scale;
        
        ctx.fillStyle = '#900';
        ctx.beginPath(); 
        ctx.arc(screenPos.x, screenPos.y, 1.5, 0, Math.PI * 2); 
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(screenPos.x, screenPos.y);
        ctx.lineTo(
            screenPos.x + Math.cos(adjustedAngle) * lineLen,
            screenPos.y + Math.sin(adjustedAngle) * lineLen
        );
        ctx.strokeStyle = '#900';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}