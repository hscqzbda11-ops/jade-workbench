const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const { db, insertNews, getNews, getNewsStats } = require('./db');
const { crawlWorld, WORLD_CATEGORIES } = require('./crawlers/world');
const { crawlEducation, EDU_CATEGORIES } = require('./crawlers/education');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ 资讯抓取 ============
async function runWorldCrawl() {
  console.log('[Cron] 开始抓取「我与世界」资讯...');
  try {
    const items = await crawlWorld();
    insertNews('world_news', items);
    console.log(`[Cron] 「我与世界」抓取完成，共 ${items.length} 条`);
  } catch (e) {
    console.error('[Cron] 「我与世界」抓取失败:', e.message);
  }
}

async function runEduCrawl() {
  console.log('[Cron] 开始抓取「专升本专区」资讯...');
  try {
    const items = await crawlEducation();
    insertNews('education_news', items);
    console.log(`[Cron] 「专升本专区」抓取完成，共 ${items.length} 条`);
  } catch (e) {
    console.error('[Cron] 「专升本专区」抓取失败:', e.message);
  }
}

// ============ API 路由 ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/world/news', (req, res) => {
  const { category, limit } = req.query;
  const items = getNews('world_news', category, parseInt(limit) || 100);
  res.json({ items, categories: WORLD_CATEGORIES });
});

app.get('/api/world/stats', (req, res) => {
  res.json(getNewsStats('world_news'));
});

app.get('/api/education/news', (req, res) => {
  const { category, limit } = req.query;
  const items = getNews('education_news', category, parseInt(limit) || 100);
  res.json({ items, categories: EDU_CATEGORIES });
});

app.get('/api/education/stats', (req, res) => {
  res.json(getNewsStats('education_news'));
});

app.post('/api/crawl/world', async (req, res) => {
  await runWorldCrawl();
  res.json({ msg: 'ok' });
});

app.post('/api/crawl/education', async (req, res) => {
  await runEduCrawl();
  res.json({ msg: 'ok' });
});

// ============ 定时任务 ============
cron.schedule('*/40 * * * *', runWorldCrawl);
cron.schedule('*/50 * * * *', runEduCrawl);

// ============ 启动 ============
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Jade工作台服务器运行在端口 ${PORT}`);
  // 启动时立即抓取一次
  runWorldCrawl();
  setTimeout(() => runEduCrawl(), 5000);
});
