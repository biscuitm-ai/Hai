// ============================================================
// KONFIGURASI UTAMA — edit di sini, TANPA .env
// ============================================================
module.exports = {
  // ---------- Server ----------
  // Railway inject process.env.PORT otomatis. Fallback ke 3000 untuk VPS.
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'production',
  // Ganti dengan domain final kamu (buat CORS & link QRIS)
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  // Secret JWT — GANTI dengan string random panjang!
  JWT_SECRET: 'GANTI_INI_DENGAN_STRING_RANDOM_PANJANG_MINIMAL_64_KARAKTER_abc123xyz',
  JWT_EXPIRES: '7d',

  // ---------- Database ----------
  // SQLite file — otomatis dibuat di folder ./data
  DB_FILE: './data/autopanel.db',

  // ---------- QRIS MANUAL (DANA) ----------
  PAYMENT: {
    // Nomor DANA kamu (ditampilkan ke user)
    DANA_NUMBER: '081234567890',
    DANA_NAME: 'Nama Pemilik DANA',
    // Path gambar QRIS (taruh di public/qris.png) atau URL eksternal
    QRIS_IMAGE: '/qris.png',
    // Minimal deposit
    MIN_DEPOSIT: 1000,
    // Maksimal upload bukti (byte) — 5MB
    MAX_UPLOAD: 5 * 1024 * 1024,
    // Folder simpan bukti transfer
    UPLOAD_DIR: './data/uploads'
  },

  // ---------- Admin ----------
  // Login admin (akan di-hash saat pertama start)
  ADMIN: {
    username: 'biscuitmd',
    password: 'dev123' // GANTI!
  },

  // ---------- Pterodactyl (PLTA / PLTC) ----------
  PTERODACTYL: {
    // Panel utama
    URL: 'https://panel.domainmu.com',
    API_KEY: 'ptla_xxxxxxxxxxxxxxxxxxxxxxxx',
    NEST_ID: 1,
    EGG_ID: 1,
    // Default allocation ID (lihat di admin Pterodactyl)
    DEFAULT_ALLOCATION: 1,
    // Docker image
    DOCKER_IMAGE: 'ghcr.io/parkervcp/yolks:nodejs_18',
    // Startup command
    STARTUP: 'npm start',
    // Panel kedua (PLTC) — opsional
    PLTC_URL: 'https://pltc.domainmu.com',
    PLTC_API_KEY: 'pltc_xxxxxxxxxxxxxxxxxxxxxxxx'
  },

  // ---------- SMS OTP (Nokos) ----------
  SMS: {
    PROVIDER: 'svnumber', // svnumber | smstwins | custom
    API_KEY: 'sms_xxxxxxxxxxxxxxxxxxxxxxxx',
    BASE_URL: 'https://api.svnumber.com',
    // Endpoint (sesuaikan dengan provider)
    ENDPOINTS: {
      order: '/order',
      status: '/status',
      cancel: '/cancel'
    }
  },

  // ---------- AI ----------
  AI: {
    ENDPOINT: 'https://apiii-xrina.my.id/ai/gpt',
    TIMEOUT: 30000, // 30 detik
    MAX_LENGTH: 2000
  },

  // ---------- Harga Panel (RAM dalam MB) ----------
  PANEL_PRICES: [
    { ram: '1 GB',  mb: 1024,  harga: 1000  },
    { ram: '2 GB',  mb: 2048,  harga: 2000  },
    { ram: '3 GB',  mb: 3072,  harga: 3000  },
    { ram: '4 GB',  mb: 4096,  harga: 4000  },
    { ram: '5 GB',  mb: 5120,  harga: 5000  },
    { ram: '6 GB',  mb: 6144,  harga: 6000  },
    { ram: '7 GB',  mb: 7168,  harga: 7000  },
    { ram: '8 GB',  mb: 8192,  harga: 8000  },
    { ram: '9 GB',  mb: 9216,  harga: 9000  },
    { ram: '10 GB', mb: 10240, harga: 10000 },
    { ram: 'UNLIMITED', mb: 0, harga: 12000, unli: true }
  ],

  // ---------- Nokos ----------
  NOKOS_LIST: [
    { name: 'WhatsApp', harga: 3000 },
    { name: 'Telegram', harga: 2500 },
    { name: 'Instagram', harga: 3500 },
    { name: 'Facebook', harga: 3000 },
    { name: 'Google', harga: 4000 },
    { name: 'Twitter/X', harga: 3500 },
    { name: 'Discord', harga: 3000 },
    { name: 'TikTok', harga: 3500 }
  ],

  // ---------- Role ----------
  ROLE_LIST: [
    { name: 'Reseller',      harga: 10000, limit: 2  },
    { name: 'Admin',         harga: 25000, limit: 3  },
    { name: 'Owner',         harga: 35000, limit: 5  },
    { name: 'Partner',       harga: 45000, limit: 7  },
    { name: 'Tangan Kanan',  harga: 55000, limit: 10 }
  ]
};
