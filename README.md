# System Update Architecture & Changelog: The "Glass HUD & Vector" Update

This document serves as a comprehensive, technical breakdown of the recent architectural overhaul applied to the UI, Visualizer, and Core CNC logic. The system has been transitioned from a static, sidebar-bound layout into a dynamic, event-driven floating HUD environment with highly optimized performance loops.

---

## 1. Window Management & Glassmorphic UI (`window.js` & CSS Modules)

### CSS Modularization

The monolithic `style.css` was fully decommissioned and split into domain-specific modules (`main.css`, `window.css`, `dro.css`, `browser.css`, `queue.css`, `modals.css`, and `hud.css`). This significantly reduces CSS recalculation overhead and isolates UI boundaries.

- **The Empty Node Fix:** Applied `:empty` pseudo-classes to dynamically generated `.status-text` elements, preventing the browser from rendering orphaned padding boxes (the "floating hyphens") when status spans are unpopulated.

### Dynamic Window Engine (`WidgetWindow`)

The floating window class has been entirely rewritten to support true fluid behavior and absolute z-index stacking.

- **Race Condition Resolution:** Implemented a 50ms asynchronous deferral on boot up (`checkSnapOnLoad`), guaranteeing all windows are instantiated with their `localStorage` coordinates before the stacking engine attempts to mathematically sort them.
- **Fluid Resizing:** Unlocked horizontal resizing boundaries. Bound native `mousedown` event listeners to left/right border invisible resizers, intercepting standard cursor interactions with `e.preventDefault()` to stop unintended text highlighting.
- **The "Shrink-Wrap" AutoFit Engine:** Solved the Flexbox DOM measurement dilemma. When `.autoFit` is triggered, the engine invisibly strips the `400px` minimum CSS height, forces a synchronous DOM reflow (`offsetHeight`), calculates the exact pixel footprint of the child elements, and restores the CSS boundaries before the next animation frame. This allows dynamic windows (like the Job Queue and File Browser) to perfectly hug their contents.

---

## 2. The Vector Drive & CNC Controller (`controller.js`)

The gamepad input engine has been upgraded to support high-speed streaming without sacrificing cornering accuracy.

- **Delta Angle Snapping:** Previously, extreme changes in the Left Joystick trajectory would result in rounded corners due to the G-Code commands already waiting in the TinyG buffer. The new engine stores the `drivingAngle` from the previous 50ms frame and compares it against the active input.
- **Buffer Flushing:** If a flick or sharp turn exceeds the `angleSnapThreshold` (~20 degrees / 0.35 radians), the system bypasses standard deceleration, instantly broadcasting a Feed Hold (`!`) and Queue Flush (`%`). The very next 50ms cycle then begins a fresh vector stride from the absolute true physical location.
- **Y-Axis Toggle State:** Hardcoded the Y button to act as an absolute offset toggle (+/- 450mm) for material reveal, ensuring it interacts cleanly with standard XYZA homing routines.

---

## 3. The Visualizer & Dynamic Camera (`canvas.js`)

The Canvas engine transitioned from an array-diffing loop to a high-efficiency 1:1 event-based listener system, significantly dropping CPU load during DOM manipulation.

### Event-Driven Sync

- Replaced the heavy `syncQueueState` function. The canvas now listens natively to `SPAWN_INSTANCE` and `REMOVE_INSTANCE` events.
- Instances are spawned using a fast bounding-box sweep if fabric is present, or a cascading diagonal mathematical offset if no fabric exists, preventing visual overlap.
- Removal operates on a reverse iteration loop (`i--`), ensuring only the absolute newest placement of a given ID is popped from the visual array.

### The Dynamic Camera (`focusView`)

The static zoom has been replaced by an autonomous framing engine.

- When no fabric is active, the camera scales the world to 60%, perfectly centering the physical machine gantry on the screen for comfortable jogging operations.
- **Width-Lock Math:** When fabric is loaded, the camera strips Y-axis constraints from its scale calculations to prevent "Infinite Roll" zooming. It calculates the `minX` and `maxX` boundaries of the newly traced fabric, applies a 10% breathing margin, and fits it exactly horizontally between the floating HUD windows.
- **Y-Axis Inversion Fix:** The target Y coordinate locks to the `maxY` world coordinate (the top edge in CAD space) and perfectly aligns it with the physical tool location.

### Bounding Box Hover Projections

- Intercepts `HOVER_PREVIEW` events from the nesting leaderboard.
- Draws the selected genetic iteration in a light-grey ghost wash directly over the active blue configuration.
- Computes absolute min/max coordinate sweeps across all previewed shapes dynamically in the render loop, projecting a faint dashed blue bounding box to indicate total material consumption.

---

## 4. Job Builder & Queue Engine (`queue.js`)

Completely abandoned the vertical stack design for an ultra-compressed horizontal grid layout.

- **Direct Manipulation UX:** Removed bulky increment/decrement buttons. Hovering over a pattern now displays a single floating delete anchor. Left-clicking the thumbnail dispatches an addition; right-clicking intercepts the browser's context menu to dispatch a subtraction.
- **Absolute Positioning Constraints:** Items are locked to a strict 32x32px CSS grid with `flex-shrink: 0`, and the quantity label floats directly inside the `canvas` element to prevent DOM reflow shifting during incrementation.

---

## 5. Genetic Algorithm & Leaderboard (`worker.js` & `ranking.js`)

The Web Worker architecture driving the NFP (No-Fit Polygon) engine has been modified to stream real-time results rather than waiting for generational completion.

### Live Telemetry

- The Worker intercepts the population array every 10% step. It calculates the overall `genProgress` and streams the current state of the global top 10 layouts back to the main thread.
- **Dual Progress Bars:** The Ranking UI grabs this telemetry and draws two overlapping transparent progress bars directly into the parent window's header (`.window-header` background injection). Blue represents total completion, while green visually beats with the current generation's scan rate.

### The Historical Snapshot Engine

- When the user presses "▶ RUN NEST", the UI freezes the active layout state.
- It calculates the absolute top 3 layouts from the prior run (or the top 2 + the actively selected outlier layout).
- These specific iterations are injected with a `isRetained` flag, mapping them to persistent `Prev-1`, `Prev-2` ID labels. They are segregated below a visual divider, preserving a timeline of previous genetic elites alongside the live incoming data stream.

---

## 6. System Utility Refinements

- **DRO Expansion:** Stripped the `200px` fixed-width limit from the DRO (`dro.js`). The jogging pad now utilizes standard `100%` CSS Grid fractionals, expanding fluidly to fill any dimensions dragged by the user.
- **File Browser Date Sort:** Added a recursive `mtime` sorting algorithm to `browser.js`. The DOM injection now natively extracts timestamp metadata, pushing the most recently modified DXF files to the top of their respective folders, while displaying an inline "Oct 24, 2:30 PM" tag beneath the file ID.
- **Modal Layer Management:** Forced `fabricTracer.js` to utilize explicit `z-index: 9999` constraints, escaping the local DOM stacking context to ensure instructions overlay the active Gantry visuals while preserving the `pointer-events` pass-through necessary to operate the DRO controls simultaneously.
