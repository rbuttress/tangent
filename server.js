// full/dinner/server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const DxfParser = require("dxf-parser");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(cors());
app.use(express.json()); // REQUIRED: Allows Express to parse JSON POST requests

// Serve Static Files (Frontend)
const FRONTEND_DIR = __dirname;
app.use(express.static(FRONTEND_DIR));

// --- 2. DATABASE SETUP ---
// Create a fabrics.json file if it doesn't exist yet
const DB_FILE = path.join(__dirname, "fabrics.json");
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

// --- 3. API PATHS: DXF FILES ---
const DXF_DIR = path.join(__dirname, "../dxf");

function getFilesTree(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  return dirents
    .map((dirent) => {
      const res = path.resolve(dir, dirent.name);
      const relPath = path.relative(DXF_DIR, res);

      // THE FIX: Explicitly check the file's stats to get its modified date
      const stats = fs.statSync(res);

      if (dirent.isDirectory()) {
        return {
          name: dirent.name,
          type: "folder",
          path: relPath,
          mtime: stats.mtime, // Attach to folder so the tree sorts recently edited folders to the top
          children: getFilesTree(res),
        };
      } else if (dirent.name.toLowerCase().endsWith(".dxf")) {
        return {
          name: dirent.name,
          type: "file",
          path: relPath,
          mtime: stats.mtime, // THE FIX: Attach the date to the file payload
        };
      }
    })
    .filter(Boolean);
}

app.get("/api/files", (req, res) => {
  res.json(getFilesTree(DXF_DIR));
});

app.get("/api/parse", (req, res) => {
  const fileRelPath = req.query.file;
  if (!fileRelPath) return res.status(400).json({ error: "No file specified" });

  const fullPath = path.join(DXF_DIR, fileRelPath);

  try {
    const content = fs.readFileSync(fullPath, "utf8");
    const parser = new DxfParser();
    const parsedData = parser.parseSync(content);
    res.json(parsedData);
  } catch (e) {
    console.error("DXF Parse Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- 4. API PATHS: FABRIC INVENTORY ---

// Get all fabrics
app.get("/api/fabrics", (req, res) => {
  try {
    const data = fs.readFileSync(DB_FILE, "utf8");
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(500).json({ error: "Failed to read database" });
  }
});

// Add a new fabric
app.post("/api/fabrics", (req, res) => {
  try {
    const newFabric = req.body;
    const currentData = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    currentData.push(newFabric);

    // Write back to file with pretty formatting (2 spaces)
    fs.writeFileSync(DB_FILE, JSON.stringify(currentData, null, 2));

    res.status(201).json({ success: true, fabric: newFabric });
  } catch (e) {
    console.error("Failed to save fabric:", e);
    res.status(500).json({ error: "Failed to save to database" });
  }
});

// Delete a fabric
app.delete("/api/fabrics/:id", (req, res) => {
  try {
    const currentData = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    const newData = currentData.filter((f) => f.id !== req.params.id);
    fs.writeFileSync(DB_FILE, JSON.stringify(newData, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to delete" });
  }
});

// Update an existing fabric
app.put("/api/fabrics/:id", (req, res) => {
  try {
    const currentData = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    const index = currentData.findIndex((f) => f.id === req.params.id);
    if (index !== -1) {
      // Merge the updated data, preserving the original edgeProfile if not overwritten
      currentData[index] = { ...currentData[index], ...req.body };
      fs.writeFileSync(DB_FILE, JSON.stringify(currentData, null, 2));
      res.json({ success: true, fabric: currentData[index] });
    } else {
      res.status(404).json({ error: "Fabric not found" });
    }
  } catch (e) {
    res.status(500).json({ error: "Failed to update" });
  }
});

// --- 5. FALLBACK & STARTUP ---
// If express.static misses the root request, serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`Dinner served at http://localhost:${PORT}`),
);
