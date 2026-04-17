# TinyG Tangential Knife Controller

A web-based CNC sender and visualizer specifically designed for Tangential Knife cutting via TinyG and the Serial Port JSON Server (SPJS).

## Currently Implemented Features

* **Smart Connection Automation:** Automatically connects to SPJS, scans ports, and auto-resumes active TinyG socket connections on page refresh.
* **Vector Gamepad Drive:** Full Xbox controller support for real-time vector jogging. Utilizes dynamic stride calculation and queue metering for buttery-smooth diagonal movements without choking the hardware buffer.
* **Controller Chords:** Keep your hands on the gamepad. Use LB/RB modifiers + face buttons to Home or Zero the X, Y, Z, and A axes independently, plus a quick-toggle to reveal the material bed.
* **Absolute DRO Jogging:** UI-based jogging operates purely in Absolute (`G90`) coordinates, preventing mode-switching race conditions. 
* **Live Visualizer:** Real-time HTML5 Canvas visualization of the toolhead, including Z-depth color mapping and A-axis knife angle rotation.
* **Glassmorphism UI:** Floating, non-blocking transparent widget architecture.

## Project Roadmap

**Completed Phase 1: Core Motion & UI**
- [x] JSON / SPJS Handshake
- [x] Machine Movement & Status Polling
- [x] UI Jogging & Absolute Targeting
- [x] Visualizer Integration
- [x] Xbox Controller Integration
- [x] Console & Command Routing
- [x] Connection Automation

**Phase 2: File Management & Job Prep (Up Next)**
- [ ] Local File Browser
- [ ] Fabric Profile Creation (Editing, storage, and logic)
- [ ] DXF Block Parsing (Decoding CLO3D DXF output to Fabric types)
- [ ] Nesting Engine

**Phase 3: Execution**
- [ ] Job Planning
- [ ] DXF to XYZA G-code Generation
- [ ] Work Logic & Job Execution