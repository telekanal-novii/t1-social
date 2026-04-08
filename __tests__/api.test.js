/**
 * Базовые интеграционные тесты API
 * Запуск: npm test
 */

// ═══════════════════════════════════════════════════════
// Env vars — ОБЯЗАТЕЛЬНО до любого require!
// ═══════════════════════════════════════════════════════
const TEST_DB = require('path').join(__dirname, 'test-database.sqlite');
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-purposes-min-32chars';

try { require('fs').unlinkSync(TEST_DB); } catch {}

// Мокаем database модуль ПЕРЕД загрузкой роутов
jest.mock('../config/database', () => {
  const sqlite3 = require('sqlite3').verbose();
  const path = require('path');
  const dbPath = path.join(__dirname, 'test-database.sqlite');
  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      status TEXT DEFAULT 'online',
      bio TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });

  return db;
});

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('../src/routes/auth.routes');

let testDb;
let app;

beforeAll(() => {
  testDb = require('../config/database');
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(authRoutes);
});

afterAll((done) => {
  testDb.close(() => {
    try { require('fs').unlinkSync(TEST_DB); } catch {}
    done();
  });
});

describe('POST /api/register', () => {
  it('должен зарегистрировать пользователя с валидными данными', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ username: 'testuser1', password: 'testpass123' });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('username', 'testuser1');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('должен отклонить пароль короче 8 символов', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ username: 'testuser2', password: 'short' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/8 символов/);
  });

  it('должен отклонить username с недопустимыми символами', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ username: 'invalid user!', password: 'testpass123' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/2-30 символов/);
  });

  it('должен отклонить слишком короткий username', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ username: 'a', password: 'testpass123' });

    expect(res.statusCode).toBe(400);
  });

  it('должен отклонить дубликат username', async () => {
    await request(app)
      .post('/api/register')
      .send({ username: 'dup_user', password: 'testpass123' });

    const res = await request(app)
      .post('/api/register')
      .send({ username: 'dup_user', password: 'testpass123' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/уже занят/);
  });
});

describe('POST /api/login', () => {
  it('должен авторизовать с правильными данными', async () => {
    // Сначала регистрируем
    await request(app)
      .post('/api/register')
      .send({ username: 'login_user', password: 'loginpass123' });

    const res = await request(app)
      .post('/api/login')
      .send({ username: 'login_user', password: 'loginpass123' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('userId');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('должен отклонить неверный пароль', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'login_user', password: 'wrongpassword' });

    expect(res.statusCode).toBe(401);
  });

  it('должен отклонить отсутствующего пользователя', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'nonexistent', password: 'somepass' });

    expect(res.statusCode).toBe(401);
  });
});
