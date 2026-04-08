//version no. 1.0
export class Visualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.drawPlaceholder();
    }

    drawPlaceholder() {
        this.ctx.fillStyle = '#121212';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw a simple grid
        this.ctx.strokeStyle = '#222';
        for(let i=0; i<this.canvas.width; i+=50) {
            this.ctx.beginPath(); this.ctx.moveTo(i,0); this.ctx.lineTo(i, this.canvas.height); this.ctx.stroke();
        }
        for(let i=0; i<this.canvas.height; i+=50) {
            this.ctx.beginPath(); this.ctx.moveTo(0,i); this.ctx.lineTo(this.canvas.width, i); this.ctx.stroke();
        }
    }
}