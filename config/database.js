const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Ошибка подключения к БД:', err.message);
  else console.log('Подключено к SQLite базе данных');
});

// Включаем WAL mode для корректной конкурентной работы нескольких пользователей
db.run('PRAGMA journal_mode = WAL');
// Усиливаем безопасность
db.run('PRAGMA foreign_keys = ON');

function initializeDatabase() {
  db.serialize(() => {
    // ======================== USERS ========================
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      status TEXT DEFAULT 'online',
      bio TEXT DEFAULT '',
      e2e_public_key TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Миграции: добавляем колонки если их нет
    db.run(`ALTER TABLE users ADD COLUMN e2e_public_key TEXT DEFAULT ''`, (err) => {
      // Игнорируем ошибку "duplicate column name" — это нормально при повторном запуске
      if (err && !err.message.includes('duplicate column name')) {
        console.error('[db] Migration error e2e_public_key:', err.message);
      }
    });

    // ======================== FRIENDSHIPS ========================
    db.run(`CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (friend_id) REFERENCES users(id),
      UNIQUE(user_id, friend_id)
    )`);

    // ======================== MESSAGES ========================
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT DEFAULT '',
      type TEXT DEFAULT 'text',
      file_url TEXT DEFAULT '',
      file_name TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (receiver_id) REFERENCES users(id)
    )`);

    // Миграции
    db.run(`ALTER TABLE messages ADD COLUMN file_name TEXT DEFAULT ''`, (err) => {
      if (err && !err.message.includes('duplicate')) console.error('[db]', err.message);
    });
    db.run(`ALTER TABLE messages ADD COLUMN thumb_url TEXT DEFAULT ''`, (err) => {
      if (err && !err.message.includes('duplicate')) console.error('[db]', err.message);
    });
    db.run(`ALTER TABLE messages ADD COLUMN edited_at DATETIME DEFAULT NULL`, (err) => {
      if (err && !err.message.includes('duplicate')) console.error('[db]', err.message);
    });
    db.run(`ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate')) console.error('[db]', err.message);
    });
    db.run(`ALTER TABLE messages ADD COLUMN reply_to INTEGER DEFAULT NULL`, (err) => {
      if (err && !err.message.includes('duplicate')) console.error('[db]', err.message);
    });
    db.run(`ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT ''`, (err) => {
      if (err && !err.message.includes('duplicate')) console.error('[db]', err.message);
    });

    // Таблица реакций
    db.run(`CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(message_id, user_id, emoji)
    )`);

    // ======================== WALL POSTS ========================
    db.run(`CREATE TABLE IF NOT EXISTS wall_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      likes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (author_id) REFERENCES users(id)
    )`);

    // ======================== POST COMMENTS ========================
    db.run(`CREATE TABLE IF NOT EXISTS post_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES wall_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // ======================== POST LIKES ========================
    db.run(`CREATE TABLE IF NOT EXISTS post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES wall_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(post_id, user_id)
    )`);

    // ======================== MUSIC TRACKS ========================
    db.run(`CREATE TABLE IF NOT EXISTS music_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      title TEXT DEFAULT '',
      artist TEXT DEFAULT '',
      duration INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // ======================== ИНДЕКСЫ ========================
    
    // Messages
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, is_read)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_file_name ON messages(file_name)`);

    // Friendships
    db.run(`CREATE INDEX IF NOT EXISTS idx_friendships_user_status ON friendships(user_id, status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_friendships_friend_status ON friendships(friend_id, status)`);

    // Wall posts
    db.run(`CREATE INDEX IF NOT EXISTS idx_wall_posts_user ON wall_posts(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_wall_posts_author ON wall_posts(author_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_wall_posts_created ON wall_posts(created_at DESC)`);

    // Comments
    db.run(`CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id)`);

    // Likes
    db.run(`CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id)`);

    // Music
    db.run(`CREATE INDEX IF NOT EXISTS idx_music_tracks_user ON music_tracks(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_music_tracks_created ON music_tracks(created_at DESC)`);

    console.log('[db] База данных инициализирована');
  });
}

initializeDatabase();

module.exports = db;
