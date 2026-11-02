'use strict';

// ==========================================
// ANTI-CRASH
// ==========================================
process.on('uncaughtException', (err) => console.error('[UNCAUGHT]', err.message));
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED]', reason));

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');

const app = express();

// Vercel tidak mengizinkan penulisan file lokal, simpan upload di /tmp
const upload = multer({ dest: '/tmp' }); 

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// NOTE: express.static DIHAPUS karena Vercel menangani folder /public via vercel.json

// ==========================================
// DATABASE SEMENTARA VERCEL (FILE JSON DI /tmp)
// ==========================================
const DB_PATH = '/tmp/database.json';

function readDB() {
  if (!require('fs').existsSync(DB_PATH)) {
    const initial = {
      users: [{ id: 1, username: config.ADMIN.username, password: bcrypt.hashSync(config.ADMIN.password, 10), role: 'admin', saldo: 0 }],
      panels: [], nokos: [], user_roles: [], orders: []
    };
    require('fs').writeFileSync(DB_PATH, JSON.stringify(initial));
    return initial;
  }
  return JSON.parse(require('fs').readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  require('fs').writeFileSync(DB_PATH, JSON.stringify(data));
}

// ==========================================
// DISCORD BOT SETUP
// ==========================================
let discordClient = null;
if (config.DISCORD && config.DISCORD.BOT_TOKEN !== 'token_bot_discord_kamu') {
  discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  discordClient.login(config.DISCORD.BOT_TOKEN).catch(err => console.error('[DISCORD ERROR]', err.message));
}

// ==========================================
// HELPERS & AUTH
// ==========================================
const signToken = (user) => jwt.sign({ id: user.id, role: user.role }, config.JWT_SECRET, { expiresIn: '7d' });

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const db = readDB();
    req.user = db.users.find(u => u.id === payload.id);
    if (!req.user) return res.status(401).json({ success: false, message: 'User not found' });
    next();
  } catch (e) { 
    res.status(401).json({ success: false, message: 'Invalid token' }); 
  }
};

const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Akses ditolak' });
  next();
};

// ==========================================
// INTEGRASI API NYATA
// ==========================================

async function createPterodactylServer(serverName, panelUsername, memoryMb) {
  try {
    const headers = { 'Authorization': `Bearer ${config.PTERODACTYL.API_KEY}`, 'Accept': 'application/json' };
    
    // Cek apakah user sudah ada, kalau belum buat baru
    let ownerId;
    try {
      const userSearch = await axios.get(`${config.PTERODACTYL.URL}/api/application/users?filter[email]=${panelUsername}@user.local`, { headers });
      if (userSearch.data.data.length > 0) {
        ownerId = userSearch.data.data[0].attributes.id;
      } else { throw new Error('Not found'); }
    } catch (e) {
      const newUser = await axios.post(`${config.PTERODACTYL.URL}/api/application/users`, {
        email: `${panelUsername}@user.local`,
        username: panelUsername,
        first_name: serverName,
        last_name: 'User',
        password: Math.random().toString(36).slice(-10)
      }, { headers });
      ownerId = newUser.data.attributes.id;
    }

    // Buat Server
    const serverRes = await axios.post(`${config.PTERODACTYL.URL}/api/application/servers`, {
      name: serverName,
      user: ownerId,
      egg: config.PTERODACTYL.EGG_ID,
      docker_image: config.PTERODACTYL.DOCKER_IMAGE,
      startup: config.PTERODACTYL.STARTUP,
      environment: { SERVER_JARFILE: 'server.jar', VANILLA_VERSION: 'latest' },
      limits: { memory: memoryMb, swap: 0, disk: memoryMb * 2, io: 500, cpu: 100 },
      allocation: { default: config.PTERODACTYL.DEFAULT_ALLOCATION }
    }, { headers });

    return serverRes.data.attributes.id;
  } catch (err) {
    console.error('[PTERO ERROR]', err.response?.data || err.message);
    throw new Error('Gagal ke Pterodactyl: ' + (err.response?.data?.errors?.[0]?.detail || err.message));
  }
}

