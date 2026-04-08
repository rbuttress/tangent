TinyG Tangential Knife Controller
//version no. 1.0

A modular, web-based CNC interface built with ES Modules and Vanilla JavaScript. This project serves as a lightweight alternative to ChiliPeppr, optimized for controlling a 4-axis (XYZA) tangential knife cutter.

🏗 Project Structure
The application is split into three primary layers: the Backend (Node.js), the Communication Layer (SPJS Client), and the Visual Layer (Canvas & UI).

Plaintext
/cnc-controller
├── server.js           # Node.js/Express server to host the local UI
├── index.html          # HTML5 Shell; entry point for the application
├── style.css           # Global styles and floating widget layout
└── js/
    ├── main.js         # App Orchestrator; ties logic and UI together
    ├── spjs.js         # Connection Module; handles WebSocket logic for SPJS
    └── canvas.js       # Background Visualizer; handles the fullscreen grid
    
📂 File Descriptions
server.js
A minimalist Express server. While the frontend can run as a flat file, using a server prevents CORS issues and allows for future features like local G-code file parsing and saving machine configurations.

index.html
The "Layout" file. It defines a fullscreen <canvas> that stays fixed in the background and a #ui-layer div that holds floating widgets. It loads the logic using type="module".

style.css
Handles the "Dashboard" feel.

Background: The canvas is set to z-index: 1.

Foreground: Widgets are positioned absolutely with z-index: 10 and use pointer-events: auto so the background remains interactive where widgets aren't present.

js/spjs.js (The Driver)
An encapsulated Class (SpjsClient) that manages the WebSocket handshake with the Serial Port JSON Server.

Methods: connect(), list(), open(port).

Callbacks: Provides hooks for onPorts and onData so other modules can react to machine feedback without managing the socket themselves.

js/canvas.js (The View)
An encapsulated Class (Visualizer) that manages the background drawing context. It includes an automatic resize() listener to ensure the CNC grid always fills the browser window.

js/main.js (The Controller)
The central nervous system of the app. It imports the modules, instantiates the classes, and attaches event listeners to the DOM elements.

🚀 Getting Started
Start SPJS: Ensure the Serial Port JSON Server is running on your machine (default port 8989).

Install Dependencies:

Bash
npm install express
Run the Host:

Bash
node server.js
Access the UI: Navigate to http://localhost:3000 in any modern web browser.

🛠 Future Modules
DRO Widget: Real-time Digital Read Out for X, Y, Z, and A coordinates.

G-Code Parser: Logic to stream G-code files to TinyG via the SPJS buffer.

Tangential Logic: Mathematical transformation for the A-axis based on XY heading changes.