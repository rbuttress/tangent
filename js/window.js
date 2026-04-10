//version no. 1.3
export class WidgetWindow {
    constructor(id, title, x, y, width = 350) {
        this.el = document.createElement('div');
        this.el.id = id;
        this.el.className = 'window';
        this.el.style.left = x + 'px';
        this.el.style.top = y + 'px';
        this.el.style.width = width + 'px';

        this.el.innerHTML = `
            <div class="resizer-l"></div>
            <div class="window-header">
                <div class="window-title-area">
                    <span class="window-title">${title}</span>
                    <span class="status-text">Disconnected</span>
                </div>
                <div class="window-controls"><button class="min-btn">_</button></div>
            </div>
            <div class="window-content"></div>
            <div class="resizer-r"></div>
        `;

        document.getElementById('ui-layer').appendChild(this.el);
        this.content = this.el.querySelector('.window-content');
        this.statusEl = this.el.querySelector('.status-text');
        this.initEvents();
    }

    setStatus(text, isOnline = false) {
        this.statusEl.innerText = text;
        this.statusEl.classList.toggle('online', isOnline);
    }

    initEvents() {
        const header = this.el.querySelector('.window-header');
        const minBtn = this.el.querySelector('.min-btn');
        const resizerR = this.el.querySelector('.resizer-r');
        const resizerL = this.el.querySelector('.resizer-l');
        const snapLimit = 5;

        minBtn.onclick = () => this.el.classList.toggle('minimized');

        // --- Dragging Logic ---
        header.onmousedown = (e) => {
            if (['BUTTON', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;
            let startX = e.clientX - this.el.offsetLeft;
            let startY = e.clientY - this.el.offsetTop;

            const onMove = (e) => {
                let newX = e.clientX - startX;
                let newY = e.clientY - startY;

                // Snap to edges
                if (newX < snapLimit) newX = 0;
                if (window.innerWidth - (newX + this.el.offsetWidth) < snapLimit) {
                    newX = window.innerWidth - this.el.offsetWidth;
                }

                this.el.style.left = newX + 'px';
                this.el.style.top = Math.max(0, newY) + 'px';
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', () => document.removeEventListener('mousemove', onMove), {once:true});
        };

        // --- Resizing Logic (Right) ---
        resizerR.onmousedown = (e) => {
            const onMove = (e) => {
                let newWidth = e.clientX - this.el.offsetLeft;
                if (window.innerWidth - e.clientX < snapLimit) newWidth = window.innerWidth - this.el.offsetLeft;
                this.el.style.width = Math.max(200, newWidth) + 'px';
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', () => document.removeEventListener('mousemove', onMove), {once:true});
        };

        // --- Resizing Logic (Left) ---
        resizerL.onmousedown = (e) => {
            let startX = e.clientX;
            let startWidth = this.el.offsetWidth;
            let startLeft = this.el.offsetLeft;

            const onMove = (e) => {
                let diff = startX - e.clientX;
                let newLeft = startLeft - diff;
                let newWidth = startWidth + diff;

                if (newLeft < snapLimit) {
                    newWidth = startWidth + startLeft;
                    newLeft = 0;
                }

                if (newWidth > 200) {
                    this.el.style.left = newLeft + 'px';
                    this.el.style.width = newWidth + 'px';
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', () => document.removeEventListener('mousemove', onMove), {once:true});
        };
    }
}