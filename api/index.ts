import express from 'express';
import cors from 'cors';
import path from 'path';
import { JSONFilePreset } from 'lowdb/node';
import { VeiculoEquipamento, MovimentoTanque, Tanque, AppUser } from '../types';

interface Data {
  veiculos: VeiculoEquipamento[];
  movements: MovimentoTanque[];
  tanque: Tanque[];
  users: AppUser[];
}

const defaultData: Data = {
  veiculos: [],
  movements: [],
  tanque: [
    { id: 'britagem', nome: 'Tanque Britagem', capacidade_litros: 11000, saldo_atual: 0 },
    { id: 'obra', nome: 'Tanque Obra', capacidade_litros: 3000, saldo_atual: 0 }
  ],
  users: [{
    id: 'admin-id',
    login: 'ADM',
    password: 'ADM',
    role: 'admin',
    name: 'Administrador'
  }]
};

// Database setup
let db: any;

async function initDb() {
  if (!db) {
    // No Render/Railway, usamos o diretório atual ou um volume persistente
    const dbPath = process.env.PERSISTENT_DISK_PATH 
      ? `${process.env.PERSISTENT_DISK_PATH}/db.json` 
      : 'db.json';
    db = await JSONFilePreset<Data>(dbPath, defaultData);
  }
  return db;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API Routes
app.get('/api/data', async (req, res) => {
  const database = await initDb();
  res.json(database.data);
});

app.post('/api/put/:store', async (req, res) => {
  const database = await initDb();
  const { store } = req.params;
  const item = req.body;
  
  if (store === 'veiculos') {
    const index = database.data.veiculos.findIndex((v: any) => v.id === item.id);
    if (index > -1) database.data.veiculos[index] = item;
    else database.data.veiculos.push(item);
  } else if (store === 'movements') {
    const index = database.data.movements.findIndex((m: any) => m.id === item.id);
    if (index > -1) database.data.movements[index] = item;
    else database.data.movements.push(item);
  } else if (store === 'users') {
    const index = database.data.users.findIndex((u: any) => u.id === item.id);
    if (index > -1) database.data.users[index] = item;
    else database.data.users.push(item);
  } else if (store === 'tanque') {
    const index = database.data.tanque.findIndex((t: any) => t.id === item.id);
    if (index > -1) database.data.tanque[index] = item;
    else database.data.tanque.push(item);
  }

  await database.write();
  res.json({ success: true });
});

app.delete('/api/delete/:store/:id', async (req, res) => {
  const database = await initDb();
  const { store, id } = req.params;
  
  if (store === 'veiculos') {
    database.data.veiculos = database.data.veiculos.filter((v: any) => String(v.id) !== String(id));
  } else if (store === 'movements') {
    database.data.movements = database.data.movements.filter((m: any) => String(m.id) !== String(id));
  } else if (store === 'users') {
    database.data.users = database.data.users.filter((u: any) => String(u.id) !== String(id));
  } else if (store === 'tanque') {
    database.data.tanque = database.data.tanque.filter((t: any) => String(t.id) !== String(id));
  }

  await database.write();
  res.json({ success: true });
});

app.post('/api/import', async (req, res) => {
  const database = await initDb();
  database.data = req.body;
  await database.write();
  res.json({ success: true });
});

// Vite middleware for development
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.RENDER || process.env.RAILWAY || process.env.K_SERVICE;

if (!isProduction) {
  try {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } catch (e) {
    console.warn('Vite not found, falling back to static serving');
    app.use(express.static('dist'));
  }
} else {
  app.use(express.static('dist'));
  // Fallback para SPA em produção
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const indexPath = path.resolve('dist/index.html');
    res.sendFile(indexPath);
  });
}

// Only listen if not running as a Vercel function
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
