import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import { JSONFilePreset } from 'lowdb/node';
import { VeiculoEquipamento, MovimentoTanque, Tanque, AppUser } from './types.ts';

interface Data {
  veiculos: VeiculoEquipamento[];
  movements: MovimentoTanque[];
  tanque: Tanque[];
  users: AppUser[];
}

const defaultData: Data = {
  veiculos: [],
  movements: [],
  tanque: [{ id: 'main', nome: 'Reservatório Central', capacidade_litros: 11000, saldo_atual: 0 }],
  users: [{
    id: 'admin-id',
    login: 'ADM',
    password: 'ADM',
    role: 'admin',
    name: 'Administrador'
  }]
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Database setup
  const db = await JSONFilePreset<Data>('db.json', defaultData);

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get('/api/data', (req, res) => {
    res.json(db.data);
  });

  app.post('/api/put/:store', async (req, res) => {
    const { store } = req.params;
    const item = req.body;
    
    if (store === 'veiculos') {
      const index = db.data.veiculos.findIndex(v => v.id === item.id);
      if (index > -1) db.data.veiculos[index] = item;
      else db.data.veiculos.push(item);
    } else if (store === 'movements') {
      const index = db.data.movements.findIndex(m => m.id === item.id);
      if (index > -1) db.data.movements[index] = item;
      else db.data.movements.push(item);
    } else if (store === 'users') {
      const index = db.data.users.findIndex(u => u.id === item.id);
      if (index > -1) db.data.users[index] = item;
      else db.data.users.push(item);
    } else if (store === 'tanque') {
      const index = db.data.tanque.findIndex(t => t.id === item.id);
      if (index > -1) db.data.tanque[index] = item;
      else db.data.tanque.push(item);
    }

    await db.write();
    res.json({ success: true });
  });

  app.delete('/api/delete/:store/:id', async (req, res) => {
    const { store, id } = req.params;
    console.log(`Deleting from ${store} with id ${id}`);
    
    if (store === 'veiculos') {
      db.data.veiculos = db.data.veiculos.filter(v => String(v.id) !== String(id));
    } else if (store === 'movements') {
      db.data.movements = db.data.movements.filter(m => String(m.id) !== String(id));
    } else if (store === 'users') {
      db.data.users = db.data.users.filter(u => String(u.id) !== String(id));
    } else if (store === 'tanque') {
      db.data.tanque = db.data.tanque.filter(t => String(t.id) !== String(id));
    }

    await db.write();
    res.json({ success: true });
  });

  app.post('/api/import', async (req, res) => {
    db.data = req.body;
    await db.write();
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
