/* ===== Jade 工作台 资讯模块 ===== */

// HTML 转义工具
function _esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 复制到剪贴板（兼容 iOS Safari）
async function _copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    console.warn('Clipboard API 不可用，回退到 execCommand', e);
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.opacity = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.error('复制失败', e);
    return false;
  }
}

// CORS 代理列表（轮流尝试）
const CORS_PROXIES = [
  (url) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
  (url) => 'https://corsproxy.io/?url=' + encodeURIComponent(url),
  (url) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url),
];

// RSS 源定义
const WORLD_FEEDS = [
  { category: '时政', url: 'https://feeds.npr.org/1001/rss.xml' },
  { category: '世界', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { category: '金融', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { category: '财政', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { category: '股票', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { category: '基金', url: 'https://www.cnbc.com/id/10000655/device/rss/rss.html' },
  { category: '民生', url: 'https://feeds.npr.org/1008/rss.xml' },
  { category: '经营', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html' },
  { category: '信息差', url: 'https://www.theverge.com/rss/index.xml' },
  { category: '信息差', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];

const EDU_FEEDS = [
  { category: '英语', url: 'https://www.eslbuzz.com/feed/' },
  { category: '高数', url: 'https://www.sciencedaily.com/rss/computers_math/mathematics.xml' },
  { category: '药学', url: 'https://www.fiercepharma.com/rss/xml' },
];

// 通过 CORS 代理抓取 RSS 并解析
async function fetchRSSViaProxy(feedUrl) {
  for (const proxyFn of CORS_PROXIES) {
    try {
      const proxyUrl = proxyFn(feedUrl);
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const xmlText = await res.text();
      if (!xmlText || xmlText.length < 50) continue;
      return parseRSSXML(xmlText, feedUrl);
    } catch (e) {
      console.warn(`Proxy failed for ${feedUrl}:`, e.message);
    }
  }
  return [];
}

// 解析 RSS XML
function parseRSSXML(xmlText, feedUrl) {
  const items = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const channel = doc.querySelector('channel');
    const channelTitle = channel ? (channel.querySelector('title')?.textContent || feedUrl) : feedUrl;

    const itemNodes = doc.querySelectorAll('item');
    itemNodes.forEach((node, i) => {
      if (i >= 10) return;
      const title = getText(node, 'title');
      const link = getText(node, 'link');
      const desc = getText(node, 'description');
      const pubDate = getText(node, 'pubDate') || getText(node, 'pubDate');
      items.push({
        title: cleanRSSValue(title) || '无标题',
        link: link || feedUrl,
        description: stripHTML(desc).substring(0, 500),
        source: cleanRSSValue(channelTitle) || feedUrl,
        pub_date: pubDate || new Date().toISOString(),
      });
    });
  } catch (e) {
    console.warn('XML parse failed:', e.message);
  }
  return items;
}

function getText(node, tag) {
  const el = node.querySelector(tag);
  return el ? el.textContent : '';
}

function cleanRSSValue(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    if (v._) return v._;
    if (v['#']) return v['#'];
    const s = JSON.stringify(v);
    const m = s.match(/"_[^"]*":"([^"]+)"/);
    if (m) return m[1];
    const m2 = s.match(/"([^"]{5,})"/);
    if (m2) return m2[1];
    return '';
  }
  return String(v);
}

function stripHTML(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

const News = {
  // ===== 内存缓存 =====
  worldCache: { items: [], categories: [], time: null },
  eduCache: { items: [], categories: [], time: null },

  // ===== 当前选中的分类 =====
  worldCategory: 'all',
  eduCategory: 'all',

  // ===== 加载状态 =====
  worldLoaded: false,
  eduLoaded: false,

  // ===== 当前渲染的列表（供 onclick 索引查找） =====
  _worldItems: [],
  _eduItems: [],

  // ===== 默认分类 =====
  WORLD_CATEGORIES: ['时政', '世界', '金融', '战争', '财政', '股票', '基金', '民生', '经营', '信息差'],
  EDU_CATEGORIES: ['英语', '高数', '药学', '报考', '学习资料'],

  // ===== 专升本内置学习资料 =====
  builtinEdu: [
    // —— 英语梯度短文 ——
    {
      id: 'edu_builtin_0', category: '英语',
      title: '【英语·初级】The Power of Habits',
      description: 'Habits shape our daily lives. Small changes, like reading ten minutes a day or walking after dinner, can lead to big results over time. Start small, stay consistent, and you will see the difference. Good habits are the foundation of success. 习惯塑造我们的日常生活。每天阅读十分钟或饭后散步等小改变，日积月累会带来巨大成果。从小事做起，保持坚持，你会看到不同。',
      source: 'Jade内置·英语梯度短文',
    },
    {
      id: 'edu_builtin_1', category: '英语',
      title: '【英语·中级】Technology and Daily Life',
      description: 'Technology has transformed how we live, work, and communicate. While it brings convenience and efficiency, it also raises concerns about privacy and social isolation. The key lies in finding a balance — using technology as a tool rather than letting it control us. We must learn to disconnect and engage with the real world. 科技改变了我们的生活、工作和沟通方式。虽然带来便利，但也引发隐私和社交隔离的担忧。关键在于找到平衡——将科技作为工具而非让它控制我们。',
      source: 'Jade内置·英语梯度短文',
    },
    {
      id: 'edu_builtin_2', category: '英语',
      title: '【英语·高级】The Philosophy of Continuous Learning',
      description: 'Lifelong learning is not merely an educational concept but a philosophical stance toward existence. In an era characterized by rapid technological advancement and societal transformation, the willingness to acquire new knowledge and adapt to changing circumstances distinguishes those who thrive from those who merely survive. The pursuit of wisdom, therefore, is both a practical necessity and a moral imperative. 终身学习不仅是一种教育理念，更是一种对待存在的哲学立场。在技术飞速发展和社会变革的时代，主动获取新知识、适应变化的能力，是卓越者与勉强生存者的分水岭。',
      source: 'Jade内置·英语梯度短文',
    },
    // —— 高数公式 ——
    {
      id: 'edu_builtin_3', category: '高数',
      title: '【高数公式】导数基本公式速记表',
      description: '常数：(C)\'=0\n幂函数：(x^n)\'=n·x^(n-1)\n三角函数：(sin x)\'=cos x，(cos x)\'=-sin x，(tan x)\'=sec²x，(cot x)\'=-csc²x\n指数：(e^x)\'=e^x，(a^x)\'=a^x·ln a\n对数：(ln x)\'=1/x，(logₐx)\'=1/(x·ln a)\n四则运算：(u±v)\'=u\'±v\'，(uv)\'=u\'v+uv\'，(u/v)\'=(u\'v-uv\')/v²\n复合函数：[f(g(x))]\'=f\'(g(x))·g\'(x)',
      source: 'Jade内置·高数公式',
    },
    {
      id: 'edu_builtin_4', category: '高数',
      title: '【高数公式】不定积分基本公式速记表',
      description: '∫x^n dx = x^(n+1)/(n+1) + C  (n≠-1)\n∫1/x dx = ln|x| + C\n∫e^x dx = e^x + C\n∫a^x dx = a^x/ln a + C\n∫sin x dx = -cos x + C\n∫cos x dx = sin x + C\n∫sec²x dx = tan x + C\n∫csc²x dx = -cot x + C\n∫1/(1+x²) dx = arctan x + C\n∫1/√(1-x²) dx = arcsin x + C\n分部积分：∫u dv = uv - ∫v du\n换元法：∫f(g(x))g\'(x)dx = ∫f(u)du  (u=g(x))',
      source: 'Jade内置·高数公式',
    },
    {
      id: 'edu_builtin_5', category: '高数',
      title: '【高数公式】极限计算三大核心方法',
      description: '1. 洛必达法则：对 0/0 或 ∞/∞ 型极限，对分子分母分别求导后再求极限。条件：分子分母在去心邻域可导且分母导数不为零。\n2. 等价无穷小替换（x→0时）：sin x ~ x，tan x ~ x，arcsin x ~ x，arctan x ~ x，ln(1+x) ~ x，e^x-1 ~ x，1-cos x ~ x²/2，(1+x)^a-1 ~ ax。\n3. 夹逼定理：若 g(x)≤f(x)≤h(x) 且 lim g(x)=lim h(x)=L，则 lim f(x)=L。关键：找到合适的不等式放缩。',
      source: 'Jade内置·高数公式',
    },
    {
      id: 'edu_builtin_6', category: '高数',
      title: '【高数公式】微分中值定理汇总',
      description: '罗尔定理：若 f(x) 在 [a,b] 连续，(a,b) 可导，且 f(a)=f(b)，则 ∃ξ∈(a,b) 使 f\'(ξ)=0。\n拉格朗日中值定理：若 f(x) 在 [a,b] 连续，(a,b) 可导，则 ∃ξ∈(a,b) 使 f\'(ξ)=(f(b)-f(a))/(b-a)。\n柯西中值定理：若 f(x)、g(x) 在 [a,b] 连续，(a,b) 可导且 g\'(x)≠0，则 ∃ξ∈(a,b) 使 [f(b)-f(a)]/[g(b)-g(a)]=f\'(ξ)/g\'(ξ)。\n积分中值定理：若 f(x) 在 [a,b] 连续，则 ∃ξ∈[a,b] 使 ∫ₐᵇf(x)dx=f(ξ)(b-a)。',
      source: 'Jade内置·高数公式',
    },
    // —— 药学资料 ——
    {
      id: 'edu_builtin_7', category: '药学',
      title: '【药学资料】药剂学剂型分类体系',
      description: '1. 液体剂型：溶液剂、糖浆剂、乳剂、混悬剂、酊剂、醑剂、甘油剂。\n2. 固体剂型：片剂、胶囊剂、散剂、颗粒剂、丸剂、膜剂。\n3. 半固体剂型：软膏剂、乳膏剂、糊剂、凝胶剂、栓剂。\n4.气体剂型：气雾剂、喷雾剂、吸入粉雾剂。\n5. 注射剂型：注射液、注射用无菌粉末、输液。\n6. 新型给药系统：缓释制剂、控释制剂、靶向制剂（脂质体、微球、纳米粒）。',
      source: 'Jade内置·药学资料',
    },
    {
      id: 'edu_builtin_8', category: '药学',
      title: '【药学资料】药理学重点药物分类速记',
      description: '抗菌药物：β-内酰胺类（青霉素、头孢菌素）、大环内酯类（红霉素、阿奇霉素）、氨基糖苷类（庆大霉素、阿米卡星）、喹诺酮类（环丙沙星、左氧氟沙星）。\n心血管药物：降压药（ACEI-卡托普利、ARB-缬沙坦、CCB-氨氯地平）、抗心律失常药（胺碘酮、利多卡因）、降脂药（他汀类-阿托伐他汀）。\n消化系统药物：抗酸药（铝碳酸镁）、抑酸药（奥美拉唑）、胃黏膜保护剂（硫糖铝）、促动力药（多潘立酮）。',
      source: 'Jade内置·药学资料',
    },
    {
      id: 'edu_builtin_9', category: '药学',
      title: '【药学资料】药物代谢动力学核心参数',
      description: '半衰期 (t₁/₂)：血药浓度下降一半所需时间，决定给药间隔。一般经过 5-7 个半衰期达稳态。\n生物利用度 (F)：药物进入体循环的量与给药量的比值，静脉给药 F=100%。\n表观分布容积 (Vd)：体内药物总量与血药浓度的比值，反映药物分布广泛程度。\n清除率 (CL)：单位时间内被清除的药物表观分布容积。\n达峰时间 (Tmax)：给药后血药浓度达峰值的时间。\n峰浓度 (Cmax)：给药后达到的最高血药浓度。\n药时曲线下面积 (AUC)：反映药物生物利用度和总暴露量。',
      source: 'Jade内置·药学资料',
    },
    {
      id: 'edu_builtin_10', category: '报考',
      title: '专升本报考：药学对口院校推荐',
      description: '中国药科大学、沈阳药科大学、广东药科大学等是药学专升本对口热门院校。各省具体招生计划需关注当地教育考试院发布的最新通知。',
      source: 'Jade内置资料',
    },
    {
      id: 'edu_builtin_11', category: '报考',
      title: '专升本报考时间节点提醒',
      description: '一般每年3-4月报名，5-6月考试，7-8月录取。具体时间以各省教育考试院通知为准。',
      source: 'Jade内置资料',
    },
    {
      id: 'edu_builtin_12', category: '学习资料',
      title: '专升本备考策略：三阶段复习法',
      description: '第一阶段基础夯实(2-3月)，第二阶段强化训练(1-2月)，第三阶段冲刺模考(2-4周)。',
      source: 'Jade内置资料',
    },
    {
      id: 'edu_builtin_13', category: '学习资料',
      title: '专升本各科目分值分布与复习优先级',
      description: '英语150分、高数150分、专业课150分。根据自身强弱项合理分配时间。',
      source: 'Jade内置资料',
    },
  ],

  // ===== 预加载 =====
  async preload() {
    await Promise.all([
      this.loadWorld().catch(e => console.error('世界资讯预加载失败', e)),
      this.loadEdu().catch(e => console.error('专升本资讯预加载失败', e)),
    ]);
  },

  // ===== 加载世界资讯 =====
  async loadWorld() {
    const loading = document.getElementById('world-loading');
    if (loading) loading.style.display = '';
    try {
      // 先尝试后端 API
      let items = [];
      try {
        const res = await fetch('/api/world/news?limit=100', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          items = (data.items || []).map(it => ({ ...it }));
        }
      } catch (e) {
        console.log('后端API不可用，切换到直接抓取模式');
      }

      // 后端不可用时，直接通过CORS代理抓取RSS
      if (items.length === 0) {
        console.log('开始直接抓取世界RSS...');
        const results = await Promise.allSettled(
          WORLD_FEEDS.map(f => fetchRSSViaProxy(f.url).then(items => items.map(it => ({ ...it, category: f.category }))))
        );
        results.forEach(r => {
          if (r.status === 'fulfilled') items.push(...r.value);
        });
      }

      if (items.length > 0) {
        this.worldCache.items = items;
        this.worldCache.categories = this.WORLD_CATEGORIES;
        this.worldCache.time = new Date().toISOString();
        this.worldCache.items.sort((a, b) => {
          const da = new Date(a.pub_date || a.fetched_at || Date.now());
          const db = new Date(b.pub_date || b.fetched_at || Date.now());
          return db - da;
        });
        this.worldLoaded = true;
      }
    } catch (e) {
      console.error('加载世界资讯失败', e);
    } finally {
      if (loading) loading.style.display = 'none';
    }

    if (!this.worldLoaded) {
      const el = document.getElementById('world-news-list');
      if (el && this.worldCache.items.length === 0) {
        el.innerHTML = '<div class="text-center text-xs text-ash py-8">'
          + '资讯加载失败，请检查网络后重试<br>'
          + '<button onclick="News.loadWorld()" class="mt-3 px-3 py-1 bg-ink text-white rounded-lg text-xs">重新加载</button>'
          + '</div>';
      }
    } else {
      Toast.show('刷新失败，显示缓存数据');
    }
    if (Nav.current === 'world') this.renderWorld();
  },

  // ===== 加载专升本资讯 =====
  async loadEdu() {
    const loading = document.getElementById('edu-loading');
    if (loading) loading.style.display = '';
    try {
      let items = [];
      // 先尝试后端 API
      try {
        const res = await fetch('/api/education/news?limit=100', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          items = (data.items || []).map(it => ({ ...it }));
        }
      } catch (e) {
        console.log('后端API不可用，切换到直接抓取模式');
      }

      // 后端不可用时直接抓取
      if (items.length === 0) {
        console.log('开始直接抓取专升本RSS...');
        const results = await Promise.allSettled(
          EDU_FEEDS.map(f => fetchRSSViaProxy(f.url).then(items => items.map(it => ({ ...it, category: f.category }))))
        );
        results.forEach(r => {
          if (r.status === 'fulfilled') items.push(...r.value);
        });
      }

      if (items.length > 0) {
        this.eduCache.items = items;
        this.eduCache.categories = this.EDU_CATEGORIES;
        this.eduCache.time = new Date().toISOString();
        this.eduCache.items.sort((a, b) => {
          const da = new Date(a.pub_date || a.fetched_at || Date.now());
          const db = new Date(b.pub_date || b.fetched_at || Date.now());
          return db - da;
        });
        this.eduLoaded = true;
      }
    } catch (e) {
      console.error('加载专升本资讯失败', e);
    } finally {
      if (loading) loading.style.display = 'none';
    }

    if (!this.eduLoaded && this.eduCache.items.length === 0) {
      // 至少有内置资料
      this.eduLoaded = true;
      this.eduCache.time = new Date().toISOString();
    }
    if (Nav.current === 'edu') this.renderEdu();
  },

  // ===== 渲染世界资讯 =====
  renderWorld() {
    const cats = this.worldCache.categories.length ? this.worldCache.categories : this.WORLD_CATEGORIES;
    this.renderTabs('world-tabs', cats, this.worldCategory, 'News.setWorldCategory');
    this.renderWorldList();

    const timeEl = document.getElementById('world-update-time');
    if (timeEl) {
      if (this.worldCache.time) {
        timeEl.textContent = '更新于 ' + DateUtil.fmtFull(this.worldCache.time) + ' · 点击刷新';
        timeEl.style.cursor = 'pointer';
        timeEl.onclick = () => { Toast.show('正在刷新...'); this.loadWorld(); };
      } else if (!this.worldLoaded) {
        timeEl.textContent = '正在加载...';
        timeEl.style.cursor = 'default';
        timeEl.onclick = null;
      } else {
        timeEl.textContent = '暂无数据';
        timeEl.style.cursor = 'default';
        timeEl.onclick = null;
      }
    }
  },

  // ===== 渲染专升本资讯 =====
  renderEdu() {
    const cats = this.eduCache.categories.length ? this.eduCache.categories : this.EDU_CATEGORIES;
    this.renderTabs('edu-tabs', cats, this.eduCategory, 'News.setEduCategory');
    this.renderEduList();

    const timeEl = document.getElementById('edu-update-time');
    if (timeEl) {
      if (this.eduCache.time) {
        timeEl.textContent = '更新于 ' + DateUtil.fmtFull(this.eduCache.time) + ' · 点击刷新';
        timeEl.style.cursor = 'pointer';
        timeEl.onclick = () => { Toast.show('正在刷新...'); this.loadEdu(); };
      } else if (!this.eduLoaded) {
        timeEl.textContent = '正在加载...';
        timeEl.style.cursor = 'default';
        timeEl.onclick = null;
      } else {
        timeEl.textContent = '暂无数据';
        timeEl.style.cursor = 'default';
        timeEl.onclick = null;
      }
    }
  },

  // ===== 渲染分类标签 =====
  renderTabs(containerId, categories, currentCat, setter) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tabs = [{ key: 'all', label: '全部' }];
    for (const cat of categories) {
      tabs.push({ key: cat, label: cat });
    }

    container.innerHTML = tabs.map(tab => {
      const active = currentCat === tab.key ? 'active' : '';
      return `<button class="tab-btn ${active}" onclick="${setter}('${tab.key}')">${_esc(tab.label)}</button>`;
    }).join('');
  },

  // ===== 设置世界分类 =====
  setWorldCategory(cat) {
    this.worldCategory = cat;
    const cats = this.worldCache.categories.length ? this.worldCache.categories : this.WORLD_CATEGORIES;
    this.renderTabs('world-tabs', cats, this.worldCategory, 'News.setWorldCategory');
    this.renderWorldList();
  },

  // ===== 设置专升本分类 =====
  setEduCategory(cat) {
    this.eduCategory = cat;
    const cats = this.eduCache.categories.length ? this.eduCache.categories : this.EDU_CATEGORIES;
    this.renderTabs('edu-tabs', cats, this.eduCategory, 'News.setEduCategory');
    this.renderEduList();
  },

  // ===== 渲染世界资讯列表 =====
  async renderWorldList() {
    const container = document.getElementById('world-news-list');
    if (!container) return;

    if (!this.worldLoaded && this.worldCache.items.length === 0) return;

    const favs = await Store.getAll('favorites');
    const worldFavs = favs.filter(f => f.type === 'world');

    let items = this.worldCache.items;
    if (this.worldCategory !== 'all') {
      items = items.filter(it => it.category === this.worldCategory);
    }

    this._worldItems = items;

    if (items.length === 0) {
      container.innerHTML = '<div class="text-center text-xs text-ash py-8">该分类暂无资讯</div>';
      return;
    }

    container.innerHTML = items.map((item, idx) => {
      const isFav = worldFavs.some(f => String(f.refId) === String(item.id));
      return this.renderNewsCard(item, idx, 'world', isFav);
    }).join('');
  },

  // ===== 渲染专升本资讯列表 =====
  async renderEduList() {
    const container = document.getElementById('edu-content');
    if (!container) return;

    const favs = await Store.getAll('favorites');
    const eduFavs = favs.filter(f => f.type === 'edu');

    // 过滤内置资料
    let builtinItems = this.builtinEdu;
    if (this.eduCategory !== 'all') {
      builtinItems = builtinItems.filter(it => it.category === this.eduCategory);
    }
    const builtinWithFlag = builtinItems.map(it => ({ ...it, isBuiltin: true }));

    // 过滤 API 资讯
    let apiItems = this.eduCache.items;
    if (this.eduCategory !== 'all') {
      apiItems = apiItems.filter(it => it.category === this.eduCategory);
    }
    const apiWithFlag = apiItems.map(it => ({ ...it, isBuiltin: false }));

    // 合并为统一索引列表
    this._eduItems = [...builtinWithFlag, ...apiWithFlag];

    let html = '';

    // —— 内置学习资料区 ——
    if (builtinWithFlag.length > 0) {
      html += '<div class="text-xs font-semibold text-gray-500 mb-2 px-1">内置学习资料</div>';
      html += '<div class="space-y-3 mb-4">';
      builtinWithFlag.forEach((item, idx) => {
        const isFav = eduFavs.some(f => String(f.refId) === String(item.id));
        html += this.renderNewsCard(item, idx, 'edu', isFav);
      });
      html += '</div>';
    }

    // —— 最新资讯区 ——
    if (apiWithFlag.length > 0) {
      html += '<div class="text-xs font-semibold text-gray-500 mb-2 px-1">最新资讯</div>';
      html += '<div class="space-y-3">';
      apiWithFlag.forEach((item, i) => {
        const idx = builtinWithFlag.length + i;
        const isFav = eduFavs.some(f => String(f.refId) === String(item.id));
        html += this.renderNewsCard(item, idx, 'edu', isFav);
      });
      html += '</div>';
    }

    if (!html) {
      html = '<div class="text-center text-xs text-ash py-8">该分类暂无资讯</div>';
    }

    container.innerHTML = html;
  },

  // ===== 渲染单条资讯卡片 =====
  renderNewsCard(item, idx, type, isFav) {
    const star = isFav ? '★' : '☆';
    const starCls = isFav ? 'star-btn active' : 'star-btn';
    const time = this.getDisplayTime(item);
    const builtinTag = item.isBuiltin
      ? '<span class="inline-block text-[9px] bg-fog text-gray-500 px-1.5 py-0.5 rounded ml-1 align-middle">内置</span>'
      : '';
    const linkHtml = (!item.isBuiltin && item.link)
      ? `<a href="${_esc(item.link)}" target="_blank" rel="noopener noreferrer" class="hover:text-ink">查看原文</a>`
      : '';

    return `
      <div class="news-card">
        <div class="flex items-start justify-between gap-2">
          <div class="news-title flex-1">${_esc(item.title || '无标题')}${builtinTag}</div>
          <span class="${starCls}" onclick="News.toggleFavorite(${idx}, '${type}')" style="flex-shrink:0; line-height:1.4;">${star}</span>
        </div>
        <div class="news-desc">${_esc(item.description || '')}</div>
        <div class="news-meta">
          <span>${_esc(item.source || '未知来源')}</span>
          ${time ? `<span>·</span><span>${time}</span>` : ''}
        </div>
        <div class="flex gap-3 mt-2 text-[10px] text-ash">
          <button onclick="News.openNoteModal(${idx}, '${type}')" class="hover:text-ink">批注</button>
          <button onclick="News.copyContent(${idx}, '${type}')" class="hover:text-ink">复制原文</button>
          ${linkHtml}
        </div>
      </div>
    `;
  },

  // ===== 获取显示时间 =====
  getDisplayTime(item) {
    if (item.isBuiltin) return 'Jade内置';
    const date = item.pub_date || item.fetched_at;
    if (!date) return '';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return '';
      return DateUtil.fmtFull(d);
    } catch (e) {
      return '';
    }
  },

  // ===== 查找收藏 =====
  async findFavorite(item, type) {
    const favs = await Store.getAll('favorites');
    return favs.find(f => f.type === type && String(f.refId) === String(item.id));
  },

  // ===== 切换收藏 =====
  async toggleFavorite(idx, type) {
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;

    try {
      const fav = await this.findFavorite(item, type);
      if (fav) {
        await Store.del('favorites', fav.id);
        Toast.show('已取消收藏');
      } else {
        await Store.add('favorites', {
          type: type,
          refId: item.id,
          title: item.title,
          content: item.description || '',
          note: '',
          sourceData: JSON.stringify(item),
          createdAt: new Date().toISOString(),
        });
        Toast.show('已收藏');
      }
      if (type === 'world') this.renderWorldList();
      if (type === 'edu') this.renderEduList();
    } catch (e) {
      console.error('收藏操作失败', e);
      Toast.show('操作失败，请重试');
    }
  },

  // ===== 打开批注弹窗 =====
  openNoteModal(idx, type) {
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;

    const html = `
      <div class="space-y-3">
        <h3 class="text-base font-bold">添加批注</h3>
        <p class="text-xs text-ash" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${_esc(item.title || '')}</p>
        <textarea id="note-input" rows="4" placeholder="写点什么..." style="min-height:80px;"></textarea>
        <div class="flex gap-2">
          <button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>
          <button onclick="News.saveNote(${idx}, '${type}')" class="btn-primary flex-1">保存</button>
        </div>
      </div>
    `;
    Modal.open(html);

    this.findFavorite(item, type).then(fav => {
      if (fav && fav.note) {
        const input = document.getElementById('note-input');
        if (input) input.value = fav.note;
      }
    });
  },

  // ===== 保存批注 =====
  async saveNote(idx, type) {
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;

    const input = document.getElementById('note-input');
    const note = input ? input.value.trim() : '';

    try {
      const fav = await this.findFavorite(item, type);
      if (fav) {
        fav.note = note;
        await Store.put('favorites', fav);
      } else {
        await Store.add('favorites', {
          type: type,
          refId: item.id,
          title: item.title,
          content: item.description || '',
          note: note,
          sourceData: JSON.stringify(item),
          createdAt: new Date().toISOString(),
        });
      }
      Modal.closeForce();
      Toast.show('批注已保存');
      if (type === 'world') this.renderWorldList();
      if (type === 'edu') this.renderEduList();
    } catch (e) {
      console.error('保存批注失败', e);
      Toast.show('保存失败，请重试');
    }
  },

  // ===== 复制原文 =====
  async copyContent(idx, type) {
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;

    let text = item.title || '';
    if (item.description) text += '\n\n' + item.description;
    if (item.source) text += '\n\n来源：' + item.source;
    if (!item.isBuiltin && item.link) text += '\n链接：' + item.link;

    const ok = await _copyText(text);
    Toast.show(ok ? '已复制到剪贴板' : '复制失败');
  },
};
