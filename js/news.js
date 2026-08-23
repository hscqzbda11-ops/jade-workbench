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
  worldCategory: '全部',
  eduCategory: '全部',

  // ===== 加载状态 =====
  worldLoaded: false,
  eduLoaded: false,

  // ===== 当前渲染的列表（供 onclick 索引查找） =====
  _worldItems: [],
  _eduItems: [],

  // ===== 默认分类 =====
  WORLD_CATEGORIES: ['全部', '金融财政', '股票基金', '战争国情', 'AI科技', '民生经营', '信息差'],
  EDU_CATEGORIES: ['英语', '高数', '药学', '报考', '信息差', '学习资料'],

  // ===== 我与世界 内置精选内容（带中文翻译） =====
  builtinWorld: [
    // —— 金融财政 ——
    {
      id: 'w_fin_0', category: '金融财政',
      title: '美联储降息预期升温，全球市场迎来关键窗口期',
      description: 'Federal Reserve signals potential rate cuts in September as inflation continues to moderate. The annual inflation rate fell to 2.9% in July, marking the lowest level in nearly three years. Markets are pricing in a 25 basis point cut at the next FOMC meeting, with potential for additional cuts before year-end. This shift could ease borrowing costs for consumers and businesses, supporting economic growth. However, officials remain cautious, emphasizing that future decisions will depend on incoming data. Investors are closely watching employment figures and core inflation metrics for further guidance on the pace of monetary policy normalization.',
      translation: '随着通胀持续放缓，美联储暗示9月可能降息。7月年化通胀率降至2.9%，为近三年最低水平。市场预期下次FOMC会议将降息25个基点，年底前可能还有更多降息。这一转变可能降低消费者和企业的借贷成本，支撑经济增长。然而，官员们仍保持谨慎，强调未来决策将取决于经济数据。投资者正密切关注就业数据和核心通胀指标，以进一步判断货币政策正常化的节奏。',
      source: '财经精选 · 2026.08'
    },
    {
      id: 'w_fin_1', category: '金融财政',
      title: '中国财政政策加力提效，地方专项债发行提速',
      description: 'China accelerates local government special bond issuance to boost infrastructure investment and stabilize economic growth. Ministry of Finance data shows that 3.5 trillion yuan in special bonds had been issued by mid-August, accounting for over 70% of the annual quota. Funds are primarily directed toward transportation, energy, and new infrastructure projects. The accelerated pace reflects policymakers\' determination to support domestic demand amid global headwinds. Analysts expect additional fiscal measures in the second half, including potential tax cuts and increased transfer payments to local governments.',
      translation: '中国加快地方政府专项债发行，以推动基建投资、稳定经济增长。财政部数据显示，截至8月中旬已发行专项债3.5万亿元，占全年额度的70%以上。资金主要投向交通、能源和新型基建项目。发行节奏加快反映了在全球逆风下政策层支持内需的决心。分析师预计下半年将有更多财政措施，包括可能的减税和增加对地方政府的转移支付。',
      source: '财经精选 · 2026.08'
    },
    // —— 股票基金 ——
    {
      id: 'w_stk_0', category: '股票基金',
      title: '科技股领涨美股，AI概念股持续走强',
      description: 'US stock markets reached new record highs as AI-related stocks continue to outperform. The Nasdaq Composite has risen over 25% year-to-date, driven primarily by large-cap technology companies. NVIDIA shares have more than tripled, while other semiconductor and software companies also posted substantial gains. Analysts point to accelerating AI adoption across industries as the key catalyst. However, some investors worry about stretched valuations and potential concentration risks in the market. Active fund managers are increasingly diversifying beyond the "Magnificent Seven" to find opportunities in mid-cap and under-the-radar AI plays.',
      translation: '美股再创新高，AI相关股票持续跑赢大盘。纳斯达克综合指数年内涨幅超过25%，主要由大型科技公司推动。英伟达股价涨了两倍多，其他半导体和软件公司也涨幅显著。分析师认为各行业加速采用AI是关键催化剂。然而，部分投资者担忧估值过高和市场集中度风险。主动型基金经理正越来越多地从"七巨头"之外寻找中型股和潜在AI标的的投资机会。',
      source: '投资观察 · 2026.08'
    },
    {
      id: 'w_stk_1', category: '股票基金',
      title: 'A股市场震荡筑底，北向资金流向分化',
      description: 'China A-share market continues its bottom-building process with mixed performance across sectors. The Shanghai Composite Index has been range-bound between 3,100 and 3,300 points. Northbound capital flows show divergence, with steady inflows into consumer and healthcare stocks while financial and property sectors see outflows. Mutual fund managers are positioning for potential policy-driven recovery, increasing allocations to advanced manufacturing and new energy sectors. Retail investors remain cautious, with trading volumes staying below historical averages. The key question is whether upcoming policy easing measures will be sufficient to reverse the current downtrend.',
      translation: 'A股市场延续震荡筑底走势，各板块表现分化。上证指数在3100-3300点区间震荡。北向资金流向分化，消费和医药板块持续流入，金融和地产板块则遭遇流出。基金经理正在为可能的政策驱动复苏布局，增配高端制造和新能源板块。散户投资者仍保持谨慎，成交量低于历史均值。关键问题在于即将出台的政策宽松措施是否足以扭转当前的下行趋势。',
      source: 'A股观察 · 2026.08'
    },
    // —— 战争国情 ——
    {
      id: 'w_war_0', category: '战争国情',
      title: '俄乌冲突进入第三年，和谈前景仍不明朗',
      description: 'The Russia-Ukraine conflict enters its third year with no clear path to peace. Frontline fighting has largely stalemated, with both sides suffering heavy casualties but unable to achieve decisive breakthroughs. Diplomatic efforts continue behind the scenes, but fundamental disagreements over territory and security guarantees remain. The war has reshaped global energy markets, accelerated NATO expansion, and triggered the largest refugee crisis in Europe since World War II. Economic costs continue to mount for both sides and their respective allies. International observers warn that the conflict could persist for years without a negotiated settlement.',
      translation: '俄乌冲突进入第三年，和平前景仍不明朗。前线战斗基本陷入僵局，双方伤亡惨重但均未能取得决定性突破。外交努力仍在幕后进行，但在领土和安全保障问题上仍存在根本分歧。这场战争重塑了全球能源市场，加速了北约扩张，并引发了二战以来欧洲最大的难民危机。双方及其盟友的经济代价持续攀升。国际观察人士警告，若无法达成谈判解决方案，冲突可能持续数年。',
      source: '国际观察 · 2026.08'
    },
    {
      id: 'w_war_1', category: '战争国情',
      title: '中东局势持续紧张，地缘政治风险加剧',
      description: 'Middle East tensions remain elevated with ongoing conflicts and regional power struggles. The Israel-Hamas conflict has caused massive civilian casualties and humanitarian suffering in Gaza. Diplomatic efforts for a cease-fire and hostage release deal continue but have yet to produce a breakthrough. Meanwhile, exchanges of fire with Hezbollah along the Lebanon border risk a wider regional conflict. The situation has significant implications for global oil supplies and shipping routes through the Red Sea. Oil prices remain volatile as markets assess the risk of escalation. Major powers are engaged in shuttle diplomacy to prevent further destabilization.',
      translation: '中东局势持续紧张，冲突不断，地区权力斗争加剧。以哈冲突已造成加沙大量平民伤亡和人道主义灾难。停火和人质释放协议的外交努力仍在继续，但尚未取得突破。与此同时，与黎巴嫩真主党在边境的交火有引发更广泛地区冲突的风险。局势对全球石油供应和红海航运路线具有重大影响。由于市场评估局势升级风险，油价持续波动。主要大国正开展穿梭外交以防止局势进一步动荡。',
      source: '国际观察 · 2026.08'
    },
    // —— AI科技 ——
    {
      id: 'w_ai_0', category: 'AI科技',
      title: 'AI大模型进入多模态时代，应用场景快速拓展',
      description: 'Artificial intelligence enters the multimodal era as leading models gain the ability to process text, images, audio, and video simultaneously. Next-generation AI systems can understand complex visual information, generate realistic video content, and engage in natural conversations with voice. Enterprise adoption is accelerating, with companies integrating AI into customer service, content creation, and decision-making processes. However, concerns about job displacement, misinformation, and algorithmic bias continue to grow. Governments around the world are racing to establish regulatory frameworks. The pace of technological advancement shows no signs of slowing, with new breakthroughs announced almost weekly.',
      translation: '人工智能进入多模态时代，领先模型已具备同时处理文本、图像、音频和视频的能力。新一代AI系统能够理解复杂的视觉信息、生成逼真的视频内容，并进行自然的语音对话。企业应用正在加速，各公司将AI整合到客服、内容创作和决策流程中。然而，对就业替代、虚假信息和算法偏见的担忧也在加剧。世界各国政府正竞相建立监管框架。技术进步的步伐没有放缓迹象，几乎每周都有新的突破发布。',
      source: '科技前沿 · 2026.08'
    },
    {
      id: 'w_ai_1', category: 'AI科技',
      title: '具身智能加速发展，机器人产业迎来拐点',
      description: 'Embodied AI — intelligent robots with physical bodies — is advancing rapidly as breakthroughs in foundation models transfer to robotics. Humanoid robots can now perform complex manipulation tasks, navigate unpredictable environments, and learn new skills through demonstration. Major tech companies and specialized startups are investing billions in the field. Applications range from manufacturing and logistics to healthcare and home assistance. The cost of robot hardware continues to fall while capabilities improve exponentially. Industry experts predict that general-purpose humanoid robots could become commercially viable within the next few years, fundamentally changing labor markets and daily life.',
      translation: '具身智能——拥有物理躯体的智能机器人——正在快速发展，基础模型的突破正向机器人领域迁移。人形机器人现在能够执行复杂的操作任务、在不可预测的环境中导航，并通过示范学习新技能。大型科技公司和专业初创公司正在该领域投入数十亿美元。应用场景从制造、物流到医疗和家庭辅助。机器人硬件成本持续下降，能力却呈指数级提升。行业专家预测，通用人形机器人可能在未来几年内实现商业化，从根本上改变劳动力市场和日常生活。',
      source: '科技前沿 · 2026.08'
    },
    // —— 民生经营 ——
    {
      id: 'w_life_0', category: '民生经营',
      title: '消费降级与理性消费并存，新消费趋势显现',
      description: 'A new consumer landscape is emerging as people balance cost-consciousness with quality demands. The "consumption downgrade" trend coexists with a growing preference for value-for-money products. Consumers are increasingly researching purchases, comparing prices across platforms, and prioritizing essential spending. Discount retailers and private-label brands are gaining market share. At the same time, experience-based consumption such as travel and dining remains resilient. Small business owners are adapting by offering more affordable product lines and improving operational efficiency. The shift is reshaping retail, e-commerce, and service industries across the country.',
      translation: '新的消费格局正在形成，人们在成本意识与品质需求之间寻求平衡。"消费降级"趋势与对高性价比产品的日益偏好并存。消费者越来越多地研究购买、在各平台比价，并优先考虑必要支出。折扣零售商和自有品牌正在 gaining 市场份额。与此同时，旅游、餐饮等体验式消费仍保持韧性。小企业主正在通过推出更实惠的产品线和提高运营效率来适应变化。这一转变正在重塑全国的零售、电商和服务行业。',
      source: '民生观察 · 2026.08'
    },
    {
      id: 'w_life_1', category: '民生经营',
      title: '个体户与小微企业经营困境与破局之道',
      description: 'Small businesses and individual entrepreneurs face persistent challenges amid economic uncertainty. Rising rents, labor costs, and intense competition squeeze profit margins. Many shop owners report flat or declining revenues. However, some are finding success through creative adaptation: leveraging social media for marketing, offering personalized services, and exploring niche markets. The government has introduced support measures including tax cuts and loan subsidies, but implementation varies by region. Digital transformation is both a challenge and an opportunity — businesses that embrace online channels and data-driven operations tend to perform better. Resilience and flexibility remain key survival traits in the current environment.',
      translation: '在经济不确定性中，小微企业和个体户面临持续挑战。租金上涨、劳动力成本和激烈竞争挤压了利润空间。许多店主报告收入持平或下降。然而，一些企业通过创造性适应取得了成功：利用社交媒体营销、提供个性化服务、探索利基市场。政府已推出包括减税和贷款补贴在内的支持措施，但各地执行情况不一。数字化转型既是挑战也是机遇——拥抱线上渠道和数据化运营的企业往往表现更好。韧性和灵活性仍然是当前环境下的关键生存特质。',
      source: '民生观察 · 2026.08'
    },
    // —— 信息差 ——
    {
      id: 'w_info_0', category: '信息差',
      title: '大多数人不知道的5个财富认知差',
      description: 'The gap between wealthy and average individuals often comes down to differences in thinking rather than income. Key distinctions include: 1) The rich buy assets first, then liabilities; the middle class buys liabilities thinking they are assets. 2) Wealth is built through compounding over decades, not get-rich-quick schemes. 3) The most valuable asset is your mind and your network — investing in learning pays the highest returns. 4) Tax strategy is not just for the wealthy; understanding basic tax optimization can save ordinary people significant money. 5) Most people trade time for money; the wealthy build systems that generate income without their direct involvement. These mental shifts, not luck or inheritance, explain most wealth differences.',
      translation: '富人和普通人之间的差距往往源于思维方式的不同，而非收入差异。关键区别包括：1）富人先买资产，再买负债；中产阶级买以为是资产的负债。2）财富是通过数十年复利积累的，而非快速致富。3）最有价值的资产是你的头脑和人脉——投资学习回报最高。4）税务筹划不只是富人的事；了解基本的税务优化能为普通人省下不少钱。5）大多数人用时间换钱；富人建立无需亲自参与就能产生收入的系统。这些思维转变，而非运气或继承，才是大多数财富差异的原因。',
      source: '认知升级 · 精选'
    },
    {
      id: 'w_info_1', category: '信息差',
      title: '职场中被低估的软技能，比专业能力更决定上限',
      description: 'While technical skills get you hired, soft skills determine how far you advance. The most underrated career skills include: 1) Clear written communication — the ability to convey ideas concisely in emails and documents saves everyone time. 2) Meeting management — running effective meetings is a rare and valuable skill that demonstrates leadership. 3) Emotional intelligence — understanding what motivates colleagues and managing relationships makes you irreplaceable. 4) Saying no strategically — protecting your time for high-impact work rather than pleasing everyone. 5) Learning how to learn — the meta-skill of acquiring new competencies quickly is the ultimate career insurance in a fast-changing world.',
      translation: '虽然专业技能让你获得工作，但软技能决定了你能走多远。最被低估的职场技能包括：1）清晰的书面沟通——在邮件和文档中简洁传达想法能为所有人节省时间。2）会议管理——高效主持会议是一种稀有且有价值的技能，能展现领导力。3）情商——理解同事的动机并管理人际关系让你不可替代。4）有策略地说不——保护你的时间投入高影响工作，而非取悦所有人。5）学会如何学习——快速获取新能力的元技能是快速变化世界中终极的职业保险。',
      source: '认知升级 · 精选'
    },
    {
      id: 'w_info_2', category: '信息差',
      title: '普通人如何利用信息差创造额外收入',
      description: 'Information arbitrage — profiting from gaps in knowledge and access — is accessible to everyone, not just insiders. Practical approaches include: 1) Cross-platform price differences — products sell for different prices on different platforms; buying low and selling high requires only research and timing. 2) Local knowledge advantage — what is common in your city or industry may be unknown elsewhere. 3) Early adoption curve — being among the first to understand new tools and platforms creates a temporary advantage. 4) Content aggregation — organizing scattered information into structured, useful formats creates real value. 5) Skill translation — translating professional skills into new contexts (e.g., a teacher creating online courses) multiplies your earning potential. The key is curiosity, observation, and taking action on what you notice.',
      translation: '信息套利——利用知识和获取渠道的差距获利——不仅是内部人的专利，每个人都可以做到。实用方法包括：1）跨平台价差——同一产品在不同平台售价不同，低买高卖只需要研究和时机把握。2）本地知识优势——你所在城市或行业的常识可能在其他地方鲜为人知。3）早期采用曲线——率先理解新工具和新平台能创造暂时优势。4）内容整合——将零散信息整理成结构化的有用格式能创造真正的价值。5）技能迁移——将专业技能应用到新场景（如教师做在线课程）能倍增你的收入潜力。关键在于好奇心、观察力，以及对你发现的机会采取行动。',
      source: '认知升级 · 精选'
    },
    // —— 更多美国金融财政 ——
    {
      id: 'w_fin_2', category: '金融财政',
      title: '美国国债收益率曲线变动与经济信号解读',
      description: 'The US Treasury yield curve provides critical signals about market expectations for growth and inflation. The 10-year vs 2-year spread, closely watched by economists, has historically predicted recessions when inverted. Currently, as the Fed pivots toward rate cuts, the yield curve is normalizing. Short-term yields are falling faster than long-term yields, reflecting expectations of monetary policy easing. Investors should monitor yield movements alongside economic data — employment, inflation, and consumer spending — to gauge the trajectory of the business cycle. The relationship between bond yields and stock valuations also matters: lower rates generally support equity multiples, but only if earnings hold up.',
      translation: '美国国债收益率曲线提供了关于市场对增长和通胀预期的关键信号。经济学家密切关注的10年期与2年期利差，在倒挂时历来能预测衰退。目前，随着美联储转向降息，收益率曲线正在正常化。短期收益率下降速度快于长期收益率，反映了货币政策宽松的预期。投资者应结合经济数据——就业、通胀和消费支出——来监控收益率变动，以判断商业周期轨迹。债券收益率与股票估值之间的关系也很重要：低利率通常支持股票估值倍数，但前提是盈利保持稳定。',
      source: '美国财经观察 · 2026.08'
    },
    {
      id: 'w_fin_3', category: '金融财政',
      title: '美元霸权地位面临挑战，全球去美元化进程加速',
      description: 'The US dollar\'s dominance as the world\'s reserve currency faces growing challenges. Countries including China, Russia, and members of the BRICS bloc are increasingly conducting trade in their own currencies. The rise of digital currencies and new payment systems further diversifies the global financial landscape. However, experts caution that de-dollarization is a gradual process, not an abrupt shift. The US economy\'s size, the depth of its financial markets, and the rule of law still support dollar dominance. The real question is whether the world is moving toward a multipolar currency system rather than replacing the dollar with a single alternative. This shift has profound implications for US borrowing costs and global financial stability.',
      translation: '美元作为世界储备货币的主导地位面临日益增长的挑战。中国、俄罗斯以及金砖国家等越来越多地使用本币进行贸易。数字货币和新支付系统的兴起进一步使全球金融格局多元化。然而，专家警告，去美元化是一个渐进过程，而非突然转变。美国经济规模、金融市场的深度以及法治仍然支撑着美元的主导地位。真正的问题在于，世界是否正在走向一个多极化的货币体系，而非用单一替代货币取代美元。这一转变对美国借贷成本和全球金融稳定具有深远影响。',
      source: '国际金融观察 · 2026.08'
    },
    // —— 更多股票基金 ——
    {
      id: 'w_stk_2', category: '股票基金',
      title: '美股七巨头估值分化，AI投资回报分化开始显现',
      description: 'The "Magnificent Seven" tech giants that led the US stock market rally are showing divergent performance. Companies with genuine AI revenue growth — particularly those providing infrastructure like chips and cloud services — continue to outperform. Meanwhile, companies where AI remains more hype than reality are starting to underperform. Investors are becoming more selective, focusing on actual profitability rather than narrative. This shift from broad-based tech enthusiasm to fundamental differentiation marks a maturing of the AI investment cycle. Fund managers recommend diversifying beyond the largest names and looking for second-tier beneficiaries that may offer better risk-reward ratios.',
      translation: '引领美股上涨的"七巨头"科技巨头正在出现分化。那些真正实现AI收入增长的公司——尤其是提供芯片和云服务等基础设施的公司——继续跑赢大盘。与此同时，AI更多停留在炒作层面而非实际落地的公司开始表现不佳。投资者正变得更加挑剔，关注实际盈利能力而非故事叙事。从全面的科技狂热转向基本面分化，标志着AI投资周期正在走向成熟。基金经理建议在最大的公司之外进行多元化配置，寻找可能提供更好风险回报比的二线受益标的。',
      source: '美股深度 · 2026.08'
    },
    {
      id: 'w_stk_3', category: '股票基金',
      title: '指数基金vs主动基金：长期数据告诉你真相',
      description: 'The debate between index funds and actively managed funds continues, but the data tells a clear story. Over 10-year periods, approximately 85-90% of active fund managers fail to beat their benchmark index after fees. This underperformance persists across market cycles and asset classes. Index funds offer broad diversification, low costs, and tax efficiency. However, active management can still add value in less efficient markets like small-cap stocks, emerging markets, and fixed income. The optimal approach for most investors is a core of low-cost index funds supplemented by carefully selected active strategies in niche areas. The most important factor remains asset allocation, not fund selection.',
      translation: '指数基金与主动管理基金之间的争论仍在继续，但数据说明了一个清晰的事实。在10年的时间跨度里，约85%-90%的主动基金经理在扣除费用后未能跑赢其基准指数。这种跑输现象在不同市场周期和资产类别中都存在。指数基金提供广泛的分散化、低成本和税收效率。然而，在小盘股、新兴市场和固定收益等效率较低的市场中，主动管理仍可能创造价值。对大多数投资者来说，最优策略是以低成本指数基金为核心，在细分领域辅以精心挑选的主动策略。最重要的因素仍然是资产配置，而非基金选择。',
      source: '投资知识 · 精选'
    },
    // —— AI 更多内容 ——
    {
      id: 'w_ai_2', category: 'AI科技',
      title: 'AI Agent 时代来临：从聊天机器人到自主行动者',
      description: 'AI agents — autonomous systems that can plan, reason, and take actions — represent the next major wave of artificial intelligence. Unlike chatbots that only respond to prompts, AI agents can set goals, break them into steps, use tools, and adapt to obstacles. Companies are deploying agents for customer service, software development, research, and operational tasks. The technology is still early, with challenges around reliability and safety, but progress is rapid. The economic implications are enormous: knowledge work could be fundamentally transformed as agents handle more complex cognitive tasks. Workers who learn to collaborate effectively with AI agents will have a significant advantage in the job market.',
      translation: 'AI智能体——能够规划、推理和采取行动的自主系统——代表了人工智能的下一个主要浪潮。与只响应提示的聊天机器人不同，AI智能体可以设定目标、分解步骤、使用工具并适应障碍。企业正在部署智能体用于客户服务、软件开发、研究和运营任务。这项技术仍处于早期阶段，在可靠性和安全性方面存在挑战，但进展迅速。经济影响是巨大的：随着智能体处理更复杂的认知任务，知识工作可能从根本上被改变。学会与AI智能体有效协作的工作者将在就业市场中拥有显著优势。',
      source: 'AI前沿 · 2026.08'
    },
    // —— 国情更多内容 ——
    {
      id: 'w_war_2', category: '战争国情',
      title: '中国经济转型进行时：从高速增长到高质量发展',
      description: "China's economy is undergoing a profound structural transformation. The old growth model driven by real estate investment and export manufacturing is fading, while new engines like advanced manufacturing, green energy, and domestic consumption are emerging. The transition is challenging — property sector deleveraging, local government debt, and weak consumer confidence are headwinds. However, China continues to lead in key industries including electric vehicles, solar panels, batteries, and industrial automation. The government's policy focus has shifted from stimulus to structural reform and tech self-reliance. How this transition unfolds will shape not only China's future but also the global economy for decades to come.",
      translation: '中国经济正在经历深刻的结构性转型。由房地产投资和出口制造驱动的旧增长模式正在消退，而高端制造、绿色能源和国内消费等新引擎正在崛起。转型充满挑战——房地产去杠杆、地方政府债务和消费信心不足都是逆风。然而，中国在电动汽车、太阳能板、电池和工业自动化等关键产业中继续保持领先。政府政策重点已从刺激转向结构性改革和科技自立自强。这一转型的走向不仅将塑造中国的未来，也将在未来几十年影响全球经济。',
      source: '中国经济观察 · 2026.08'
    },
  ],

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

    // 始终先加载内置内容，保证有内容可看
    if (this.worldCache.items.length === 0) {
      this.worldCache.items = this.builtinWorld.map(it => ({ ...it, isBuiltin: true }));
      this.worldCache.categories = this.WORLD_CATEGORIES;
      this.worldLoaded = true;
    }

    try {
      // 尝试后端 API
      let apiItems = [];
      try {
        const res = await fetch('/api/world/news?limit=100', { signal: _timeoutSignal(5000) });
        if (res.ok) {
          const data = await res.json();
          apiItems = (data.items || []).map(it => ({ ...it }));
        }
      } catch (e) {
        console.log('后端API不可用');
      }

      // 后端不可用时，直接通过CORS代理抓取RSS
      if (apiItems.length === 0) {
        const results = await Promise.allSettled(
          WORLD_FEEDS.map(f => fetchRSSViaProxy(f.url).then(items => items.map(it => ({ ...it, category: f.category }))))
        );
        results.forEach(r => {
          if (r.status === 'fulfilled') apiItems.push(...r.value);
        });
      }

      if (apiItems.length > 0) {
        // 合并：内置 + API 最新
        const builtin = this.builtinWorld.map(it => ({ ...it, isBuiltin: true }));
        this.worldCache.items = [...builtin, ...apiItems];
        this.worldCache.categories = this.WORLD_CATEGORIES;
        this.worldCache.time = new Date().toISOString();
        this.worldLoaded = true;
      }
    } catch (e) {
      console.error('加载世界资讯失败', e);
    } finally {
      if (loading) loading.style.display = 'none';
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

    // 第一个分类就是"全部"，不用额外加
    const tabs = categories.map(cat => ({ key: cat, label: cat }));

    container.innerHTML = tabs.map(tab => {
      const active = currentCat === tab.key ? 'active' : '';
      return `<button class="tab ${active}" onclick="${setter}('${_esc(tab.key)}')">${_esc(tab.label)}</button>`;
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
    if (this.worldCategory !== '全部') {
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
    const time = this.getDisplayTime(item);
    const hasTrans = item.translation && item.translation.length > 0;
    const transLabel = hasTrans ? ' · 含翻译' : '';
    const starClass = isFav ? 'fav-btn on' : 'fav-btn';
    const starText = isFav ? '已收藏' : '收藏';

    return `
      <div class="news-card" onclick="News.openDetail(${idx}, '${type}')">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="flex:1;min-width:0">
            <div class="news-title">${_esc(item.title || '无标题')}</div>
            <div class="news-desc">${_esc(item.description || '')}</div>
          </div>
          <div class="fav-col" onclick="event.stopPropagation();News.toggleFavorite(${idx}, '${type}');News._refreshNewsCardFav(${idx}, '${type}')" id="newscard-fav-${type}-${idx}">
            <div class="${starClass}">${isFav ? '★' : '☆'}</div>
            <div class="fav-label">${starText}</div>
          </div>
        </div>
        <div class="news-meta">
          <span>${_esc(item.source || '未知来源')}</span>
          ${item.category ? `<span>· ${_esc(item.category)}</span>` : ''}
          ${hasTrans ? `<span>· 含翻译</span>` : ''}
        </div>
      </div>
    `;
  },

  _refreshNewsCardFav(idx, type) {
    const el = document.getElementById(`newscard-fav-${type}-${idx}`);
    if (!el) return;
    const star = el.querySelector('.fav-btn');
    const label = el.querySelector('.fav-label');
    if (!star || !label) return;
    const isOn = star.classList.contains('on');
    if (isOn) {
      star.classList.remove('on');
      star.textContent = '☆';
      label.textContent = '收藏';
    } else {
      star.classList.add('on');
      star.textContent = '★';
      label.textContent = '已收藏';
    }
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
      .filter(line => line.trim())
      .map(line => '<p>' + _esc(line) + '</p>')
      .join('');

    // 中文翻译（内置内容直接有 translation 字段）
    const hasTranslation = item.translation && item.translation.length > 0;
    const transHtml = hasTranslation
      ? '<div class="detail-cn"><div class="detail-cn-label">中文翻译</div><div>' +
        item.translation.split('\n').filter(l => l.trim()).map(l => '<p>' + _esc(l) + '</p>').join('') +
        '</div></div>'
      : '';

    const html = `
      <div class="detail">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px">
          <h3 style="font-size:16px;font-weight:700;line-height:1.4;flex:1;margin:0">${_esc(item.title || '无标题')}</h3>
          <button onclick="News.toggleFavorite(${idx}, '${type}');News._refreshDetailStar(${idx}, '${type}')" class="star-btn" id="detail-star-${type}-${idx}" style="font-size:18px;flex-shrink:0">☆</button>
        </div>
        <div style="font-size:11px;color:#999;margin-bottom:12px">
          ${_esc(item.source || '未知来源')}
          ${item.category ? ' · ' + _esc(item.category) : ''}
          ${time ? ' · ' + time : ''}
        </div>
        <div style="border-top:1px solid #f0f0f0;padding-top:12px">
          ${descHtml || '<p style="color:#ccc">暂无详细内容</p>'}
          ${transHtml}
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid #f0f0f0">
          <button onclick="News.toggleFavorite(${idx}, '${type}');News._refreshDetailSaveBtn(${idx}, '${type}')" style="flex:1;padding:10px;border-radius:6px;font-size:13px;border:1px solid #000;background:#000;color:#fff" id="detail-save-btn-${type}-${idx}">
            收藏
          </button>
          <button onclick="News.copyContent(${idx}, '${type}')" style="flex:1;padding:10px;border-radius:6px;font-size:13px;border:1px solid #ddd;background:#fff;color:#000">
            复制
          </button>
        </div>
        ${linkHtml ? '<div style="text-align:center;margin-top:10px"><a href="' + _esc(item.link) + '" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#999;text-decoration:underline">查看原文 →</a></div>' : ''}
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
