const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'jade.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS world_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    link TEXT,
    description TEXT,
    category TEXT NOT NULL,
    source TEXT,
    pub_date TEXT,
    fetched_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(link, title)
  );

  CREATE TABLE IF NOT EXISTS education_news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    link TEXT,
    description TEXT,
    category TEXT NOT NULL,
    source TEXT,
    pub_date TEXT,
    fetched_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(link, title)
  );

  CREATE INDEX IF NOT EXISTS idx_world_cat ON world_news(category);
  CREATE INDEX IF NOT EXISTS idx_edu_cat ON education_news(category);
  CREATE INDEX IF NOT EXISTS idx_world_date ON world_news(fetched_at);
  CREATE INDEX IF NOT EXISTS idx_edu_date ON education_news(fetched_at);
`);

function sanitize(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function insertNews(table, items) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO ${table} (title, link, description, category, source, pub_date)
    VALUES (@title, @link, @description, @category, @source, @pub_date)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run({
        title: sanitize(r.title),
        link: sanitize(r.link),
        description: sanitize(r.description),
        category: sanitize(r.category),
        source: sanitize(r.source),
        pub_date: sanitize(r.pub_date),
      });
    }
  });
  tx(items);
}

function getNews(table, category, limit = 100) {
  if (category && category !== 'all') {
    return db.prepare(`
      SELECT * FROM ${table} WHERE category = ? ORDER BY fetched_at DESC LIMIT ?
    `).all(category, limit);
  }
  return db.prepare(`
    SELECT * FROM ${table} ORDER BY fetched_at DESC LIMIT ?
  `).all(limit);
}

function getNewsStats(table) {
  const total = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
  const byCat = db.prepare(`
    SELECT category, COUNT(*) as c FROM ${table} GROUP BY category
  `).all();
  const latest = db.prepare(`
    SELECT fetched_at FROM ${table} ORDER BY fetched_at DESC LIMIT 1
  `).get();
  return { total, byCat, latest: latest ? latest.fetched_at : null };
}

module.exports = { db, insertNews, getNews, getNewsStats };
