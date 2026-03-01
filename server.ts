import express from "express";
import { createServer as createViteServer } from "vite";
import { JSONFilePreset } from 'lowdb/node';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Database setup
  // @ts-ignore
  const defaultData = { veiculos: [], movements: [], users: [], tanque: [] };
  const db = await JSONFilePreset('db.json', defaultData);

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/data", (req, res) => {
    res.json(db.data);
  });

  app.post("/api/put/:storeName", async (req, res) => {
    const { storeName } = req.params;
    const item = req.body;
    
    // @ts-ignore
    if (!db.data[storeName]) db.data[storeName] = [];
    
    // @ts-ignore
    const index = db.data[storeName].findIndex((i: any) => i.id === item.id);
    if (index > -1) {
      // @ts-ignore
      db.data[storeName][index] = item;
    } else {
      // @ts-ignore
      db.data[storeName].push(item);
    }
    
    await db.write();
    res.json({ success: true });
  });

  app.delete("/api/delete/:storeName/:id", async (req, res) => {
    const { storeName, id } = req.params;
    // @ts-ignore
    if (db.data[storeName]) {
      // @ts-ignore
      db.data[storeName] = db.data[storeName].filter((i: any) => i.id !== id);
      await db.write();
    }
    res.json({ success: true });
  });

  app.post("/api/import", async (req, res) => {
    db.data = req.body;
    await db.write();
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
