const Parser = require('rss-parser');
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' } });

const FEEDS = [
  { category: '时政', url: 'https://feeds.bbci.co.uk/news/politics/rss.xml' },
  { category: '时政', url: 'https://feeds.npr.org/1001/rss.xml' },
  { category: '世界', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { category: '世界', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { category: '世界', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { category: '金融', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { category: '金融', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { category: '财政', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { category: '股票', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { category: '股票', url: 'https://feeds.content.dowjones.io/public/rss/SB10001424053111904265604576568931860469180RSSFeed' },
  { category: '基金', url: 'https://www.cnbc.com/id/10000655/device/rss/rss.html' },
  { category: '民生', url: 'https://feeds.bbci.co.uk/news/education/rss.xml' },
  { category: '民生', url: 'https://feeds.npr.org/1008/rss.xml' },
  { category: '经营', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html' },
  { category: '经营', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { category: '信息差', url: 'https://www.theverge.com/rss/index.xml' },
  { category: '信息差', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

function cleanText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if (v._) return v._;
    if (v['#']) return v['#'];
    if (v.value) return v.value;
    const s = JSON.stringify(v);
    const m = s.match(/"_":"([^"]+)"/);
    if (m) return m[1];
    const m2 = s.match(/"([^"]{5,})"/);
    if (m2) return m2[1];
    return '';
  }
  return String(v);
}

async function crawlWorld() {
  const all = [];
  for (const feed of FEEDS) {
    try {
      const xml = await fetchFeed(feed.url);
      const result = await parser.parseString(xml);
      for (const item of (result.items || []).slice(0, 10)) {
        const desc = (item.contentSnippet || item.content || item.summary || '')
          .replace(/<[^>]*>/g, '').substring(0, 500);
        all.push({
          title: cleanText(item.title) || '无标题',
          link: item.link || feed.url,
          description: desc,
          category: feed.category,
          source: result.title || feed.url,
          pub_date: item.isoDate || item.pubDate || new Date().toISOString(),
        });
      }
      console.log(`[World] ${feed.category}: fetched ${result.items?.length || 0} from ${feed.url}`);
    } catch (e) {
      console.error(`[World] ${feed.category} FAIL: ${feed.url} - ${e.message}`);
    }
  }
  return all;
}

module.exports = { crawlWorld, WORLD_CATEGORIES: ['时政','世界','金融','战争','财政','股票','基金','民生','经营','信息差'] };
