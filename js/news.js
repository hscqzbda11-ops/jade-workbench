/* ===== Jade 工作台 资讯模块 ===== */

// 兼容旧版 Safari 的超时控制器（AbortSignal.timeout 在 Safari 15 及以下不支持）
function _timeoutSignal(ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

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
      const res = await fetch(proxyUrl, { signal: _timeoutSignal(12000) });
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
  EDU_CATEGORIES: ['英语', '高数', '药学', '报考', '信息差', '学习资料'],

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
    // —— 信息差 ——
    {
      id: 'edu_builtin_14', category: '信息差',
      title: '专升本信息差：五年制 vs 三年制 区别与优势',
      description: '五年制专科（3+2）和普通三年制专科在专升本报考时，大多数省份待遇相同，都可以报考全日制专升本。\n\n关键差异：\n1. 五年制学生英语基础普遍薄弱，要更早开始准备英语\n2. 五年制药学专业对口的本科院校选择面比临床医学广\n3. 部分省份对五年制有单独的招生计划，竞争反而更小\n4. 南阳医专等医学院校专升本通过率普遍高于综合类专科\n\n建议：提前一年确定目标院校，查近三年录取分数线和招生人数。',
      source: 'Jade内置·专升本信息差',
    },
    {
      id: 'edu_builtin_15', category: '信息差',
      title: '专升本信息差：药学专业对口本科院校清单',
      description: '药学专业专升本可报考的本科院校类型：\n\n【药科大学】\n- 中国药科大学（江苏，部分省份有招生计划）\n- 沈阳药科大学（辽宁）\n- 广东药科大学（广东）\n\n【医科大学/中医药大学】\n- 各省医科大学药学院\n- 中医药大学药学、中药学专业\n\n【综合大学药学院】\n- 各省综合性大学药学院\n\n【河南考生重点关注】\n- 河南大学药学院\n- 郑州大学药学院\n- 河南中医药大学\n- 新乡医学院\n- 河南科技大学\n\n注意：每年招生计划有变化，以当年省教育考试院公布为准。',
      source: 'Jade内置·专升本信息差',
    },
    {
      id: 'edu_builtin_16', category: '信息差',
      title: '专升本信息差：90%的人不知道的备考捷径',
      description: '1. 真题是最好的资料，近5年真题至少刷3遍，很多考点重复出现\n\n2. 英语作文可以提前背模板，书信类、议论文类各准备2-3个万能模板\n\n3. 高数选择题占比高，不会的题可以用特殊值法、排除法提高正确率\n\n4. 专业课可以找目标院校的期末试卷和课件，出题老师往往就是那几个\n\n5. 不要盲目报辅导班，先自学一个月找到薄弱点再有针对性报班\n\n6. 关注目标院校的专升本QQ群、贴吧，学长学姐的经验帖价值很高\n\n7. 报名时间、政策变化这些信息差，比多刷一套题更重要',
      source: 'Jade内置·专升本信息差',
    },
    {
      id: 'edu_builtin_17', category: '信息差',
      title: '专升本信息差：河南专升本最新政策解读',
      description: '【报名条件】\n- 河南省普通高校应届专科毕业生（含五年制）\n- 思想政治素质好，身体健康\n- 学习期间未受记过及以上纪律处分\n\n【考试科目】\n- 公共英语：150分\n- 专业综合：150分（药学类考生考生理病理或药学综合）\n- 总分300分\n\n【录取规则】\n- 按专业大类平行志愿投档\n- 从高分到低分择优录取\n- 没有单科分数线限制\n\n【重要时间节点】\n- 报名：每年11-12月（专科大三上学期）\n- 考试：每年4月中下旬\n- 成绩公布：5月上旬\n- 志愿填报：5月中旬\n- 录取：5月底-6月初\n\n建议关注"河南省教育考试院"官网获取最新信息。',
      source: 'Jade内置·专升本信息差',
    },
    {
      id: 'edu_builtin_18', category: '信息差',
      title: '南阳医专专升本：学长学姐经验汇总',
      description: '【关于南阳医专】\n南阳医学高等专科学校是河南省内医学类专科中实力较强的，药学专业专升本升学率一直不错。\n\n【备考建议】\n1. 英语是拉分大户，南阳医专五年制学生英语普遍是弱项，建议从大二开始每天背单词\n2. 药学综合（或生理病理）平时上课认真听，期末复习资料留好，专升本很多考点和期末考重叠\n3. 高数如果基础差，建议报个线上班跟着学，自学容易走弯路\n\n【院校选择】\n- 稳妥选择：新乡医学院三全学院、黄河科技学院等民办\n- 冲刺选择：河南中医药大学、新乡医学院\n- 保底选择：各地市学院的药学专业\n\n【学习氛围】\n学校图书馆备考氛围很好，建议组队学习，互相监督。找1-2个同专业的同学一起备考，信息共享效率更高。',
      source: 'Jade内置·南阳医专专升本',
    },
    {
      id: 'edu_builtin_19', category: '信息差',
      title: '专升本信息差：低分也能上岸的冷门技巧',
      description: '1. 避开热门院校的热门专业，选择同档次院校的相对冷门专业，录取分数线可能低20-30分\n\n2. 有些院校第一年招某专业专升本，因为知道的人少，分数线会偏低，可以重点关注新增招生专业\n\n3. 民办院校学费贵但录取分数低，如果家庭条件允许，报民办作为保底是明智的选择\n\n4. 调剂是最后的机会，不要放弃。有些学校第一轮招不满会有补录，关注省考试院补录通知\n\n5. 专业课如果有主观题（简答、论述），一定要写满，阅卷老师会酌情给分\n\n6. 选择题不会就蒙B或C，统计上概率略高\n\n7. 考前一周不要再刷新题，把错题本和笔记再过一遍，保持手感最重要',
      source: 'Jade内置·专升本信息差',
    },
    // —— 更多药学资料 ——
    {
      id: 'edu_builtin_20', category: '药学',
      title: '【药学专升本】药物化学核心考点汇总',
      description: '【抗生素类药物】\n- β-内酰胺类：青霉素类（青霉素G、阿莫西林）、头孢菌素类（一至四代）\n- 大环内酯类：红霉素、阿奇霉素、克拉霉素\n- 氨基糖苷类：链霉素、庆大霉素、阿米卡星\n- 四环素类：四环素、多西环素\n- 喹诺酮类：诺氟沙星、环丙沙星、左氧氟沙星\n\n【解热镇痛药】\n- 水杨酸类：阿司匹林（乙酰水杨酸）\n- 苯胺类：对乙酰氨基酚（扑热息痛）\n- 吡唑酮类：安乃近\n\n【心血管药物】\n- 抗高血压：卡托普利(ACEI)、缬沙坦(ARB)、硝苯地平(CCB)\n- 抗心绞痛：硝酸甘油、普萘洛尔、维拉帕米\n- 调血脂：洛伐他汀、辛伐他汀（他汀类）\n\n【消化系统药物】\n- 抗溃疡：奥美拉唑（质子泵抑制剂）、雷尼替丁（H2受体阻断药）\n- 胃黏膜保护：硫糖铝、枸橼酸铋钾\n\n重点掌握：药物分类、代表药、作用机制、临床应用、主要不良反应',
      source: 'Jade内置·药学专升本',
    },
    {
      id: 'edu_builtin_21', category: '药学',
      title: '【药学专升本】药剂学常考简答题精选',
      description: '1. 简述片剂的制备方法及其特点\n答：① 湿法制粒压片法：适用于对湿热稳定的药物，颗粒质量好；② 干法制粒压片法：适用于对湿热不稳定的药物；③ 直接粉末压片法：省时省力，但要求药物流动性和可压性好；④ 空白颗粒压片法：适用于剂量小的药物。\n\n2. 影响药物溶解度的因素有哪些？\n答：① 药物的分子结构（相似相溶）；② 溶剂化作用与水合作用；③ 多晶型影响（无定形溶解度最大）；④ 粒子大小（微粉化可增加溶解度）；⑤ 温度影响；⑥ pH与同离子效应；⑦ 混合溶剂（潜溶）；⑧ 添加物（助溶剂、增溶剂）。\n\n3. 简述热原的性质及除去方法\n答：热原性质：耐热性、过滤性、水溶性、不挥发性、可被吸附性、可被强酸碱破坏。\n除去方法：高温法（250℃30min以上）、酸碱法、吸附法（活性炭）、离子交换法、凝胶过滤法、反渗透法、超滤法。\n\n4. 缓释制剂与控释制剂的区别\n答：缓释制剂：按一级速率释放，血药浓度有波动；控释制剂：按零级速率释放，血药浓度平稳。',
      source: 'Jade内置·药学专升本',
    },
    {
      id: 'edu_builtin_22', category: '药学',
      title: '【药学专升本】药理学名词解释高频考点',
      description: '1. 首过效应（首关消除）：口服药物在胃肠道吸收后，经门静脉进入肝脏，部分药物在通过肠黏膜和肝脏时被代谢灭活，使进入体循环的药量减少。\n\n2. 生物利用度（F）：药物经血管外给药后，能被吸收进入体循环的相对分量和速度。\n\n3. 半衰期（t₁/₂）：血药浓度下降一半所需的时间，是确定给药间隔的重要依据。\n\n4. 治疗指数（TI）：半数致死量（LD₅₀）与半数有效量（ED₅₀）的比值，用以表示药物的安全性。TI越大越安全。\n\n5. 副作用：药物在治疗剂量时出现的与治疗目的无关的作用，是药物本身固有的，可预知，不可避免。\n\n6. 毒性反应：用药剂量过大或用药时间过长引起的机体损害性反应，可预知，应避免。\n\n7. 耐受性：机体在连续多次用药后反应性降低，需增加剂量才能达到原有效应。\n\n8. 耐药性（抗药性）：病原体或肿瘤细胞对反复应用的化疗药物敏感性降低。\n\n9. 抗生素后效应（PAE）：细菌与抗生素短暂接触后，当药物浓度下降至低于最低抑菌浓度或消失后，细菌生长仍受到持续抑制的效应。\n\n10. 化疗指数（CI）：评价化疗药物有效性与安全性的指标，一般用LD₅₀/ED₅₀表示。',
      source: 'Jade内置·药学专升本',
    },
    {
      id: 'edu_builtin_23', category: '药学',
      title: '【药学专升本】天然药物化学重点结构类型',
      description: '【糖和苷】\n- 单糖：葡萄糖、果糖、鼠李糖\n- 苷键的裂解：酸催化水解、碱催化水解、酶催化水解\n- 苷键构型确定：酶解法、NMR法\n\n【醌类化合物】\n- 苯醌、萘醌、菲醌、蒽醌\n- 蒽醌类：大黄素型、茜草素型\n- 显色反应：Feigl反应、Bornträger反应\n\n【黄酮类化合物】\n- 黄酮、黄酮醇、二氢黄酮、异黄酮、查耳酮\n- 酸性强弱：7,4\'-二OH > 7或4\'-OH > 一般酚OH > 5-OH\n- 显色反应：盐酸-镁粉反应、三氯化铝反应\n\n【萜类和挥发油】\n- 单萜（C10）、倍半萜（C15）、二萜（C20）、三萜（C30）\n- 挥发油组成：萜类化合物、芳香族化合物、脂肪族化合物\n\n【生物碱】\n- 结构类型：吡啶类、莨菪烷类、异喹啉类、吲哚类、有机胺类\n- 碱性强弱：季铵碱 > 脂肪胺 > 芳香胺 > 酰胺\n- 沉淀反应：碘化铋钾（橘红色沉淀）、碘化汞钾（类白色沉淀）',
      source: 'Jade内置·药学专升本',
    },
    {
      id: 'edu_builtin_24', category: '药学',
      title: '【药学专升本】药事管理学必背考点',
      description: '【药品管理法核心】\n- 假药：药品所含成份与国家药品标准规定的成份不符；以非药品冒充药品；以他种药品冒充此种药品；变质的药品；药品所标明的适应症或者功能主治超出规定范围。\n- 劣药：药品成份的含量不符合国家药品标准；被污染的药品；未标明或者更改有效期的药品；未注明或者更改产品批号的药品；超过有效期的药品；擅自添加防腐剂、辅料的药品。\n\n【处方药与非处方药分类管理】\n- 处方药（Rx）：凭执业医师或执业助理医师处方才可调配、购买和使用\n- 非处方药（OTC）：不需要凭医师处方即可自行判断、购买和使用\n- OTC分为甲类（红色，须在药店购买）和乙类（绿色，可在超市等购买）\n\n【特殊管理药品】\n- 麻醉药品：连续使用易产生身体依赖性，能成瘾癖（吗啡、哌替啶、芬太尼等）\n- 精神药品：直接作用于中枢神经系统，使之兴奋或抑制（第一类、第二类）\n- 医疗用毒性药品：毒性剧烈，治疗剂量与中毒剂量相近\n- 放射性药品：用于临床诊断或治疗的放射性核素制剂\n\n【药品不良反应（ADR）】\n- 定义：合格药品在正常用法用量下出现的与用药目的无关的有害反应\n- 分类：A型（量变型，可预测）、B型（质变型，难预测）、C型（长期用药后出现）',
      source: 'Jade内置·药学专升本',
    },
    {
      id: 'edu_builtin_25', category: '信息差',
      title: '专升本信息差：备考时间线规划（五年制专属）',
      description: '五年制专升本备考时间线（以河南为例）：\n\n【大二上学期 · 准备期】\n- 了解专升本政策、考试科目、目标院校\n- 开始背英语单词，每天30-50个\n- 专业课上课认真听，打好基础\n\n【大二下学期 · 基础期】\n- 英语：系统学习语法，开始做阅读\n- 高数：如果基础弱，从最基础的概念开始学\n- 专业课：跟着学校课程走，期末复习资料留好\n\n【大三上学期 · 强化期】\n- 英语：开始刷真题，重点攻克阅读和完形\n- 高数：过完一遍基础，开始分模块刷题\n- 专业课：对照考试大纲系统复习\n- 寒假是黄金备考期，一定要利用好\n\n【大三下学期 · 冲刺期】\n- 3-4月：刷真题+模拟卷，查漏补缺\n- 考前1个月：回归基础，错题本再过一遍\n- 保持心态，调整作息\n\n【关键提醒】\n五年制比三年制多两年在校时间，备考更充分是最大优势。不要等到最后一年才开始，早准备早从容。',
      source: 'Jade内置·专升本信息差',
    },
    {
      id: 'edu_builtin_26', category: '信息差',
      title: '2029年专升本：你现在该做什么（五年制大二专属）',
      description: '【你现在的位置】\n2026年8月，五年制大二，距离2029年专升本考试还有约2年8个月。时间充裕，但也不能浪费。\n\n【2026年下半年（大二上）目标】\n1. 英语：搞定基础词汇，目标词汇量2500+。每天背40个单词，用APP（百词斩、墨墨）都可以\n2. 高数：把课本上的基础概念过一遍，不用刷题，理解为主\n3. 专业课：跟着学校课程走，期末认真复习，把笔记和复习资料保存好\n4. 信息收集：关注河南省教育考试院公众号，了解最新政策\n\n【2027年（大三）目标】\n- 上学期：英语系统学语法，高数过完一遍基础\n- 下学期：开始刷英语真题阅读，高数分模块刷题\n- 暑假：黄金备考期，报班或自学强化\n\n【2028年（大四）目标】\n- 全面进入冲刺阶段，刷真题、模拟卷\n- 专业课重点突破\n\n【2029年（大五）目标】\n- 3-4月最后冲刺\n- 4月考试\n\n记住：专升本是选拔性考试，不是过线就行，分越高选择越多。',
      source: 'Jade内置·2029专升本备考',
    },
    {
      id: 'edu_builtin_27', category: '学习资料',
      title: '【2029专升本】英语全年备考计划（五年制版）',
      description: '【当前阶段（大二）：打基础】\n- 词汇：每天40个，用艾宾浩斯遗忘曲线复习。一年后词汇量争取达到3500+\n- 语法：系统学习五大基本句型、时态、语态、从句。推荐看B站免费语法课\n- 阅读：从简单的短文开始，每周2-3篇。不求速度，力求每个句子都看懂\n\n【中期阶段（大三）：强化训练】\n- 词汇：复习+拓展，目标4000+\n- 阅读：开始做真题阅读，每天1-2篇，做完精读分析\n- 完形填空：掌握常见搭配和上下文逻辑\n- 翻译：每周练2-3篇英译汉\n- 作文：开始积累模板和好词好句\n\n【冲刺阶段（大四）：真题实战】\n- 近10年真题至少刷3遍\n- 作文模板熟练背诵，每周写1-2篇练手\n- 保持每天做题的手感\n\n【英语提分关键】\n1. 单词是基础，每天都要背，直到考前\n2. 阅读占分最多，得阅读者得天下\n3. 作文是最容易短期提分的，模板一定要背熟\n4. 完形填空性价比低，不用花太多时间',
      source: 'Jade内置·专升本英语',
    },
    {
      id: 'edu_builtin_28', category: '学习资料',
      title: '【2029专升本】高数全年备考计划（五年制版）',
      description: '【高数考试范围（河南专升本）】\n- 函数、极限与连续\n- 一元函数微分学\n- 一元函数积分学\n- 常微分方程\n- 向量代数与空间解析几何\n- 多元函数微分学\n- 多元函数积分学\n- 无穷级数\n\n【当前阶段（大二）：预习打基础】\n- 如果学校有高数课，上课认真听\n- 没有的话找网课自学，推荐B站"宋浩"老师的高等数学\n- 重点：极限、导数、积分是重中之重，占分最多\n- 不用追求刷题量，理解概念和基本方法为主\n\n【中期阶段（大三）：系统学习】\n- 按考试大纲一章一章过\n- 每章学完做配套练习题\n- 准备错题本，错题反复做\n- 寒假进行第一轮总复习\n\n【冲刺阶段（大四）：真题+模拟】\n- 近10年真题刷3遍以上\n- 模拟考试，控制时间\n- 查漏补缺，薄弱章节重点突破\n\n【高数提分关键】\n1. 基础不牢，地动山摇。公式一定要记熟\n2. 多做题，数学是练出来的不是看出来的\n3. 错题本比刷新题更重要\n4. 考试时选择题不会就蒙，大题写步骤也有步骤分',
      source: 'Jade内置·专升本高数',
    },
    {
      id: 'edu_builtin_29', category: '药学',
      title: '【药学专升本】生理病理学备考指南',
      description: '【生理学重点章节】\n1. 绪论：内环境与稳态、生理功能调节\n2. 细胞的基本功能：物质跨膜转运、生物电现象、肌细胞收缩\n3. 血液：血液组成与功能、血细胞生理、血液凝固与抗凝\n4. 血液循环：心脏泵血、心肌生物电、血管生理、心血管活动调节\n5. 呼吸：肺通气、肺换气、气体运输、呼吸运动调节\n6. 消化与吸收：胃肠运动、消化液分泌、吸收\n7. 能量代谢与体温\n8. 尿的生成与排出：肾小球滤过、肾小管重吸收、尿生成调节\n9. 神经系统：突触传递、神经系统感觉功能、神经系统对躯体运动调节\n10. 内分泌：下丘脑与垂体、甲状腺、肾上腺、胰岛\n\n【病理学重点章节】\n1. 细胞和组织的适应与损伤：萎缩、肥大、增生、化生；变性、坏死、凋亡\n2. 损伤的修复：再生、纤维性修复、创伤愈合\n3. 局部血液循环障碍：充血、出血、血栓形成、栓塞、梗死\n4. 炎症：炎症概述、急性炎症、慢性炎症\n5. 肿瘤：肿瘤的概念、形态、异型性、生长扩散、命名分类、良恶性区别\n6. 心血管系统疾病：动脉粥样硬化、高血压、风湿病、感染性心内膜炎\n7. 呼吸系统疾病：肺炎、慢性阻塞性肺疾病、肺癌\n8. 消化系统疾病：胃炎、消化性溃疡、病毒性肝炎、肝硬化、消化系统肿瘤\n9. 泌尿系统疾病：肾小球肾炎、肾盂肾炎、泌尿系统肿瘤\n10. 生殖系统和乳腺疾病\n11. 内分泌系统疾病：糖尿病、甲状腺疾病\n12. 神经系统疾病\n\n【备考建议】\n- 生理学重在理解机制，病理学重在形态和病变特点\n- 两者关联紧密，建议结合着学\n- 多画图、多对比、多总结',
      source: 'Jade内置·药学专升本',
    },
    {
      id: 'edu_builtin_30', category: '信息差',
      title: '南阳医专药学专升本：上岸学长的真心话',
      description: '【关于南阳医专】\n南阳医专的药学专业在河南省内专科里算不错的，师资和实验条件都可以。学校对专升本也比较支持，图书馆常年有很多备考的同学。\n\n【药学专升本考什么（河南）】\n- 公共英语（150分）\n- 生理病理学（150分）或 药学综合（以当年政策为准）\n- 总分300分\n\n【真实的录取情况】\n- 公办院校（河南中医药大学、新乡医学院等）：分数要求较高，一般需要200+才有把握\n- 民办院校（新乡医学院三全学院、黄河科技学院等）：分数相对低一些，150-180左右有希望\n- 每年分数线波动，受招生计划和报考人数影响\n\n【给学弟学妹的建议】\n1. 英语真的很重要，五年制的同学普遍英语基础弱，这恰恰是你逆袭的机会\n2. 专业课（生理病理/药学综合）你比非医学专业的学生有优势，因为学校里都学过\n3. 不要轻信包过班、保录班，都是智商税\n4. 找1-2个靠谱的研友，互相监督比一个人强\n5. 大二开始准备完全来得及，但不要拖延\n6. 真题是最好的复习资料，没有之一\n7. 坚持到最后就赢了一半，每年都有很多人中途放弃',
      source: 'Jade内置·南阳医专学长经验',
    },
  ],

  // ===== 预加载 =====
  async preload() {
    await Promise.all([
      this.loadWorld().catch(e => console.error('世界资讯预加载失败', e)),
      this.loadEdu().catch(e => console.error('专升本资讯预加载失败', e)),
    ]);
  },

  // ===== 绑定事件委托（解决 Safari 点击失效问题） =====
  bindEvents() {
    // 世界资讯列表
    const worldList = document.getElementById('world-news-list');
    if (worldList) {
      worldList.addEventListener('click', (e) => this._handleCardClick(e, 'world'));
    }
    // 专升本资讯列表
    const eduList = document.getElementById('edu-content');
    if (eduList) {
      eduList.addEventListener('click', (e) => this._handleCardClick(e, 'edu'));
    }
  },

  _handleCardClick(e, defaultType) {
    const target = e.target;

    // 查找最近的操作按钮
    const actionEl = target.closest('.news-action');
    if (actionEl) {
      const action = actionEl.dataset.action;
      const idx = parseInt(actionEl.dataset.idx);
      const type = actionEl.dataset.type || defaultType;
      if (isNaN(idx)) return;

      switch (action) {
        case 'fav':
          this.toggleFavorite(idx, type);
          break;
        case 'note':
          this.openNoteModal(idx, type);
          break;
        case 'copy':
          this.copyContent(idx, type);
          break;
        case 'translate':
          this.translateItem(idx, type);
          break;
      }
      return;
    }

    // 如果点击了链接，直接放行
    if (target.closest('.news-link') || target.tagName === 'A') {
      return;
    }

    // 查找最近的卡片，打开详情
    const card = target.closest('.news-card-item');
    if (card) {
      const idx = parseInt(card.dataset.idx);
      const type = card.dataset.type || defaultType;
      if (!isNaN(idx)) {
        this.openDetail(idx, type);
      }
    }
  },

  // ===== 加载世界资讯 =====
  async loadWorld() {
    const loading = document.getElementById('world-loading');
    if (loading) loading.style.display = '';
    try {
      // 先尝试后端 API
      let items = [];
      try {
        const res = await fetch('/api/world/news?limit=100', { signal: _timeoutSignal(5000) });
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

    if (this.worldLoaded) {
      // 加载成功
      if (Nav.current === 'world') Toast.show('刷新成功');
    } else {
      // 加载失败
      const el = document.getElementById('world-news-list');
      if (el) {
        if (this.worldCache.items.length > 0) {
          Toast.show('刷新失败，显示缓存数据');
        } else {
          el.innerHTML = '<div class="text-center text-xs text-ash py-8">'
            + '资讯加载失败，请检查网络后重试<br>'
            + '<button onclick="News.loadWorld()" class="mt-3 px-3 py-1 bg-ink text-white rounded-lg text-xs">重新加载</button>'
            + '</div>';
        }
      }
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
        const res = await fetch('/api/education/news?limit=100', { signal: _timeoutSignal(5000) });
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
      // 计算 2029 年专升本倒计时（假设2029年4月15日考试，以河南为例）
      const examDate = new Date(2029, 3, 15); // 4月15日
      const now = new Date();
      const daysLeft = Math.ceil((examDate - now) / (1000 * 60 * 60 * 24));
      let countdownText = '';
      if (daysLeft > 0) {
        countdownText = '距2029专升本约' + daysLeft + '天 · ';
      }
      
      if (this.eduCache.time) {
        timeEl.textContent = countdownText + '更新于 ' + DateUtil.fmtFull(this.eduCache.time) + ' · 点击刷新';
        timeEl.style.cursor = 'pointer';
        timeEl.onclick = () => { Toast.show('正在刷新...'); this.loadEdu(); };
      } else if (!this.eduLoaded) {
        timeEl.textContent = countdownText + '正在加载...';
        timeEl.style.cursor = 'default';
        timeEl.onclick = null;
      } else {
        timeEl.textContent = countdownText + '暂无数据';
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
      ? `<a href="${_esc(item.link)}" target="_blank" rel="noopener noreferrer" class="hover:text-ink news-link">查看原文</a>`
      : '';

    // 翻译按钮（仅我与世界显示）
    const translateBtn = type === 'world'
      ? `<button class="news-action" data-action="translate" data-idx="${idx}" data-type="${type}" id="trans-btn-${type}-${idx}">译中文</button>`
      : '';

    // 翻译结果区域
    const transArea = type === 'world'
      ? `<div class="trans-result hidden" id="trans-result-${type}-${idx}"></div>`
      : '';

    return `
      <div class="news-card news-card-item" data-idx="${idx}" data-type="${type}">
        <div class="flex items-start justify-between gap-2">
          <div class="news-title flex-1">${_esc(item.title || '无标题')}${builtinTag}</div>
          <span class="${starCls} news-action" data-action="fav" data-idx="${idx}" data-type="${type}" style="flex-shrink:0; line-height:1.4;">${star}</span>
        </div>
        <div class="news-desc">${_esc(item.description || '')}</div>
        ${transArea}
        <div class="news-meta">
          <span>${_esc(item.source || '未知来源')}</span>
          ${time ? `<span>·</span><span>${time}</span>` : ''}
        </div>
        <div class="flex gap-3 mt-2 text-[10px] text-ash">
          <button class="news-action" data-action="fav" data-idx="${idx}" data-type="${type}">⭐ 保存</button>
          <button class="news-action" data-action="note" data-idx="${idx}" data-type="${type}">批注</button>
          <button class="news-action" data-action="copy" data-idx="${idx}" data-type="${type}">复制原文</button>
          ${translateBtn}
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

  // ===== 打开详情弹窗 =====
  openDetail(idx, type) {
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;

    const time = this.getDisplayTime(item);
    const builtinTag = item.isBuiltin
      ? '<span class="inline-block text-[10px] bg-fog text-gray-500 px-2 py-0.5 rounded">内置资料</span>'
      : '';
    const categoryTag = item.category
      ? '<span class="inline-block text-[10px] bg-mist text-gray-600 px-2 py-0.5 rounded ml-2">' + _esc(item.category) + '</span>'
      : '';
    const linkHtml = (!item.isBuiltin && item.link)
      ? '<a href="' + _esc(item.link) + '" target="_blank" rel="noopener noreferrer" class="text-xs underline">查看原文链接 →</a>'
      : '';

    // 描述内容换行处理（保留换行符）
    const descHtml = (item.description || '')
      .split('\n')
      .map(line => '<p class="mb-2">' + _esc(line) + '</p>')
      .join('');

    const html = `
      <div class="space-y-3">
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-base font-bold flex-1 leading-snug">${_esc(item.title || '无标题')}</h3>
          <button onclick="News.toggleFavorite(${idx}, '${type}');News._refreshDetailStar(${idx}, '${type}')" class="star-btn text-lg shrink-0" id="detail-star-${type}-${idx}">☆</button>
        </div>
        <div class="text-[10px] text-ash">
          ${builtinTag}${categoryTag}
          <span class="ml-2">${_esc(item.source || '未知来源')}</span>
          ${time ? '<span class="ml-2">· ' + time + '</span>' : ''}
        </div>
        <div class="border-t border-fog pt-3 text-sm leading-relaxed text-gray-700 max-h-[50vh] overflow-y-auto">
          ${descHtml || '<p class="text-ash">暂无详细内容</p>'}
        </div>
        <button onclick="News.toggleFavorite(${idx}, '${type}');News._refreshDetailSaveBtn(${idx}, '${type}')" class="btn-primary w-full py-2.5 text-sm" id="detail-save-btn-${type}-${idx}">
          ⭐ 一键保存到收藏
        </button>
        <div class="flex gap-2 pt-1 border-t border-fog">
          <button onclick="News.openNoteModal(${idx}, '${type}')" class="btn-secondary flex-1 text-xs py-2">批注</button>
          <button onclick="News.copyContent(${idx}, '${type}')" class="btn-secondary flex-1 text-xs py-2">复制</button>
          ${type === 'world' ? '<button onclick="News._detailTranslate(' + idx + ', \'' + type + '\')" class="btn-secondary flex-1 text-xs py-2" id="detail-trans-btn-' + type + '-' + idx + '">译中文</button>' : ''}
        </div>
        ${linkHtml ? '<div class="text-center pt-1">' + linkHtml + '</div>' : ''}
      </div>
    `;
    Modal.open(html);

    // 更新收藏状态
    this._refreshDetailStar(idx, type);
    this._refreshDetailSaveBtn(idx, type);
  },

  _refreshDetailSaveBtn(idx, type) {
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;
    this.findFavorite(item, type).then(fav => {
      const btn = document.getElementById('detail-save-btn-' + type + '-' + idx);
      if (btn) {
        if (fav) {
          btn.textContent = '✓ 已保存（点击取消）';
          btn.style.background = '#888';
        } else {
          btn.textContent = '⭐ 一键保存到收藏';
          btn.style.background = '';
        }
      }
    });
  },

  _refreshDetailStar(idx, type) {
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;
    this.findFavorite(item, type).then(fav => {
      const starEl = document.getElementById('detail-star-' + type + '-' + idx);
      if (starEl) {
        if (fav) {
          starEl.textContent = '★';
          starEl.classList.add('active');
        } else {
          starEl.textContent = '☆';
          starEl.classList.remove('active');
        }
      }
    });
  },

  async _detailTranslate(idx, type) {
    const btn = document.getElementById('detail-trans-btn-' + type + '-' + idx);
    if (!btn) return;
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;

    btn.textContent = '翻译中...';
    btn.disabled = true;

    try {
      const textToTranslate = (item.title || '') + '\n' + (item.description || '');
      const translated = await this._translateText(textToTranslate, 'en', 'zh-CN');
      if (translated) {
        // 在详情中显示翻译结果
        const lines = translated.split('\n');
        const transTitle = lines[0] || '';
        const transDesc = lines.slice(1).join('\n') || '';
        const descHtml = transDesc
          .split('\n')
          .map(line => '<p class="mb-2">' + _esc(line) + '</p>')
          .join('');

        const modalContent = document.getElementById('modal-content');
        if (modalContent) {
          const existingTrans = modalContent.querySelector('.detail-trans-area');
          if (existingTrans) {
            existingTrans.innerHTML = `
              <div class="text-[11px] text-ash mb-1">中文翻译</div>
              <div class="text-sm font-medium text-ink mb-1">${_esc(transTitle)}</div>
              <div class="text-xs text-gray-600 leading-relaxed">${descHtml}</div>
            `;
            existingTrans.classList.remove('hidden');
          } else {
            const contentArea = modalContent.querySelector('.border-t');
            if (contentArea) {
              const transDiv = document.createElement('div');
              transDiv.className = 'detail-trans-area mt-3 pt-3 border-t border-fog';
              transDiv.innerHTML = `
                <div class="text-[11px] text-ash mb-1">中文翻译</div>
                <div class="text-sm font-medium text-ink mb-1">${_esc(transTitle)}</div>
                <div class="text-xs text-gray-600 leading-relaxed">${descHtml}</div>
              `;
              contentArea.parentNode.insertBefore(transDiv, contentArea.nextSibling);
            }
          }
        }
        btn.textContent = '已翻译';
      } else {
        Toast.show('翻译失败，请稍后重试');
        btn.textContent = '译中文';
      }
    } catch (e) {
      console.warn('Detail translate error:', e);
      Toast.show('翻译失败：' + e.message);
      btn.textContent = '译中文';
    }
    btn.disabled = false;
  },

  // ===== 翻译为中文 =====
  _transCache: {}, // 翻译缓存

  async translateItem(idx, type) {
    const items = type === 'world' ? this._worldItems : this._eduItems;
    const item = items[idx];
    if (!item) return;

    const btn = document.getElementById('trans-btn-' + type + '-' + idx);
    const resultEl = document.getElementById('trans-result-' + type + '-' + idx);
    if (!btn || !resultEl) return;

    // 切换显示/隐藏
    if (!resultEl.classList.contains('hidden') && resultEl.innerHTML) {
      resultEl.classList.add('hidden');
      btn.textContent = '译中文';
      return;
    }

    // 检查缓存
    const cacheKey = type + '_' + idx;
    if (this._transCache[cacheKey]) {
      resultEl.innerHTML = this._transCache[cacheKey];
      resultEl.classList.remove('hidden');
      btn.textContent = '收起翻译';
      return;
    }

    btn.textContent = '翻译中...';
    btn.disabled = true;

    try {
      // 合并标题和描述进行翻译
      const textToTranslate = (item.title || '') + '\n' + (item.description || '');
      const translated = await this._translateText(textToTranslate, 'en', 'zh-CN');
      
      if (translated) {
        const lines = translated.split('\n');
        const transTitle = lines[0] || '';
        const transDesc = lines.slice(1).join('\n') || '';
        
        const html = `
          <div class="mt-2 pt-2 border-t border-fog">
            <div class="text-[11px] text-ash mb-1">中文翻译</div>
            <div class="text-sm font-medium text-ink mb-1">${_esc(transTitle)}</div>
            <div class="text-xs text-gray-600 leading-relaxed">${_esc(transDesc)}</div>
          </div>
        `;
        this._transCache[cacheKey] = html;
        resultEl.innerHTML = html;
        resultEl.classList.remove('hidden');
        btn.textContent = '收起翻译';
      } else {
        Toast.show('翻译失败，请稍后重试');
        btn.textContent = '译中文';
      }
    } catch (e) {
      console.warn('Translate error:', e);
      Toast.show('翻译失败：' + e.message);
      btn.textContent = '译中文';
    }
    
    btn.disabled = false;
  },

  // 使用 MyMemory 免费翻译 API
  async _translateText(text, from, to) {
    if (!text || !text.trim()) return '';
    
    const url = 'https://api.mymemory.translated.net/get?q=' + 
      encodeURIComponent(text.substring(0, 500)) + 
      '&langpair=' + from + '|' + to;
    
    try {
      const res = await fetch(url, { signal: _timeoutSignal(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && data.responseData && data.responseData.translatedText) {
        return data.responseData.translatedText;
      }
      throw new Error('无翻译结果');
    } catch (e) {
      // 备用：尝试另一个免费 API
      try {
        return await this._translateBackup(text, from, to);
      } catch (e2) {
        throw e;
      }
    }
  },

  // 备用翻译 API
  async _translateBackup(text, from, to) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + 
      from + '&tl=' + to + '&dt=t&q=' + encodeURIComponent(text.substring(0, 500));
    
    const res = await fetch(url, { signal: _timeoutSignal(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data && data[0] && Array.isArray(data[0])) {
      return data[0].map(item => item[0]).join('');
    }
    throw new Error('无翻译结果');
  },
};
