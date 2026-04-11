# Tangential Knife CNC & CAM Controller (v3.8)

A modular, web-based control suite specifically designed for tangential knife cutting systems with infinite Y-axis conveyor capabilities. Built on a decoupled ES6 architecture for high-speed hardware communication and real-time geometry processing.

## 🏗️ System Architecture
The application has been refactored from a monolithic script into a modular component-based system:

* **Core (`/js/core`)**:
    * `machine.js`: The "Single Source of Truth." Manages high-precision global state, axis configurations, and coordinate tracking.
    * `spjs.js`: Low-latency WebSocket client for Serial Port JSON Server (SPJS) communication.
* **UI Components (`/js/ui`)**:
    * `window.js`: An extensible Widget Window manager with minimization and custom header controls.
    * `dro.js`: High-precision Digital Readout (4 decimal places) with integrated Logarithmic Jogging and Feedhold safety logic.
    * `connection.js`: Hardware abstraction layer managing serial port handshaking and machine-specific parameter tuning.
* **Visualizer (`/js/visualizer`)**:
    * `canvas.js`: Full-screen hardware-accelerated drawing environment (Ready for G-Code & Fabric visualization).

## 🚀 Key Features
* **Logarithmic Absolute Jogging**: Maps linear slider input (0-100%) to a logarithmic scale (0.01mm - 100mm) for both microscopic precision and rapid machine traversal.
* **Intelligent Homing Sequence**: Tiered homing logic ($Z \rightarrow A \rightarrow X \rightarrow Y$) that detects both Min (`sn`) and Max (`sx`) limit switches.
* **Feedhold & Recovery**: Real-time hardware interrupt system (`!`) with a recovery context menu to **Resume** or **Clear** buffers while maintaining absolute coordinate integrity.
* **Dynamic Configuration Modal**: On-the-fly tuning of every TinyG parameter (Velocity, Jerk, Travel, etc.) with delta-only patching to hardware.
* **Modular Data Routing**: Implementation of a streaming data buffer to handle fragmented serial packets and ensure valid JSON parsing.

## ⚙️ Technical Specs
- **Work Area**: 1600mm (X) x Infinite (Y-Conveyor)
- **Precision**: 0.0001mm tracking
- **Communication**: WebSocket via SPJS
- **Frontend**: Vanilla ES6+, CSS3 (Grid/Flexbox), HTML5 Canvas

## 📅 Roadmap
- [ ] **Visualizer Engine**: Implementation of the 20mm tool symbol with radial A-axis vector.
- [ ] **Geometry Module**: DXF parsing and cleaning of Clo3D pattern outputs.
- [ ] **Fabric Management**: Local persistence of fabric types and "cut-history" remnants using IndexedDB.
- [ ] **The Tangential Engine**: Automatic A-axis path-following post-processor.
- [ ] **Nesting & Job Queue**: Multi-part placement and execution management.