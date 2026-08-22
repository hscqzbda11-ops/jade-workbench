const Parser = require('rss-parser');
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' } });

const FEEDS = [
  { category: '英语', url: 'https://www.eslbuzz.com/feed/' },
  { category: '英语', url: 'https://learningenglish.voanews.com/api/zyritemor' },
  { category: '高数', url: 'https://www.sciencedaily.com/rss/computers_math/mathematics.xml' },
  { category: '高数', url: 'https://www.siam.org/rss/siam-news.xml' },
  { category: '药学', url: 'https://www.pharmatimes.com/rss' },
  { category: '药学', url: 'https://www.fiercepharma.com/rss/xml' },
  { category: '报考', url: 'https://www.insidehighered.com/rss/finance' },
  { category: '报考', url: 'https://www.chronicle.com/rss' },
  { category: '学习资料', url: 'https://www.edutopia.org/rss' },
  { category: '学习资料', url: 'https://www.technology.org/feed/' },
];

const BUILTIN = [
  { category: '英语', title: '专升本英语高频词汇：abandon/absorb/abstract 详解', description: 'abandon v.放弃；absorb v.吸收；abstract adj.抽象的。掌握这些核心词汇是专升本英语提分的关键。', source: 'Jade内置资料' },
  { category: '英语', title: '专升本英语阅读理解答题技巧', description: '先读题目再读文章，定位关键词，注意转折词but/however/although后的内容通常是考点。', source: 'Jade内置资料' },
  { category: '英语', title: '专升本英语写作万能句型', description: '1. It is widely acknowledged that... 2. There is no denying that... 3. As far as I am concerned...', source: 'Jade内置资料' },
  { category: '高数', title: '专升本高数：极限计算方法总结', description: '洛必达法则、等价无穷小替换、夹逼定理是求极限的三大核心方法。', source: 'Jade内置资料' },
  { category: '高数', title: '专升本高数：定积分换元法步骤', description: '1.令t=新变量 2.换上下限 3.计算积分 4.回代或直接用新上下限计算。', source: 'Jade内置资料' },
  { category: '高数', title: '专升本高数：导数基本公式速记', description: '(sin x)\'=cos x, (cos x)\'=-sin x, (e^x)\'=e^x, (ln x)\'=1/x, (x^n)\'=n*x^(n-1)。', source: 'Jade内置资料' },
  { category: '药学', title: '药学专升本：药剂学核心知识点', description: '剂型分类：液体剂型、固体剂型、半固体剂型、气体剂型。常用辅料包括填充剂、粘合剂、崩解剂、润滑剂。', source: 'Jade内置资料' },
  { category: '药学', title: '药学专升本：药理学重点药物分类', description: '抗菌药物、心血管药物、消化系统药物、神经系统药物。掌握各类代表药物及作用机制。', source: 'Jade内置资料' },
  { category: '报考', title: '专升本报考：药学对口院校推荐', description: '中国药科大学、沈阳药科大学、广东药科大学等是药学专升本对口热门院校。', source: 'Jade内置资料' },
  { category: '报考', title: '专升本报考时间节点提醒', description: '一般每年3-4月报名，5-6月考试，7-8月录取。具体时间以各省教育考试院通知为准。', source: 'Jade内置资料' },
  { category: '学习资料', title: '专升本备考策略：三阶段复习法', description: '第一阶段基础夯实(2-3月)，第二阶段强化训练(1-2月)，第三阶段冲刺模考(2-4周)。', source: 'Jade内置资料' },
  { category: '学习资料', title: '专升本各科目分值分布与复习优先级', description: '英语150分、高数150分、专业课150分。根据自身强弱项合理分配时间。', source: 'Jade内置资料' },
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

async function crawlEducation() {
  const all = [...BUILTIN.map(b => ({ ...b, link: '', pub_date: new Date().toISOString() }))];
  for (const feed of FEEDS) {
    try {
      const xml = await fetchFeed(feed.url);
      const result = await parser.parseString(xml);
      for (const item of (result.items || []).slice(0, 8)) {
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
      console.log(`[Edu] ${feed.category}: fetched ${result.items?.length || 0} from ${feed.url}`);
    } catch (e) {
      console.error(`[Edu] ${feed.category} FAIL: ${feed.url} - ${e.message}`);
    }
  }
  return all;
}

module.exports = { crawlEducation, EDU_CATEGORIES: ['英语','高数','药学','报考','学习资料'] };
