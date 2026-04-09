/**
 * T1 Сеть — Express сервер
 * Точка входа приложения
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');

const { setupSocket } = require('./src/socket/socket');
const db = require('./config/database');

// Routes
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const friendRoutes = require('./src/routes/friend.routes');
const messageRoutes = require('./src/routes/message.routes');
const wallRoutes = require('./src/routes/wall.routes');
const musicRoutes = require('./src/routes/music.routes');

// Config
const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.ALLOWED_ORIGIN || 'http://localhost:3000')
      : 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST']
  }
});

// === Rate Limiting ===
// Строгий лимит для авторизации (защита от брутфорса)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 10, // 10 попыток
  message: { error: 'Слишком много попыток, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false
});

// Общий лимит для API
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 минута
  max: 200, // 200 запросов в минуту
  message: { error: 'Слишком много запросов' },
  standardHeaders: true,
  legacyHeaders: false
});

// === Middleware ===
// Trust proxy для корректной работы за reverse proxy (HF Spaces)
app.set('trust proxy', 1);

// Helmet — security headers (CSP, X-Frame-Options, HSTS и т.д.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'self'", "https://huggingface.co", "https://*.hf.space"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    }
  },
  crossOriginEmbedderPolicy: false,
}));

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://huggingface.co',
  'https://f0r3d8-t1-social.hf.space',
  'https://f0r3d8.space'
];

app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без Origin (мобильные приложения, curl)
    if (!origin) return callback(null, true);
    // Разрешаем любой hf.space поддомен
    if (origin.endsWith('.hf.space') || origin.includes('huggingface.co')) return callback(null, true);
    // Разрешаем localhost для разработки
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Недопустимый origin'));
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Disable caching for SPA
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'public', 'media')));

// === Socket.IO ===
setupSocket(io, db);
app.locals.io = io; // Делаем io доступным в маршрутах

// === API Routes ===
app.use('/api/register', authLimiter);
app.use('/api/login', authLimiter);

// Общий лимит для всех остальных API
app.use('/api/', apiLimiter);

app.use(authRoutes);
app.use(userRoutes);
app.use(friendRoutes);
app.use(messageRoutes);
app.use(wallRoutes);
app.use(musicRoutes);

// === SPA Fallback ===
const validPages = ['feed', 'profile', 'friends', 'messages', 'people', 'music'];

// Убираем trailing slash для SPA страниц
app.use((req, res, next) => {
  const pathWithoutSlash = req.path.endsWith('/') ? req.path.slice(0, -1) : req.path;
  if (validPages.includes(pathWithoutSlash.slice(1)) && req.path.endsWith('/')) {
    return res.redirect(301, pathWithoutSlash);
  }
  next();
});

app.get('/:page', (req, res) => {
  const page = req.params.page;
  if (validPages.includes(page) || (page !== 'dashboard.html' && !page.includes('.'))) {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } else {
    res.status(404).send('Страница не найдена');
  }
});

// Root — auth page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  db.get('SELECT 1', (err) => {
    if (err) return res.status(503).json({ status: 'error', database: 'disconnected' });
    res.json({ status: 'ok', database: 'connected', uptime: process.uptime() });
  });
});

// === Error Handler ===
app.use((err, req, res, _next) => {
  // Логируем ошибку (в проде можно писать в файл)
  if (process.env.NODE_ENV !== 'production') {
    console.error('❌ Server error:', err.message);
    console.error(err.stack);
  } else {
    console.error('❌ Server error:', err.status || 500);
  }

  // Не раскрываем детали ошибки клиенту
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// === Start Server ===
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    console.log('HTTP server closed');
    db.close();
    console.log('Database connection closed');
    process.exit(0);
  });
  // Если не закрылось за 10 секунд — принудительно
  setTimeout(() => {
    console.error('Force closing after 10s timeout');
    process.exit(1);
  }, 10000);
};

// Глобальные обработчики ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

// Graceful shutdown signals

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
