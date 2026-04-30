// js/visualizer/history.js
//version no. 1.0

export class HistoryManager {
  constructor(visualizer, maxHistory = 30) {
    this.viz = visualizer;
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = maxHistory;
    this.isRestoring = false;
  }

  record() {
    if (this.isRestoring) return;

    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    const snapshot = {
      placedInstances: JSON.parse(JSON.stringify(this.viz.placedInstances)),
      loadedFabric: JSON.parse(JSON.stringify(this.viz.loadedFabric)),
      fabricOffset: JSON.parse(JSON.stringify(this.viz.fabricOffset)),
      nestingMaskPoly: JSON.parse(
        JSON.stringify(this.viz.selection.nestingMaskPoly),
      ),
    };

    this.history.push(snapshot);
    if (this.history.length > this.maxHistory + 1) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }
  }

  undo() {
    if (this.historyIndex > 0) {
      this.isRestoring = true;
      this.historyIndex--;
      this.applySnapshot(this.history[this.historyIndex]);
      this.isRestoring = false;
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.isRestoring = true;
      this.historyIndex++;
      this.applySnapshot(this.history[this.historyIndex]);
      this.isRestoring = false;
    }
  }

  applySnapshot(snapshot) {
    this.viz.placedInstances = JSON.parse(
      JSON.stringify(snapshot.placedInstances),
    );
    this.viz.loadedFabric = JSON.parse(JSON.stringify(snapshot.loadedFabric));
    this.viz.fabricOffset = JSON.parse(JSON.stringify(snapshot.fabricOffset));
    this.viz.selection.nestingMaskPoly = JSON.parse(
      JSON.stringify(snapshot.nestingMaskPoly),
    );

    this.viz.selection.clear();

    localStorage.setItem("savedFabric", JSON.stringify(this.viz.loadedFabric));
    localStorage.setItem(
      "savedFabricOffset",
      JSON.stringify(this.viz.fabricOffset),
    );
    localStorage.setItem(
      "savedInstances",
      JSON.stringify(this.viz.placedInstances),
    );

    document.dispatchEvent(
      new CustomEvent("SYNC_QUEUE", { detail: this.viz.placedInstances }),
    );
    document.dispatchEvent(new CustomEvent("SELECTION_CHANGED"));
  }
}
