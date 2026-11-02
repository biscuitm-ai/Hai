'use strict';

process.on('uncaughtException', (err) => console.error('[UNCAUGHT]', err.message));
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED]', reason));

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');

const app = express();

// Vercel tidak bisa simpan file di public, jadi simpan upload di /tmp
const upload = multer({ dest: '/tmp' }); 

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan file statis dari folder public (berkat vercel.json)
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// DATABASE SEMENTARA VERCEL (FILE JSON)
// ==========================================
const DB_PATH = '/tmp/database.json';

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      users: [{ id: 1, username: config.ADMIN.username, password: bcrypt.hashSync(config.ADMIN.password, 10), role: 'admin', saldo: 0 }],
      panels: [], nokos: [], user_roles: [], orders: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data));
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
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const db = readDB();
    req.user = db.users.find(u => u.id === payload.id);
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch (e) { res.status(401).json({ message: 'Invalid token' }); }
};

// ==========================================
// EKSEKUSI API NYATA
// ==========================================

async function createPterodactylServer(serverName, panelUsername, memoryMb) {
  const headers = { 'Authorization': `Bearer ${config.PTERODACTYL.API_KEY}`, 'Accept': 'application/json' };
  
  // 1. Buat User Pterodactyl
  const userRes = await axios.post(`${config.PTERODACTYL.URL}/api/application/users`, {
    email: `${panelUsername}@user.local`, username: panelUsername,
    first_name: serverName, last_name: 'User', password: Math.random().toString(36).slice(-10)
  }, { headers }).catch(async (err) => {
    if (err.response && err.response.status === 422) {
      const search = await axios.get(`${config.PTERODACTYL.URL}/api/application/users?filter[email]=${panelUsername}@user.local`, { headers });
      return search.data.data[0].attributes ? { data: { attributes: search.data.data[0].attributes } } : null;
    }
    throw err;
  });

  const ownerId = userRes.data.attributes.id;

  // 2. Buat Server
  const serverRes = await axios.post(`${config.PTERODACTYL.URL}/api/application/servers`, {
    name: serverName, user: ownerId, egg: config.PTERODACTYL.EGG_ID,
    docker_image: config.PTERODACTYL.DOCKER_IMAGE, startup: config.PTERODACTYL.STARTUP,
    environment: { SERVER_JARFILE: 'server.jar', VANILLA_VERSION: 'latest' },
    limits: { memory: memoryMb, swap: 0, disk: memoryMb * 2, io: 500, cpu: 100 },
    allocation: { default: config.PTERODACTYL.DEFAULT_ALLOCATION }
  }, { headers });

  return serverRes.data.attributes.id;
}

async function giveDiscordRole(discordId, roleName) {
  if (!discordClient) throw new Error('Discord bot belum siap');
  const guild = await discordClient.guilds.fetch(config.DISCORD.GUILD_ID);
  const member = await guild.members.fetch(discordId);
  const roleConfig = config.ROLE_LIST.find(r => r.name === roleName);
  const role = guild.roles.cache.get(roleConfig.discordRoleId);
  if (!role) throw new Error('Role tidak ditemukan di Discord');
  await member.roles.add(role);
}

// ==========================================
// ROUTES API
// ==========================================

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ success: false, message: 'Login gagal' });
  }
  res.json({ success: true, token: signToken(user), user: { id: user.id, username: user.username, saldo: user.saldo, role: user.role } });
});

app.post('/api/order', auth, upload.single('bukti'), async (req, res) => {
  try {
    const { type, item, detail, pay_method } = req.body;
    const parsedDetail = detail ? JSON.parse(detail) : {};
    const db = readDB();
    let harga = 0;

    if (type === 'panel') harga = config.PANEL_PRICES.find(x => x.ram === item).harga;
    if (type === 'role') harga = config.ROLE_LIST.find(x => x.name === item).harga;

    // --- BAYAR SALDO ---
    if (pay_method === 'saldo') {
      const user = db.users.find(u => u.id === req.user.id);
      if (user.saldo < harga) return res.status(400).json({ message: 'Saldo tidak cukup' });

      if (type === 'panel') {
        const p = config.PANEL_PRICES.find(x => x.ram === item);
        const pteroId = await createPterodactylServer(parsedDetail.serverName, parsedDetail.panelUsername, p.mb);
        db.panels.push({ user_id: user.id, ptero_id: pteroId, name: parsedDetail.serverName, ram: item });
      } 
      else if (type === 'role') {
        await giveDiscordRole(parsedDetail.discordId, item);
        db.user_roles.push({ user_id: user.id, name: item });
      }

      user.saldo -= harga;
      writeDB(db);
      return res.json({ success: true, message: 'Order berhasil dieksekusi!' });
    }

    // --- QRIS MANUAL (TUNGGU ACC) ---
    const code = `ORD-${Date.now()}`;
    db.orders.push({ id: code, user_id: req.user.id, type, item, detail, harga, status: 'pending' });
    writeDB(db);
    res.json({ success: true, message: 'Order terkirim, tunggu ACC admin' });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADMIN ACC
app.post('/api/admin/approve/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses admin' });
  try {
    const db = readDB();
    const order = db.orders.find(o => o.id === req.params.id);
    if (!order || order.status !== 'pending') return res.status(400).json({ message: 'Order tidak valid' });
    const detail = JSON.parse(order.detail || '{}');

    if (order.type === 'panel') {
      const p = config.PANEL_PRICES.find(x => x.ram === order.item);
      const pteroId = await createPterodactylServer(detail.serverName, detail.panelUsername, p.mb);
      db.panels.push({ user_id: order.user_id, ptero_id: pteroId, name: detail.serverName, ram: order.item });
    } else if (order.type === 'role') {
      await giveDiscordRole(detail.discordId, order.item);
      db.user_roles.push({ user_id: order.user_id, name: order.item });
    }

    order.status = 'approved';
    writeDB(db);
    res.json({ success: true, message: 'ACC Berhasil dan dieksekusi!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/ai', auth, async (req, res) => {
  try {
    const response = await axios.get(`${config.AI.ENDPOINT}?text=${encodeURIComponent(req.body.text)}`);
    res.json({ reply: response.data });
  } catch (e) { res.status(500).json({ message: 'AI error' }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// KARENA VERCEL, KITA TIDAK PAKAI app.listen()
// Cukup export app-nya
module.exports = app;
