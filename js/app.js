/* ===== Jade 工作台 核心应用 ===== */

// 日期工具
const DateUtil = {
  today: () => new Date().toISOString().slice(0, 10),
  fmt(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日`;
  },
  fmtFull(d) {
    const dt = new Date(d);
    const p = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth()+1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  },
  fmtTime(d) {
    const dt = new Date(d);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(dt.getMonth()+1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  },
  daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); },
  isSameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); },
};

// 导航
const Nav = {
  current: 'home',
  go(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pageId)?.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-page="${pageId}"]`)?.classList.add('active');
    this.current = pageId;
    window.scrollTo(0, 0);
    if (pageId === 'home') Home.render();
    if (pageId === 'todo') Todo.render();
    if (pageId === 'finance') Finance.render();
    if (pageId === 'world') News.renderWorld();
    if (pageId === 'edu') News.renderEdu();
    if (pageId === 'fav') Favorites.render();
  }
};

// 模态弹窗
const Modal = {
  open(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
  },
  close(e) {
    if (e && e.target !== document.getElementById('modal-overlay')) return;
    document.getElementById('modal-overlay').classList.add('hidden');
  },
  closeForce() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }
};

// Toast
const Toast = {
  show(msg, dur = 2000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._t);
    this._t = setTimeout(() => el.classList.add('hidden'), dur);
  }
};

// 日历
const Calendar = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  selected: new Date().toISOString().slice(0, 10),

  prev() {
    this.month--;
    if (this.month < 0) { this.month = 11; this.year--; }
    this.render();
  },
  next() {
    this.month++;
    if (this.month > 11) { this.month = 0; this.year++; }
    this.render();
  },
  async render() {
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    const title = document.getElementById('cal-title');
    title.textContent = `${this.year}年${this.month + 1}月`;

    const todos = await Store.getAll('todos');
    const records = await Store.getAll('finance_records');
    const firstDay = new Date(this.year, this.month, 1).getDay();
    const days = DateUtil.daysInMonth(this.year, this.month);
    const prevDays = DateUtil.daysInMonth(this.year, this.month - 1);
    const todayStr = DateUtil.today();

    let html = '';
    // 上月填充
    for (let i = firstDay - 1; i >= 0; i--) {
      html += `<div class="cal-cell other-month">${prevDays - i}</div>`;
    }
    // 本月
    for (let d = 1; d <= days; d++) {
      const dateStr = `${this.year}-${String(this.month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === this.selected;
      const hasTodo = todos.some(t => t.date === dateStr);
      const todoDone = todos.some(t => t.date === dateStr && t.completed);
      const hasFin = records.some(r => r.date === dateStr);
      let icons = '';
      if (hasFin) icons += '<span>$</span>';
      if (todoDone) icons += '<span>👣</span>';
      const cls = ['cal-cell'];
      if (isToday) cls.push('today');
      if (isSelected) cls.push('selected');
      html += `<div class="${cls.join(' ')}" onclick="Calendar.select('${dateStr}')">
        <span>${d}</span>
        ${icons ? `<div class="cal-icons">${icons}</div>` : ''}
      </div>`;
    }
    // 下月填充
    const total = firstDay + days;
    const fill = (7 - (total % 7)) % 7;
    for (let i = 1; i <= fill; i++) {
      html += `<div class="cal-cell other-month">${i}</div>`;
    }
    grid.innerHTML = html;
  },
  select(dateStr) {
    this.selected = dateStr;
    this.render();
    Nav.go('todo');
    Toast.show(`已跳转到 ${DateUtil.fmt(dateStr)}`);
  }
};

// 首页
const Home = {
  async render() {
    await Calendar.render();
    await this.renderStats();
    await this.renderActivity();
  },
  async renderStats() {
    const todos = await Store.getAll('todos');
    const records = await Store.getAll('finance_records');
    const favs = await Store.getAll('favorites');
    const todayStr = DateUtil.today();
    const pending = todos.filter(t => !t.completed && t.date >= todayStr).length;
    const income = records.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = records.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    const net = income - expense;
    const eduFavs = favs.filter(f => f.type === 'edu').length;

    const el1 = document.getElementById('stat-todo');
    const el2 = document.getElementById('stat-finance');
    const el3 = document.getElementById('stat-study');
    if (el1) el1.textContent = pending;
    if (el2) el2.textContent = (net >= 0 ? '¥' : '-¥') + Math.abs(net);
    if (el3) el3.textContent = eduFavs;
  },
  async renderActivity() {
    const container = document.getElementById('latest-activity');
    if (!container) return;
    const todos = await Store.getAll('todos');
    const records = await Store.getAll('finance_records');
    const items = [];

    todos.forEach(t => items.push({
      time: t.createdAt || t.date, type: 'task',
      text: t.completed ? `✓ ${t.text}` : `○ ${t.text}`,
      date: t.date
    }));
    records.forEach(r => items.push({
      time: r.createdAt || r.date, type: 'finance',
      text: `${r.type === 'income' ? '+' : '-'}¥${r.amount} ${r.note || ''}`,
      date: r.date
    }));

    items.sort((a, b) => new Date(b.time) - new Date(a.time));
    const recent = items.slice(0, 5);

    if (recent.length === 0) {
      container.innerHTML = '<div class="text-center text-xs text-ash py-4">暂无动态</div>';
      return;
    }
    container.innerHTML = recent.map(i => `
      <div class="bg-white rounded-xl px-3 py-2 shadow-sm flex items-center justify-between">
        <span class="text-xs ${i.type === 'task' ? 'text-gray-700' : 'text-gray-500'}">${i.text}</span>
        <span class="text-[10px] text-ash">${DateUtil.fmtTime(i.time)}</span>
      </div>
    `).join('');
  }
};

// 数据导出
async function exportData() {
  const data = await Store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jade-backup-${DateUtil.today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  Toast.show('数据已导出');
}

// 数据导入
async function importDataFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  await Store.importData(data);
  Toast.show('数据已导入');
  Home.render();
}

// 应用初始化
const App = {
  async init() {
    try {
      await Store.open();
      await Store.requestPersistent();
      await Home.render();
      // 预加载新闻
      News.preload();
      // 绑定资讯卡片点击事件（事件委托方式，兼容 Safari）
      News.bindEvents();
      // 定期刷新首页数据
      setInterval(() => { if (Nav.current === 'home') Home.renderStats(); }, 60000);
    } catch (e) {
      console.error('初始化失败', e);
      Toast.show('初始化失败: ' + e.message);
    }
  }
};