async function giveDiscordRole(discordId, roleName) {
  if (!discordClient) throw new Error('Discord bot belum siap');
  try {
    const guild = await discordClient.guilds.fetch(config.DISCORD.GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const roleConfig = config.ROLE_LIST.find(r => r.name === roleName);
    if (!roleConfig) throw new Error('Role tidak ada di config');
    
    const role = guild.roles.cache.get(roleConfig.discordRoleId);
    if (!role) throw new Error('Role tidak ditemukan di server Discord');
    
    await member.roles.add(role);
  } catch (err) {
    console.error('[DISCORD ERROR]', err.message);
    throw new Error('Gagal beri role Discord: ' + err.message);
  }
}

// ==========================================
// ROUTES API
// ==========================================

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ success: false, message: 'Username atau password salah' });
    }
    res.json({ success: true, token: signToken(user), user: { id: user.id, username: user.username, saldo: user.saldo, role: user.role } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/order', auth, upload.single('bukti'), async (req, res) => {
  try {
    const { type, item, detail, pay_method } = req.body;
    const parsedDetail = detail ? JSON.parse(detail) : {};
    const db = readDB();
    let harga = 0;

    if (type === 'panel') harga = config.PANEL_PRICES.find(x => x.ram === item).harga;
    if (type === 'role') harga = config.ROLE_LIST.find(x => x.name === item).harga;

    // --- BAYAR PAKAI SALDO ---
    if (pay_method === 'saldo') {
      const user = db.users.find(u => u.id === req.user.id);
      if (user.saldo < harga) return res.status(400).json({ success: false, message: 'Saldo tidak cukup' });

      try {
        if (type === 'panel') {
          const p = config.PANEL_PRICES.find(x => x.ram === item);
          const pteroId = await createPterodactylServer(parsedDetail.serverName, parsedDetail.panelUsername, p.mb);
          db.panels.push({ user_id: user.id, ptero_id: pteroId, name: parsedDetail.serverName, ram: item });
        } else if (type === 'role') {
          if (!parsedDetail.discordId) return res.status(400).json({ success: false, message: 'Masukkan ID Discord!' });
          await giveDiscordRole(parsedDetail.discordId, item);
          db.user_roles.push({ user_id: user.id, name: item });
        }

        user.saldo -= harga;
        writeDB(db);
        return res.json({ success: true, message: 'Order berhasil dieksekusi secara nyata!' });
      } catch (execError) {
        return res.status(500).json({ success: false, message: execError.message });
      }
    }

    // --- QRIS MANUAL ---
    const code = `ORD-${Date.now()}`;
    db.orders.push({ id: code, user_id: req.user.id, type, item, detail: detail || '{}', harga, status: 'pending' });
    writeDB(db);
    res.json({ success: true, message: 'Order terkirim, tunggu ACC admin' });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/approve/:id', auth, adminAuth, async (req, res) => {
  try {
    const db = readDB();
    const order = db.orders.find(o => o.id === req.params.id);
    if (!order || order.status !== 'pending') return res.status(400).json({ success: false, message: 'Order tidak valid' });
    
    const detail = JSON.parse(order.detail || '{}');

    if (order.type === 'panel') {
      const p = config.PANEL_PRICES.find(x => x.ram === order.item);
      const pteroId = await createPterodactylServer(detail.serverName, detail.panelUsername, p.mb);
      db.panels.push({ user_id: order.user_id, ptero_id: pteroId, name: detail.serverName, ram: order.item });
    } else if (order.type === 'role') {
      if (detail.discordId) await giveDiscordRole(detail.discordId, order.item);
      db.user_roles.push({ user_id: order.user_id, name: order.item });
    }

    order.status = 'approved';
    writeDB(db);
    res.json({ success: true, message: 'ACC Berhasil dan dieksekusi!' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal eksekusi: ' + err.message });
  }
});

app.post('/api/ai', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'Text kosong' });
    const response = await axios.get(`${config.AI.ENDPOINT}?text=${encodeURIComponent(text)}`, { timeout: config.AI.TIMEOUT });
    res.json({ success: true, reply: response.data });
  } catch (e) { 
    res.status(500).json({ success: false, message: 'AI sibuk / error' }); 
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ==========================================
// EXPORT UNTUK VERCEL
// ==========================================
// JANGAN pakai app.listen() di Vercel!
module.exports = app;
