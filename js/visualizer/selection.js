// js/visualizer/selection.js
//version no. 1.0

export class SelectionManager {
  constructor() {
    this.items = new Set();
    this.box = null;
    this.nestingMaskBox = null; // The raw rectangle the user dragged
    this.nestingMaskPoly = null; // The final ClipperLib intersection with the fabric
  }

  clear() {
    this.items.clear();
    this.notify();
  }

  add(instance) {
    this.items.add(instance);
    this.notify();
  }

  remove(instance) {
    this.items.delete(instance);
    this.notify();
  }

  toggle(instance) {
    if (this.items.has(instance)) this.items.delete(instance);
    else this.items.add(instance);
    this.notify();
  }

  isSelected(instance) {
    return this.items.has(instance);
  }

  getAll() {
    return Array.from(this.items);
  }

  startBox(x, y) {
    this.box = { startX: x, startY: y, endX: x, endY: y };
  }

  updateBox(x, y) {
    if (this.box) {
      this.box.endX = x;
      this.box.endY = y;
    }
  }

  clearBox() {
    this.box = null;
  }

  // Helper to check if an instance is inside the current selection box
  getInstancesInBox(instances, offsetX, offsetY) {
    if (!this.box) return [];

    const minX = Math.min(this.box.startX, this.box.endX);
    const maxX = Math.max(this.box.startX, this.box.endX);
    const minY = Math.min(this.box.startY, this.box.endY);
    const maxY = Math.max(this.box.startY, this.box.endY);

    return instances.filter((inst) => {
      // Check if the piece's centroid or bounding box intersects our selection box
      let inBounds = false;
      for (const v of inst.piece.vertices) {
        const wx = inst.x + v.x + offsetX;
        const wy = inst.y + v.y + offsetY;
        if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) {
          inBounds = true;
          break;
        }
      }
      return inBounds;
    });
  }

  startNestingMask(x, y) {
    this.nestingMaskBox = { startX: x, startY: y, endX: x, endY: y };
  }

  updateNestingMask(x, y) {
    if (this.nestingMaskBox) {
      this.nestingMaskBox.endX = x;
      this.nestingMaskBox.endY = y;
    }
  }

  clearNestingMask() {
    this.nestingMaskBox = null;
    this.nestingMaskPoly = null;
    console.log("Local Nesting Mask Cleared");
  }

  notify() {
    document.dispatchEvent(
      new CustomEvent("SELECTION_CHANGED", { detail: this.getAll() }),
    );
  }
}
