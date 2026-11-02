// ============================================================
// KONFIGURASI UTAMA (TANPA .ENV)
// ============================================================
module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'production',
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
  
  // GANTI INI: String random panjang untuk keamanan JWT
  JWT_SECRET: 'ganti_dengan_string_random_panjang_seperti_123!@#abcXYZ', 
  DB_FILE: './data/autopanel.db',

  // --- KONFIGURASI PEMBAYARAN MANUAL ---
  PAYMENT: {
    DANA_NUMBER: '081234567890', // GANTI INI: Nomor DANA kamu
    DANA_NAME: 'Nama Pemilik DANA', // GANTI INI: Nama pemilik DANA
    QRIS_IMAGE: '/qris.png', // Taruh gambar QRIS di folder public/qris.png
    MIN_DEPOSIT: 1000,
    MAX_UPLOAD: 5 * 1024 * 1024, // 5MB
    UPLOAD_DIR: './data/uploads'
  },

  // --- KONFIGURASI ADMIN WEB ---
  ADMIN: {
    username: 'admin',
    password: 'admin123' // GANTI INI: Password admin web kamu
  },

  // --- KONFIGURASI PTERODACTYL (NYATA) ---
  PTERODACTYL: {
    URL: 'https://panel.domainmu.com', // GANTI INI: URL Panel Pterodactyl
    API_KEY: 'ptla_xxxxxxxxxxxxxxxxxxxxxxxx', // GANTI INI: Application API Key
    NEST_ID: 1, // Sesuaikan dengan Nest ID di panel
    EGG_ID: 1, // Sesuaikan dengan Egg ID game
    DEFAULT_ALLOCATION: 1, // Allocation ID default
    DOCKER_IMAGE: 'ghcr.io/parkervcp/yolks:nodejs_18',
    STARTUP: 'npm start'
  },

  // --- KONFIGURASI SMS NOKOS (NYATA) ---
  // Contoh menggunakan format SMSTwins/SVNumber. Sesuaikan dengan providermu.
  SMS: {
    API_KEY: 'api_key_sms_kamu_disini', // GANTI INI
    BASE_URL: 'https://api.smstwins.com/v1', // GANTI INI: URL API Provider
  },

  // --- KONFIGURASI DISCORD BOT (NYATA) ---
  DISCORD: {
    BOT_TOKEN: 'MTExMjM0NTY3ODkw...', // GANTI INI: Token Bot Discord
    GUILD_ID: '123456789012345678' // GANTI INI: ID Server Discord kamu
  },

  // --- KONFIGURASI AI ---
  AI: {
    ENDPOINT: 'https://apiii-xrina.my.id/ai/gpt',
    TIMEOUT: 30000,
    MAX_LENGTH: 2000
  },

  // --- HARGA PANEL (MB = RAM asli di Pterodactyl) ---
  PANEL_PRICES: [
    { ram: '1 GB',  mb: 1024,  harga: 1000 },
    { ram: '2 GB',  mb: 2048,  harga: 2000 },
    { ram: '3 GB',  mb: 3072,  harga: 3000 },
    { ram: '4 GB',  mb: 4096,  harga: 4000 },
    { ram: '5 GB',  mb: 5120,  harga: 5000 },
    { ram: '6 GB',  mb: 6144,  harga: 6000 },
    { ram: '7 GB',  mb: 7168,  harga: 7000 },
    { ram: '8 GB',  mb: 8192,  harga: 8000 },
    { ram: '9 GB',  mb: 9216,  harga: 9000 },
    { ram: '10 GB', mb: 10240, harga: 10000 },
    { ram: 'UNLIMITED', mb: 0, harga: 12000, unli: true }
  ],

  // --- HARGA NOKOS ---
  NOKOS_LIST: [
    { name: 'WhatsApp', serviceCode: 'wa', harga: 3000 },
    { name: 'Telegram', serviceCode: 'tg', harga: 2500 },
    { name: 'Instagram', serviceCode: 'ig', harga: 3500 }
  ],

  // --- ROLE & LIMIT ---
  ROLE_LIST: [
    { name: 'Reseller', harga: 10000, limit: 2, discordRoleId: '111111111111111111' }, // GANTI ID ROLE
    { name: 'Admin', harga: 25000, limit: 3, discordRoleId: '222222222222222222' }, // GANTI ID ROLE
    { name: 'Owner', harga: 35000, limit: 5, discordRoleId: '333333333333333333' }, // GANTI ID ROLE
    { name: 'Partner', harga: 45000, limit: 7, discordRoleId: '444444444444444444' }, // GANTI ID ROLE
    { name: 'Tangan Kanan', harga: 55000, limit: 10, discordRoleId: '555555555555555555' } // GANTI ID ROLE
  ]
};
