// ============================================================
// AutoPanel Backend — Express + Socket.io + SQLite
// Deploy: Railway / VPS — config di config.js
// ============================================================
'use strict';

// ---------- Anti-crash: tangkap error tak terduga ----------
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const axios = require('axios');

const config = require('./config');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ---------- Middleware ----------
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(config.PAYMENT.UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Multer (upload bukti) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.PAYMENT.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `bukti_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: config.PAYMENT.MAX_UPLOAD },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Hanya file gambar yang diizinkan'));
  }
});

// ---------- Helper ----------
const ok = (res, data) => res.json({ success: true, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });
const genCode = (prefix) => `${prefix}-${Date.now()}-${Math.round(Math.random() * 9999)}`;

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES
  });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return fail(res, 'Token tidak ada', 401);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return fail(res, 'User tidak ditemukan', 401);
    if (user.banned) return fail(res, 'Akun diblokir', 403);
    req.user = user;
    next();
  } catch (e) {
    return fail(res, 'Token tidak valid', 401);
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return fail(res, 'Akses admin saja', 403);
  next();
}

// ---------- Seed admin ----------
(function seedAdmin() {
  try {
    const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(config.ADMIN.username);
    if (!existing) {
      const hash = bcrypt.hashSync(config.ADMIN.password, 10);
      db.prepare(
        `INSERT INTO users (username, password, display_name, role, saldo) VALUES (?, ?, ?, 'admin', 0)`
      ).run(config.ADMIN.username, hash, 'Administrator');
      console.log('[SEED] Admin dibuat:', config.ADMIN.username);
    }
  } catch (e) {
    console.error('[SEED ERROR]', e.message);
  }
})();

// ============================================================
// AUTH
// ============================================================
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || username.length < 3) return fail(res, 'Username minimal 3 karakter');
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return fail(res, 'Username hanya huruf, angka, _');
    if (!password || password.length < 6) return fail(res, 'Password minimal 6 karakter');

    const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exist) return fail(res, 'Username sudah dipakai');

    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      `INSERT INTO users (username, password, display_name, role, saldo) VALUES (?, ?, ?, 'user', 0)`
    ).run(username, hash, username);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    return ok(res, { token: signToken(user), user: sanitizeUser(user) });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return fail(res, 'Username tidak ditemukan');
    if (user.banned) return fail(res, 'Akun diblokir', 403);
    const match = bcrypt.compareSync(password, user.password);
    if (!match) return fail(res, 'Password salah');
    return ok(res, { token: signToken(user), user: sanitizeUser(user) });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  try {
    const panels = db.prepare('SELECT * FROM panels WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    const nokos = db.prepare('SELECT * FROM nokos WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    const roles = db.prepare('SELECT * FROM user_roles WHERE user_id = ?').all(req.user.id);
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
    const topups = db.prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
    return ok(res, { user: sanitizeUser(req.user), panels, nokos, roles, orders, topups });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

function sanitizeUser(u) {
  return {
    id: u.id, username: u.username, display_name: u.display_name,
    avatar: u.avatar, saldo: u.saldo, role: u.role, limit_date: u.limit_date
  };
}

// ============================================================
// KONFIG PUBLIK (harga, qris, dll — tanpa API key)
// ============================================================
app.get('/api/config', (req, res) => {
  return ok(res, {
    qris: {
      image: config.PAYMENT.QRIS_IMAGE,
      dana_number: config.PAYMENT.DANA_NUMBER,
      dana_name: config.PAYMENT.DANA_NAME,
      min_deposit: config.PAYMENT.MIN_DEPOSIT
    },
    panel_prices: config.PANEL_PRICES,
    nokos_list: config.NOKOS_LIST,
    role_list: config.ROLE_LIST
  });
});

// ============================================================
// TOPUP (QRIS manual DANA)
// ============================================================
app.post('/api/topup', authMiddleware, upload.single('bukti'), (req, res) => {
  try {
    const amount = parseInt(req.body.amount);
    if (!amount || amount < config.PAYMENT.MIN_DEPOSIT) {
      return fail(res, `Minimal deposit Rp ${config.PAYMENT.MIN_DEPOSIT}`);
    }
    if (!req.file) return fail(res, 'Upload bukti transfer dulu');

    const code = genCode('TOP');
    const bukti = '/uploads/' + req.file.filename;
    db.prepare(
      `INSERT INTO topups (topup_code, user_id, amount, bukti) VALUES (?, ?, ?, ?)`
    ).run(code, req.user.id, amount, bukti);

    return ok(res, { code, message: 'Topup terkirim, tunggu ACC admin' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.get('/api/topup/history', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  return ok(res, rows);
});

// ============================================================
// ORDER (panel / nokos / role)
// ============================================================
app.post('/api/order', authMiddleware, upload.single('bukti'), (req, res) => {
  try {
    const { type, item, detail, pay_method } = req.body;
    let harga = 0;

    if (type === 'panel') {
      const p = config.PANEL_PRICES.find(x => x.ram === item);
      if (!p) return fail(res, 'Paket panel tidak ditemukan');
      harga = p.harga;
    } else if (type === 'nokos') {
      const n = config.NOKOS_LIST.find(x => x.name === item);
      if (!n) return fail(res, 'Layanan nokos tidak ditemukan');
      harga = n.harga;
    } else if (type === 'role') {
      const r = config.ROLE_LIST.find(x => x.name === item);
      if (!r) return fail(res, 'Role tidak ditemukan');
      harga = r.harga;
    } else {
      return fail(res, 'Tipe order tidak valid');
    }

    // ---------- Bayar via saldo ----------
    if (pay_method === 'saldo') {
      if (req.user.saldo < harga) return fail(res, 'Saldo tidak cukup');

      const tx = db.transaction(() => {
        db.prepare('UPDATE users SET saldo = saldo - ? WHERE id = ?').run(harga, req.user.id);
        if (type === 'panel') {
          const detailObj = JSON.parse(detail || '{}');
          const now = new Date();
          const exp = new Date(now.getTime() + 30 * 864e5);
          db.prepare(
            `INSERT INTO panels (user_id, name, ram, harga, domain, panel_username, password, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            req.user.id, detailObj.serverName || 'server-' + req.user.username,
            item, harga, config.PTERODACTYL.URL,
            detailObj.panelUsername || req.user.username,
            genPassword(), exp.toISOString()
          );
        } else if (type === 'nokos') {
          db.prepare(
            `INSERT INTO nokos (user_id, name, harga, status) VALUES (?, ?, ?, 'pending')`
          ).run(req.user.id, item, harga);
        } else if (type === 'role') {
          const r = config.ROLE_LIST.find(x => x.name === item);
          db.prepare(
            `INSERT INTO user_roles (user_id, name, limit_count, used_today)
             VALUES (?, ?, ?, 0)
             ON CONFLICT(user_id, name) DO UPDATE SET limit_count = excluded.limit_count, used_today = 0, bought_at = CURRENT_TIMESTAMP`
          ).run(req.user.id, item, r.limit);
        }
      });
      tx();

      return ok(res, { message: 'Order berhasil' });
    }

    // ---------- Bayar via QRIS (manual) ----------
    if (!req.file) return fail(res, 'Upload bukti transfer dulu');
    const code = genCode('ORD');
    const bukti = '/uploads/' + req.file.filename;
    db.prepare(
      `INSERT INTO orders (order_code, user_id, type, item, detail, harga, bukti)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(code, req.user.id, type, item, detail || '{}', harga, bukti);

    return ok(res, { code, message: 'Order terkirim, tunggu ACC admin' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.get('/api/order/history', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  return ok(res, rows);
});

function genPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ============================================================
// PANEL — klaim limit role
// ============================================================
app.post('/api/panel/free', authMiddleware, (req, res) => {
  try {
    const { role_name, serverName, panelUsername } = req.body;
    if (!role_name || !serverName || serverName.length < 3) return fail(res, 'Data tidak lengkap');

    const today = new Date().toISOString().slice(0, 10);
    const ur = db.prepare('SELECT * FROM user_roles WHERE user_id = ? AND name = ?').get(req.user.id, role_name);
    if (!ur) return fail(res, 'Kamu tidak punya role ini');

    // Reset limit kalau beda hari
    if (req.user.limit_date !== today) {
      db.prepare('UPDATE users SET limit_date = ? WHERE id = ?').run(today, req.user.id);
      db.prepare('UPDATE user_roles SET used_today = 0 WHERE user_id = ?').run(req.user.id);
    }

    const fresh = db.prepare('SELECT * FROM user_roles WHERE id = ?').get(ur.id);
    if (fresh.used_today >= fresh.limit_count) return fail(res, 'Limit role sudah habis hari ini');

    const now = new Date();
    const exp = new Date(now.getTime() + 30 * 864e5);
    const tx = db.transaction(() => {
      db.prepare('UPDATE user_roles SET used_today = used_today + 1 WHERE id = ?').run(ur.id);
      db.prepare(
        `INSERT INTO panels (user_id, name, ram, harga, domain, panel_username, password, gratis, role_asal, expires_at)
         VALUES (?, ?, '2 GB', 0, ?, ?, ?, 1, ?, ?)`
      ).run(
        req.user.id, serverName, config.PTERODACTYL.URL,
        panelUsername || req.user.username + '_panel',
        genPassword(), role_name, exp.toISOString()
      );
    });
    tx();

    return ok(res, { message: 'Panel gratis dibuat' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

// ============================================================
// CHAT (Socket.io + REST fallback)
// ============================================================
app.get('/api/chat/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100').all().reverse();
  return ok(res, rows);
});

app.post('/api/chat/send', authMiddleware, upload.single('file'), (req, res) => {
  try {
    const { text } = req.body;
    let type = 'text';
    let content = text || '';
    let filename = null;

    if (req.file) {
      type = req.file.mimetype.startsWith('image/') ? 'image'
        : req.file.mimetype.startsWith('video/') ? 'video' : 'file';
      content = '/uploads/' + req.file.filename;
      filename = req.file.originalname;
    }

    if (!content) return fail(res, 'Pesan kosong');

    const info = db.prepare(
      `INSERT INTO chat_messages (user_id, username, type, content, filename) VALUES (?, ?, ?, ?, ?)`
    ).run(req.user.id, req.user.username, type, content, filename);

    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid);
    io.emit('chat:new', msg);
    return ok(res, msg);
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

// ============================================================
// AI PROXY
// ============================================================
app.post('/api/ai', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return fail(res, 'Teks kosong');
    if (text.length > config.AI.MAX_LENGTH) return fail(res, 'Teks terlalu panjang');

    const url = `${config.AI.ENDPOINT}?text=${encodeURIComponent(text)}`;
    const response = await axios.get(url, {
      timeout: config.AI.TIMEOUT,
      headers: { 'Accept': 'application/json, text/plain, */*' }
    });

    let reply = response.data;
    if (typeof reply !== 'string') {
      reply = reply.reply || reply.response || reply.message || reply.result
        || reply.answer || reply.text || reply.output
        || (reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content)
        || JSON.stringify(reply);
    }

    // Simpan history
    db.prepare('INSERT INTO ai_history (user_id, role, content) VALUES (?, ?, ?)').run(req.user.id, 'user', text);
    db.prepare('INSERT INTO ai_history (user_id, role, content) VALUES (?, ?, ?)').run(req.user.id, 'bot', reply);

    return ok(res, { reply });
  } catch (e) {
    console.error('[AI ERROR]', e.message);
    return fail(res, 'AI sedang sibuk, coba lagi', 500);
  }
});

app.get('/api/ai/history', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM ai_history WHERE user_id = ? ORDER BY id ASC LIMIT 40').all(req.user.id);
  return ok(res, rows);
});

app.delete('/api/ai/history', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM ai_history WHERE user_id = ?').run(req.user.id);
  return ok(res, { message: 'History dihapus' });
});

// ============================================================
// ADMIN
// ============================================================
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
    const pendingOrders = db.prepare("SELECT COUNT(*) as n FROM orders WHERE status='pending'").get().n;
    const pendingTopups = db.prepare("SELECT COUNT(*) as n FROM topups WHERE status='pending'").get().n;
    const totalPanels = db.prepare('SELECT COUNT(*) as n FROM panels').get().n;
    const totalSaldo = db.prepare('SELECT COALESCE(SUM(saldo),0) as n FROM users').get().n;
    return ok(res, { userCount, pendingOrders, pendingTopups, totalPanels, totalSaldo });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.get('/api/admin/orders', authMiddleware, adminMiddleware, (req, res) => {
  const status = req.query.status || 'pending';
  const rows = db.prepare(
    `SELECT o.*, u.username FROM orders o JOIN users u ON u.id = o.user_id
     WHERE o.status = ? ORDER BY o.id DESC`
  ).all(status);
  return ok(res, rows);
});

app.get('/api/admin/topups', authMiddleware, adminMiddleware, (req, res) => {
  const status = req.query.status || 'pending';
  const rows = db.prepare(
    `SELECT t.*, u.username FROM topups t JOIN users u ON u.id = t.user_id
     WHERE t.status = ? ORDER BY t.id DESC`
  ).all(status);
  return ok(res, rows);
});

app.post('/api/admin/approve-order/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return fail(res, 'Order tidak ditemukan', 404);
    if (order.status !== 'pending') return fail(res, 'Order sudah diproses');

    const detailObj = JSON.parse(order.detail || '{}');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);

    const tx = db.transaction(() => {
      db.prepare("UPDATE orders SET status='approved', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);

      if (order.type === 'panel') {
        const now = new Date();
        const exp = new Date(now.getTime() + 30 * 864e5);
        db.prepare(
          `INSERT INTO panels (user_id, name, ram, harga, domain, panel_username, password, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          order.user_id,
          detailObj.serverName || 'server-' + user.username,
          order.item, order.harga, config.PTERODACTYL.URL,
          detailObj.panelUsername || user.username,
          genPassword(), exp.toISOString()
        );
      } else if (order.type === 'nokos') {
        db.prepare(
          `INSERT INTO nokos (user_id, name, harga, status) VALUES (?, ?, ?, 'pending')`
        ).run(order.user_id, order.item, order.harga);
      } else if (order.type === 'role') {
        const r = config.ROLE_LIST.find(x => x.name === order.item);
        if (r) {
          db.prepare(
            `INSERT INTO user_roles (user_id, name, limit_count, used_today)
             VALUES (?, ?, ?, 0)
             ON CONFLICT(user_id, name) DO UPDATE SET limit_count = excluded.limit_count, used_today = 0, bought_at = CURRENT_TIMESTAMP`
          ).run(order.user_id, order.item, r.limit);
        }
      }
    });
    tx();

    return ok(res, { message: 'Order di-ACC' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.post('/api/admin/reject-order/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const note = req.body.note || '';
    db.prepare("UPDATE orders SET status='rejected', admin_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'")
      .run(note, req.params.id);
    return ok(res, { message: 'Order ditolak' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.post('/api/admin/approve-topup/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const t = db.prepare('SELECT * FROM topups WHERE id = ?').get(req.params.id);
    if (!t) return fail(res, 'Topup tidak ditemukan', 404);
    if (t.status !== 'pending') return fail(res, 'Topup sudah diproses');

    const tx = db.transaction(() => {
      db.prepare("UPDATE topups SET status='approved' WHERE id=?").run(t.id);
      db.prepare('UPDATE users SET saldo = saldo + ? WHERE id = ?').run(t.amount, t.user_id);
    });
    tx();

    return ok(res, { message: 'Topup di-ACC, saldo ditambah' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.post('/api/admin/reject-topup/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    db.prepare("UPDATE topups SET status='rejected' WHERE id=? AND status='pending'").run(req.params.id);
    return ok(res, { message: 'Topup ditolak' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id, username, display_name, saldo, role, banned, created_at FROM users ORDER BY id DESC').all();
  return ok(res, rows);
});

app.post('/api/admin/user/:id/saldo', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const amount = parseInt(req.body.amount);
    if (isNaN(amount)) return fail(res, 'Jumlah tidak valid');
    db.prepare('UPDATE users SET saldo = saldo + ? WHERE id = ?').run(amount, req.params.id);
    return ok(res, { message: 'Saldo diupdate' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

app.post('/api/admin/user/:id/ban', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const banned = req.body.banned ? 1 : 0;
    db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned, req.params.id);
    return ok(res, { message: banned ? 'User dibanned' : 'User di-unban' });
  } catch (e) {
    console.error(e);
    return fail(res, 'Terjadi kesalahan server', 500);
  }
});

// ============================================================
// HEALTH CHECK (Railway butuh ini)
// ============================================================
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// SPA fallback — semua route tak dikenal → app.html
app.get('*', (req, res) => {
  const file = path.join(__dirname, 'public', 'app.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.status(404).send('Not Found');
});

// ---------- Error handler (anti-crash) ----------
app.use((err, req, res, next) => {
  console.error('[ERROR HANDLER]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 'File terlalu besar', 413);
  return fail(res, err.message || 'Server error', 500);
});

// ============================================================
// SOCKET.IO — Chat real-time
// ============================================================
io.on('connection', (socket) => {
  console.log('[SOCKET] User connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('[SOCKET] Disconnected:', socket.id);
  });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = config.PORT;

server.listen(PORT, '0.0.0.0', () => {
  console.log('===========================================');
  console.log(`  AutoPanel Backend berjalan`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Mode: ${config.NODE_ENV}`);
  console.log(`  URL : http://localhost:${PORT}`);
  console.log('===========================================');
});

// ---------- Graceful shutdown ----------
function shutdown(signal) {
  console.log(`[${signal}] Menutup server...`);
  server.close(() => {
    console.log('Server ditutup.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
