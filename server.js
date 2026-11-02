'use strict';

// ==========================================
// ANTI-CRASH: Menangkap error agar server tidak mati
// ==========================================
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const db = require('./db'); // Pastikan file db.js sudah ada dan pakai better-sqlite3

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ==========================================
// DISCORD BOT SETUP
// ==========================================
let discordClient = null;
if (config.DISCORD && config.DISCORD.BOT_TOKEN !== 'MTExMjM0NTY3ODkw...') {
  discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  discordClient.login(config.DISCORD.BOT_TOKEN).then(() => {
    console.log('[DISCORD] Bot berhasil login sebagai', discordClient.user.tag);
  }).catch(err => console.error('[DISCORD ERROR]', err.message));
}

// ==========================================
// MIDDLEWARES
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(config.PAYMENT.UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.PAYMENT.UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `bukti_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: config.PAYMENT.MAX_UPLOAD } });

// ==========================================
// HELPERS & AUTH
// ==========================================
const signToken = (user) => jwt.sign({ id: user.id, username: user.username, role: user.role }, config.JWT_SECRET, { expiresIn: '7d' });

const auth = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: 'Token tidak ada' });
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!req.user) return res.status(401).json({ success: false, message: 'User tidak ditemukan' });
    if (req.user.banned) return res.status(403).json({ success: false, message: 'Akun diblokir' });
    next();
  } catch (e) {
    res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
};

const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Akses ditolak' });
  next();
};

// Seed Admin
(function seed() {
  try {
    const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(config.ADMIN.username);
    if (!exist) {
      const hash = bcrypt.hashSync(config.ADMIN.password, 10);
      db.prepare(`INSERT INTO users (username, password, display_name, role) VALUES (?, ?, 'Admin', 'admin')`).run(config.ADMIN.username, hash);
      console.log('[SEED] Admin dibuat');
    }
  } catch (e) { console.error('[SEED ERROR]', e.message); }
})();

// ==========================================
// INTEGRASI EKSTERNAL (NYATA)
// ==========================================

// 1. Buat Server Pterodactyl
async function createPterodactylServer(serverName, panelUsername, memoryMb) {
  try {
    const headers = { 'Authorization': `Bearer ${config.PTERODACTYL.API_KEY}`, 'Accept': 'application/json' };
    
    // Cek user atau buat baru di Pterodactyl
    let ownerId;
    const userSearch = await axios.get(`${config.PTERODACTYL.URL}/api/application/users?filter[email]=${panelUsername}@user.local`, { headers }).catch(() => null);
    
    if (userSearch && userSearch.data.data.length > 0) {
      ownerId = userSearch.data.data[0].attributes.id;
    } else {
      const newUser = await axios.post(`${config.PTERODACTYL.URL}/api/application/users`, {
        email: `${panelUsername}@user.local`,
        username: panelUsername,
        first_name: serverName,
        last_name: 'User',
        password: Math.random().toString(36).slice(-10)
      }, { headers });
      ownerId = newUser.data.attributes.id;
    }

    // Buat server
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

// 2. Beli Nomor SMS
async function buySmsNumber(serviceCode) {
  try {
    // NOTE: Sesuaikan endpoint dengan dokumentasi provider SMS kamu
    const res = await axios.post(`${config.SMS.BASE_URL}/request`, {
      service: serviceCode, country: 'id'
    }, { headers: { 'Authorization': `Bearer ${config.SMS.API_KEY}` } });
    return { phone: res.data.phone, activationId: res.data.id };
  } catch (err) {
    console.error('[SMS ERROR]', err.response?.data || err.message);
    throw new Error('Gagal beli SMS: ' + (err.response?.data?.message || err.message));
  }
}

// 3. Beri Role Discord
async function giveDiscordRole(discordId, roleName) {
  if (!discordClient) throw new Error('Bot Discord belum siap');
  try {
    const guild = await discordClient.guilds.fetch(config.DISCORD.GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const roleConfig = config.ROLE_LIST.find(r => r.name === roleName);
    if (!roleConfig) throw new Error('Role tidak ada di config');
    
    const role = guild.roles.cache.get(roleConfig.discordRoleId);
    if (!role) throw new Error('Role tidak ditemukan di server Discord');
    
    await member.roles.add(role);
    return true;
  } catch (err) {
    console.error('[DISCORD ERROR]', err.message);
    throw new Error('Gagal beri role Discord: ' + err.message);
  }
}

// ==========================================
// ROUTES API (ORDER, TOPUP, DLL)
// ==========================================

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(400).json({ success: false, message: 'User tidak ditemukan' });
    if (user.banned) return res.status(403).json({ success: false, message: 'Akun diblokir' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(400).json({ success: false, message: 'Password salah' });
    res.json({ success: true, token: signToken(user), user: { id: user.id, username: user.username, saldo: user.saldo, role: user.role } });
  } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/order', auth, upload.single('bukti'), async (req, res) => {
  try {
    const { type, item, detail, pay_method } = req.body;
    const parsedDetail = detail ? JSON.parse(detail) : {};
    let harga = 0;

    if (type === 'panel') {
      const p = config.PANEL_PRICES.find(x => x.ram === item);
      if (!p) return res.status(400).json({ message: 'Paket panel tidak valid' });
      harga = p.harga;
    } else if (type === 'nokos') {
      const n = config.NOKOS_LIST.find(x => x.name === item);
      if (!n) return res.status(400).json({ message: 'Nokos tidak valid' });
      harga = n.harga;
    } else if (type === 'role') {
      const r = config.ROLE_LIST.find(x => x.name === item);
      if (!r) return res.status(400).json({ message: 'Role tidak valid' });
      harga = r.harga;
    }

    // --- BAYAR PAKAI SALDO (EKSEKUSI NYATA) ---
    if (pay_method === 'saldo') {
      if (req.user.saldo < harga) return res.status(400).json({ message: 'Saldo tidak cukup' });

      // Eksekusi berdasarkan tipe (Bisa gagal di tengah jalan, jadi kita tangkap errornya)
      try {
        if (type === 'panel') {
          const p = config.PANEL_PRICES.find(x => x.ram === item);
          const pteroId = await createPterodactylServer(parsedDetail.serverName, parsedDetail.panelUsername, p.mb);
          db.prepare(`INSERT INTO panels (user_id, ptero_id, name, ram, harga, panel_username, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`)
            .run(req.user.id, pteroId, parsedDetail.serverName, item, harga, parsedDetail.panelUsername);
        } else if (type === 'nokos') {
          const n = config.NOKOS_LIST.find(x => x.name === item);
          const sms = await buySmsNumber(n.serviceCode);
          db.prepare(`INSERT INTO nokos (user_id, name, harga, phone, status) VALUES (?, ?, ?, ?, 'pending')`)
            .run(req.user.id, item, harga, sms.phone);
        } else if (type === 'role') {
          if (!parsedDetail.discordId) return res.status(400).json({ message: 'Masukkan ID Discord kamu!' });
          await giveDiscordRole(parsedDetail.discordId, item);
          const r = config.ROLE_LIST.find(x => x.name === item);
          db.prepare(`INSERT INTO user_roles (user_id, name, limit_count, used_today) VALUES (?, ?, ?, 0) ON CONFLICT(user_id, name) DO UPDATE SET limit_count = excluded.limit_count, used_today = 0`)
            .run(req.user.id, item, r.limit);
        }

        // Jika semua API berhasil, baru potong saldo
        db.prepare('UPDATE users SET saldo = saldo - ? WHERE id = ?').run(harga, req.user.id);
        return res.json({ success: true, message: 'Order berhasil dieksekusi secara nyata!' });

      } catch (execError) {
        // Jika Pterodactyl / SMS / Discord error, saldo TIDAK dipotong
        return res.status(500).json({ message: execError.message });
      }
    }

    // --- QRIS MANUAL (TUNGGU ACC ADMIN) ---
    if (!req.file) return res.status(400).json({ message: 'Upload bukti transfer dulu' });
    const code = `ORD-${Date.now()}`;
    db.prepare(`INSERT INTO orders (order_code, user_id, type, item, detail, harga, bukti) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(code, req.user.id, type, item, detail || '{}', harga, '/uploads/' + req.file.filename);
    res.json({ success: true, message: 'Order terkirim, tunggu ACC admin' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ACC ADMIN (Eksekusi Nyata)
app.post('/api/admin/approve-order/:id', auth, adminAuth, async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.status !== 'pending') return res.status(400).json({ message: 'Order tidak valid' });

  try {
    const detail = JSON.parse(order.detail || '{}');
    if (order.type === 'panel') {
      const p = config.PANEL_PRICES.find(x => x.ram === order.item);
      const pteroId = await createPterodactylServer(detail.serverName, detail.panelUsername, p.mb);
      db.prepare(`INSERT INTO panels (user_id, ptero_id, name, ram, harga, panel_username, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`)
        .run(order.user_id, pteroId, detail.serverName, order.item, order.harga, detail.panelUsername);
    } else if (order.type === 'nokos') {
      const n = config.NOKOS_LIST.find(x => x.name === order.item);
      const sms = await buySmsNumber(n.serviceCode);
      db.prepare(`INSERT INTO nokos (user_id, name, harga, phone, status) VALUES (?, ?, ?, ?, 'pending')`).run(order.user_id, order.item, order.harga, sms.phone);
    } else if (order.type === 'role') {
      if (detail.discordId) await giveDiscordRole(detail.discordId, order.item);
      const r = config.ROLE_LIST.find(x => x.name === order.item);
      db.prepare(`INSERT INTO user_roles (user_id, name, limit_count, used_today) VALUES (?, ?, ?, 0) ON CONFLICT(user_id, name) DO UPDATE SET limit_count = excluded.limit_count, used_today = 0`).run(order.user_id, order.item, r.limit);
    }

    db.prepare(`UPDATE orders SET status='approved' WHERE id=?`).run(order.id);
    res.json({ success: true, message: 'Order ACC dan dieksekusi!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal eksekusi: ' + err.message });
  }
});

// AI Proxy
app.post('/api/ai', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Text kosong' });
    const response = await axios.get(`${config.AI.ENDPOINT}?text=${encodeURIComponent(text)}`, { timeout: config.AI.TIMEOUT });
    res.json({ reply: response.data });
  } catch (e) { res.status(500).json({ message: 'AI sibuk / error' }); }
});

// Healthcheck
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// SPA Fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

// Error Handler Anti-Crash
app.use((err, req, res, next) => {
  console.error('[ERROR MIDDLEWARE]', err.message);
  res.status(500).json({ success: false, message: err.message || 'Server Error' });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = config.PORT;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===========================================`);
  console.log(`  AutoPanel Backend NYATA berjalan`);
  console.log(`  Port: ${PORT}`);
  console.log(`===========================================`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('Menutup server...');
  server.close(() => process.exit(0));
});
