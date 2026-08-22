/* ===== Jade 工作台 · 理财专区 ===== */
/* 全黑白灰色系，依赖全局 Store / Nav / Modal / Toast / DateUtil */

const Finance = {
  // 收支月历当前视图
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),

  // 伸缩面板状态：null 表示收起，'risk'|'fixed'|'daily' 表示展开的类别
  activePanel: null,

  // 资产明细折叠状态
  detailsOpen: false,

  // 弹窗临时编辑态
  _recType: 'expense',          // 新增收支时选中的类型
  _editingRecord: null,         // 正在编辑的收支记录对象
  _editingAsset: null,          // 正在编辑的资产对象
  _editingPlan: null,           // 正在编辑的存钱计划对象
  _confirmCb: null,             // 自定义确认弹窗回调

  /* ---------- 工具方法 ---------- */

  // HTML 转义，防止备注等内容破坏属性/结构
  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  // 金额格式化：¥1,234.5
  fmtMoney(n) {
    const num = Number(n) || 0;
    return '¥' + num.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  },

  // 月历中日净收支的简短展示：+50 / -50 / +1.5k / -2.3w
  fmtNet(n) {
    if (!n) return '0';
    const abs = Math.abs(n);
    let body;
    if (abs >= 10000) body = (n / 10000).toFixed(1) + 'w';
    else if (abs >= 1000) body = (n / 1000).toFixed(1) + 'k';
    else body = Number.isInteger(n) ? String(n) : n.toFixed(1);
    return (n > 0 ? '+' : '') + body;
  },

  // 自定义确认弹窗（保持黑白灰风格，替代原生 confirm）
  _confirm(msg) {
    return new Promise((resolve) => {
      this._confirmCb = resolve;
      Modal.open(
        '<div class="space-y-4 text-center">' +
          '<p class="text-sm py-2 text-gray-700">' + this._esc(msg) + '</p>' +
          '<div class="flex gap-2">' +
            '<button onclick="Finance._confirmResolve(false)" class="btn-secondary flex-1">取消</button>' +
            '<button onclick="Finance._confirmResolve(true)" class="btn-primary flex-1">确认</button>' +
          '</div>' +
        '</div>'
      );
    });
  },
  _confirmResolve(v) {
    Modal.closeForce();
    const cb = this._confirmCb;
    this._confirmCb = null;
    if (cb) cb(v);
  },

  /* ---------- 主渲染入口 ---------- */
  async render() {
    try {
      await this.renderAssets();
      await this.renderAssetPanel();
      await this.renderAssetDetails();
      await this.renderCalendar();
      await this.renderRecords();
      await this.renderChart();
      await this.renderPlans();
    } catch (e) {
      console.error('Finance.render 失败', e);
      Toast.show('理财页加载失败');
    }
  },

  /* ---------- 1. 资产卡片总额 ---------- */
  async renderAssets() {
    const assets = await Store.getAll('assets');
    const sum = (t) => assets.filter(a => a.type === t).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const el1 = document.getElementById('asset-risk-total');
    const el2 = document.getElementById('asset-fixed-total');
    const el3 = document.getElementById('asset-daily-total');
    if (el1) el1.textContent = this.fmtMoney(sum('risk'));
    if (el2) el2.textContent = this.fmtMoney(sum('fixed'));
    if (el3) el3.textContent = this.fmtMoney(sum('daily'));
  },

  /* ---------- 2/3/4. 伸缩编辑面板 ---------- */
  togglePanel(type) {
    if (this.activePanel === type) {
      this.activePanel = null; // 再次点击收起
    } else {
      this.activePanel = type;
    }
    this.renderAssetPanel();
  },

  closePanel() {
    this.activePanel = null;
    this.renderAssetPanel();
  },

  async renderAssetPanel() {
    const panel = document.getElementById('asset-panel');
    const titleEl = document.getElementById('asset-panel-title');
    const contentEl = document.getElementById('asset-panel-content');
    if (!panel || !titleEl || !contentEl) return;

    if (!this.activePanel) {
      panel.classList.add('hidden');
      return;
    }

    const typeLabels = { risk: '风险投资', fixed: '固定资产', daily: '日常开销' };
    titleEl.textContent = '编辑 · ' + (typeLabels[this.activePanel] || this.activePanel);

    const assets = await Store.getAll('assets');
    const list = assets.filter(a => a.type === this.activePanel);

    const listHtml = list.length === 0
      ? '<div class="text-center text-xs text-ash py-3">暂无条目</div>'
      : list.map(a =>
          '<div class="flex items-center justify-between py-2 border-b border-fog last:border-0">' +
            '<div class="flex-1 min-w-0 pr-2">' +
              '<div class="text-xs font-medium truncate">' + this._esc(a.name) + '</div>' +
              '<div class="text-[10px] text-ash">' + this.fmtMoney(a.amount) +
                (a.note ? ' · ' + this._esc(a.note) : '') + '</div>' +
            '</div>' +
            '<div class="flex gap-1 shrink-0">' +
              '<button onclick="Finance.openEditAsset(' + a.id + ')" class="mini-plus">✎</button>' +
              '<button onclick="Finance.deleteAsset(' + a.id + ')" class="mini-plus">×</button>' +
            '</div>' +
          '</div>'
        ).join('');

    contentEl.innerHTML =
      '<div>' + listHtml + '</div>' +
      '<div class="mt-3 pt-3 border-t border-fog space-y-2">' +
        '<div class="text-[10px] text-ash">新增条目</div>' +
        '<input id="asset-name" placeholder="名称（如股票、定期存款）">' +
        '<input id="asset-amount" type="number" inputmode="decimal" placeholder="金额">' +
        '<input id="asset-note" placeholder="备注（可选）">' +
        '<button onclick="Finance.saveAsset(\'' + this.activePanel + '\')" class="btn-primary w-full">新增</button>' +
      '</div>';

    panel.classList.remove('hidden');
  },

  // 面板内新增资产
  async saveAsset(type) {
    const name = (document.getElementById('asset-name') || {}).value;
    const amountRaw = (document.getElementById('asset-amount') || {}).value;
    const note = (document.getElementById('asset-note') || {}).value;
    const amount = parseFloat(amountRaw);
    if (!name || !name.trim()) { Toast.show('请输入名称'); return; }
    if (isNaN(amount) || amount < 0) { Toast.show('请输入有效金额'); return; }
    await Store.add('assets', {
      type,
      name: name.trim(),
      amount,
      note: (note || '').trim(),
      createdAt: new Date().toISOString()
    });
    Toast.show('已添加资产');
    this.render();
  },

  // 编辑资产（弹窗）
  async openEditAsset(id) {
    const assets = await Store.getAll('assets');
    const a = assets.find(x => x.id === id);
    if (!a) return;
    this._editingAsset = a;
    const typeLabels = { risk: '风险投资', fixed: '固定资产', daily: '日常开销' };
    Modal.open(
      '<div class="space-y-3">' +
        '<h3 class="text-base font-bold">编辑资产</h3>' +
        '<div class="text-xs text-ash">类型：' + (typeLabels[a.type] || a.type) + '</div>' +
        '<input id="ed-asset-name" placeholder="名称" value="' + this._esc(a.name) + '">' +
        '<input id="ed-asset-amount" type="number" inputmode="decimal" placeholder="金额" value="' + a.amount + '">' +
        '<input id="ed-asset-note" placeholder="备注（可选）" value="' + this._esc(a.note || '') + '">' +
        '<div class="flex gap-2">' +
          '<button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>' +
          '<button onclick="Finance.saveEditAsset()" class="btn-primary flex-1">保存</button>' +
        '</div>' +
      '</div>'
    );
  },

  async saveEditAsset() {
    const a = this._editingAsset;
    if (!a) { Modal.closeForce(); return; }
    const name = (document.getElementById('ed-asset-name') || {}).value;
    const amount = parseFloat((document.getElementById('ed-asset-amount') || {}).value);
    const note = (document.getElementById('ed-asset-note') || {}).value;
    if (!name || !name.trim()) { Toast.show('请输入名称'); return; }
    if (isNaN(amount) || amount < 0) { Toast.show('请输入有效金额'); return; }
    await Store.put('assets', {
      ...a,
      name: name.trim(),
      amount,
      note: (note || '').trim()
    });
    this._editingAsset = null;
    Modal.closeForce();
    Toast.show('已更新资产');
    this.render();
  },

  async deleteAsset(id) {
    if (!(await this._confirm('确认删除该资产条目？'))) return;
    await Store.del('assets', id);
    Toast.show('已删除');
    this.render();
  },

  /* ---------- 5. 资产明细折叠 ---------- */
  toggleDetails() {
    this.detailsOpen = !this.detailsOpen;
    this.renderAssetDetails();
  },

  async renderAssetDetails() {
    const box = document.getElementById('asset-details');
    const toggle = document.getElementById('details-toggle');
    if (!box || !toggle) return;
    if (!this.detailsOpen) {
      box.classList.add('hidden');
      toggle.textContent = '展开 ▾';
      box.innerHTML = '';
      return;
    }
    toggle.textContent = '收起 ▴';
    const assets = await Store.getAll('assets');
    const typeLabels = { risk: '风险投资', fixed: '固定资产', daily: '日常开销' };
    const types = ['risk', 'fixed', 'daily'];
    box.innerHTML = types.map(t => {
      const items = assets.filter(a => a.type === t);
      const total = items.reduce((s, a) => s + (Number(a.amount) || 0), 0);
      const rows = items.length === 0
        ? '<div class="text-[10px] text-ash py-1">暂无</div>'
        : items.map(a =>
            '<div class="flex justify-between text-xs py-1">' +
              '<span class="truncate pr-2">' + this._esc(a.name) +
                (a.note ? ' <span class="text-ash">· ' + this._esc(a.note) + '</span>' : '') + '</span>' +
              '<span class="text-ash shrink-0">' + this.fmtMoney(a.amount) + '</span>' +
            '</div>'
          ).join('');
      return '<div class="bg-white rounded-xl p-3 shadow-sm">' +
          '<div class="flex justify-between items-center mb-1">' +
            '<span class="text-xs font-semibold">' + (typeLabels[t] || t) + '</span>' +
            '<span class="text-xs font-bold">' + this.fmtMoney(total) + '</span>' +
          '</div>' + rows +
        '</div>';
    }).join('');
    box.classList.remove('hidden');
  },

  /* ---------- 6. 收支月历 ---------- */
  prevMonth() {
    this.calMonth--;
    if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; }
    this.renderCalendar();
  },

  nextMonth() {
    this.calMonth++;
    if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; }
    this.renderCalendar();
  },

  async renderCalendar() {
    const title = document.getElementById('fin-cal-title');
    const grid = document.getElementById('fin-cal-grid');
    if (!title || !grid) return;
    title.textContent = this.calYear + '年' + (this.calMonth + 1) + '月';

    const records = await Store.getAll('finance_records');
    // 计算每日净收支
    const netMap = {};
    records.forEach(r => {
      if (!netMap[r.date]) netMap[r.date] = 0;
      netMap[r.date] += r.type === 'income' ? (Number(r.amount) || 0) : -(Number(r.amount) || 0);
    });

    const firstDay = new Date(this.calYear, this.calMonth, 1).getDay();
    const days = DateUtil.daysInMonth(this.calYear, this.calMonth);
    const prevDays = DateUtil.daysInMonth(this.calYear, this.calMonth - 1);
    const todayStr = DateUtil.today();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

    let html = weekdays.map(w =>
      '<div class="text-center text-[9px] text-ash py-1">' + w + '</div>'
    ).join('');

    // 上月填充
    for (let i = firstDay - 1; i >= 0; i--) {
      html += '<div class="fin-cell" style="opacity:.3"><span>' + (prevDays - i) + '</span></div>';
    }
    // 本月
    for (let d = 1; d <= days; d++) {
      const dateStr = this.calYear + '-' +
        String(this.calMonth + 1).padStart(2, '0') + '-' +
        String(d).padStart(2, '0');
      const isToday = dateStr === todayStr;
      const net = netMap[dateStr];
      const cls = ['fin-cell'];
      if (isToday) cls.push('today');
      const todayStyle = isToday ? 'background:#ececec;font-weight:700;' : '';
      let amt = '';
      if (net && net !== 0) {
        const color = net > 0 ? '#1a1a1a' : '#8a8a8a';
        amt = '<span class="fin-amt" style="color:' + color + '">' + this.fmtNet(net) + '</span>';
      }
      html += '<div class="' + cls.join(' ') + '" style="' + todayStyle + '" ' +
        'onclick="Finance.openAddRecord(\'' + dateStr + '\')">' +
        '<span>' + d + '</span>' + amt + '</div>';
    }
    // 下月填充
    const total = firstDay + days;
    const fill = (7 - (total % 7)) % 7;
    for (let i = 1; i <= fill; i++) {
      html += '<div class="fin-cell" style="opacity:.3"><span>' + i + '</span></div>';
    }
    grid.innerHTML = html;
  },

  /* ---------- 7/8. 收支记录弹窗与列表 ---------- */
  openAddRecord(dateStr) {
    this._editingRecord = null;
    this._recType = 'expense';
    Modal.open(this._recordFormHTML({ date: dateStr || DateUtil.today() }));
  },

  async openEditRecord(id) {
    const records = await Store.getAll('finance_records');
    const r = records.find(x => x.id === id);
    if (!r) return;
    this._editingRecord = r;
    this._recType = r.type || 'expense';
    Modal.open(this._recordFormHTML(r));
  },

  _recordFormHTML(data = {}) {
    const isEdit = !!data.id;
    const type = data.type || this._recType || 'expense';
    this._recType = type;
    return '<div class="space-y-3">' +
      '<h3 class="text-base font-bold">' + (isEdit ? '编辑收支' : '新增收支') + '</h3>' +
      '<div class="flex gap-2">' +
        '<button id="rec-type-income" onclick="Finance.setRecType(\'income\')" ' +
          'class="tab-btn flex-1 ' + (type === 'income' ? 'active' : '') + '">收入</button>' +
        '<button id="rec-type-expense" onclick="Finance.setRecType(\'expense\')" ' +
          'class="tab-btn flex-1 ' + (type === 'expense' ? 'active' : '') + '">支出</button>' +
      '</div>' +
      '<input id="rec-amount" type="number" inputmode="decimal" placeholder="金额" value="' + (data.amount || '') + '">' +
      '<input id="rec-category" placeholder="分类（如餐饮、工资）" value="' + this._esc(data.category || '') + '">' +
      '<input id="rec-note" placeholder="备注（可选）" value="' + this._esc(data.note || '') + '">' +
      '<input id="rec-date" type="date" value="' + this._esc(data.date || DateUtil.today()) + '">' +
      '<div class="flex gap-2">' +
        '<button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>' +
        '<button onclick="Finance.saveRecord()" class="btn-primary flex-1">' + (isEdit ? '保存' : '添加') + '</button>' +
      '</div>' +
    '</div>';
  },

  setRecType(t) {
    this._recType = t;
    const inc = document.getElementById('rec-type-income');
    const exp = document.getElementById('rec-type-expense');
    if (inc) inc.classList.toggle('active', t === 'income');
    if (exp) exp.classList.toggle('active', t === 'expense');
  },

  async saveRecord() {
    const amount = parseFloat((document.getElementById('rec-amount') || {}).value);
    const category = ((document.getElementById('rec-category') || {}).value || '').trim();
    const note = ((document.getElementById('rec-note') || {}).value || '').trim();
    const date = (document.getElementById('rec-date') || {}).value;
    if (isNaN(amount) || amount <= 0) { Toast.show('请输入有效金额'); return; }
    if (!date) { Toast.show('请选择日期'); return; }

    const data = {
      type: this._recType,
      amount,
      category: category || '其他',
      note,
      date
    };

    if (this._editingRecord) {
      data.id = this._editingRecord.id;
      data.createdAt = this._editingRecord.createdAt || new Date().toISOString();
      await Store.put('finance_records', data);
      Toast.show('已更新记录');
    } else {
      data.createdAt = new Date().toISOString();
      await Store.add('finance_records', data);
      Toast.show('已添加记录');
    }
    this._editingRecord = null;
    Modal.closeForce();
    this.render();
  },

  async deleteRecord(id) {
    if (!(await this._confirm('确认删除该收支记录？'))) return;
    await Store.del('finance_records', id);
    Toast.show('已删除');
    this.render();
  },

  async renderRecords() {
    const el = document.getElementById('finance-records');
    if (!el) return;
    const records = await Store.getAll('finance_records');
    records.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    if (records.length === 0) {
      el.innerHTML = '<div class="text-center text-xs text-ash py-4">暂无收支记录</div>';
      return;
    }

    el.innerHTML = records.map(r => {
      const isInc = r.type === 'income';
      const sign = isInc ? '+' : '-';
      const amtClass = isInc ? 'text-ink' : 'text-ash';
      return '<div class="fin-record">' +
        '<div class="flex-1 min-w-0 pr-2">' +
          '<div class="text-xs font-medium truncate">' + this._esc(r.category) +
            (r.note ? ' · ' + this._esc(r.note) : '') + '</div>' +
          '<div class="text-[10px] text-ash">' + this._esc(r.date) + '</div>' +
        '</div>' +
        '<div class="flex items-center gap-2 shrink-0">' +
          '<span class="text-sm font-bold ' + amtClass + '">' + sign + this.fmtMoney(r.amount) + '</span>' +
          '<button onclick="Finance.openEditRecord(' + r.id + ')" class="mini-plus">✎</button>' +
          '<button onclick="Finance.deleteRecord(' + r.id + ')" class="mini-plus">×</button>' +
        '</div>' +
      '</div>';
    }).join('');
  },

  /* ---------- 9. 最近7天收支统计图（柱状图） ---------- */
  async renderChart() {
    const el = document.getElementById('finance-chart');
    if (!el) return;
    const records = await Store.getAll('finance_records');

    // 最近 7 天
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const ds = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      const inc = records.filter(r => r.date === ds && r.type === 'income')
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const exp = records.filter(r => r.date === ds && r.type === 'expense')
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
      days.push({ label: String(d.getDate()), inc, exp });
    }

    const max = Math.max(1, ...days.flatMap(d => [d.inc, d.exp]));
    const maxH = 52; // 柱体最大像素高度（容器 h-20=80px，留出标签空间）
    const barW = 6;

    el.innerHTML = days.map(d => {
      const incH = d.inc > 0 ? Math.max(3, Math.round(d.inc / max * maxH)) : 0;
      const expH = d.exp > 0 ? Math.max(3, Math.round(d.exp / max * maxH)) : 0;
      const incBar = '<div class="chart-bar" style="height:' + incH + 'px;width:' + barW +
        'px;min-height:0" title="收入 ' + this.fmtMoney(d.inc) + '"></div>';
      const expBar = '<div class="chart-bar expense" style="height:' + expH + 'px;width:' + barW +
        'px;min-height:0" title="支出 ' + this.fmtMoney(d.exp) + '"></div>';
      return '<div class="flex-1 flex flex-col items-center justify-end gap-1" style="height:100%">' +
          '<div class="flex items-end gap-0.5 justify-center">' + incBar + expBar + '</div>' +
          '<div class="chart-label">' + d.label + '</div>' +
        '</div>';
    }).join('');

    // 追加一次灰度图例（仅创建一次）
    const parent = el.parentElement;
    if (parent && !parent.querySelector('.chart-legend')) {
      const legend = document.createElement('div');
      legend.className = 'chart-legend flex gap-4 mt-2 text-[9px] text-ash';
      legend.innerHTML =
        '<span class="flex items-center gap-1"><span style="display:inline-block;width:8px;height:8px;background:#1a1a1a;border-radius:1px"></span>收入</span>' +
        '<span class="flex items-center gap-1"><span style="display:inline-block;width:8px;height:8px;background:#bbb;border-radius:1px"></span>支出</span>';
      parent.appendChild(legend);
    }
  },

  /* ---------- 10/11. 存钱计划 ---------- */
  openAddPlan() {
    this._editingPlan = null;
    Modal.open(this._planFormHTML());
  },

  async openEditPlan(id) {
    const plans = await Store.getAll('savings_plans');
    const p = plans.find(x => x.id === id);
    if (!p) return;
    this._editingPlan = p;
    Modal.open(this._planFormHTML(p));
  },

  _planFormHTML(data = {}) {
    const isEdit = !!data.id;
    return '<div class="space-y-3">' +
      '<h3 class="text-base font-bold">' + (isEdit ? '编辑存钱计划' : '新增存钱计划') + '</h3>' +
      '<input id="plan-name" placeholder="计划名称（如旅游基金）" value="' + this._esc(data.name || '') + '">' +
      '<input id="plan-target" type="number" inputmode="decimal" placeholder="目标金额" value="' + (data.target || '') + '">' +
      '<input id="plan-current" type="number" inputmode="decimal" placeholder="当前已存入" value="' + (data.current || '') + '">' +
      '<div class="flex gap-2">' +
        '<button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>' +
        '<button onclick="Finance.savePlan()" class="btn-primary flex-1">' + (isEdit ? '保存' : '添加') + '</button>' +
      '</div>' +
    '</div>';
  },

  async savePlan() {
    const name = ((document.getElementById('plan-name') || {}).value || '').trim();
    const target = parseFloat((document.getElementById('plan-target') || {}).value);
    const current = parseFloat((document.getElementById('plan-current') || {}).value);
    if (!name) { Toast.show('请输入名称'); return; }
    if (isNaN(target) || target <= 0) { Toast.show('请输入目标金额'); return; }
    const cur = isNaN(current) ? 0 : (current < 0 ? 0 : current);

    if (this._editingPlan) {
      await Store.put('savings_plans', {
        ...this._editingPlan,
        name,
        target,
        current: cur
      });
      Toast.show('已更新计划');
    } else {
      await Store.add('savings_plans', {
        name,
        target,
        current: cur,
        createdAt: new Date().toISOString()
      });
      Toast.show('已添加计划');
    }
    this._editingPlan = null;
    Modal.closeForce();
    this.render();
  },

  async deletePlan(id) {
    if (!(await this._confirm('确认删除该存钱计划？'))) return;
    await Store.del('savings_plans', id);
    Toast.show('已删除');
    this.render();
  },

  async renderPlans() {
    const el = document.getElementById('savings-plans');
    if (!el) return;
    const plans = await Store.getAll('savings_plans');
    plans.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (plans.length === 0) {
      el.innerHTML = '<div class="text-center text-xs text-ash py-4">暂无存钱计划</div>';
      return;
    }

    el.innerHTML = plans.map(p => {
      const target = Number(p.target) || 0;
      const current = Number(p.current) || 0;
      const pct = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0;
      return '<div class="plan-item">' +
        '<div class="flex items-center justify-between mb-2">' +
          '<span class="text-xs font-semibold truncate pr-2">' + this._esc(p.name) + '</span>' +
          '<div class="flex gap-1 shrink-0">' +
            '<button onclick="Finance.openEditPlan(' + p.id + ')" class="mini-plus">✎</button>' +
            '<button onclick="Finance.deletePlan(' + p.id + ')" class="mini-plus">×</button>' +
          '</div>' +
        '</div>' +
        '<div class="flex justify-between text-[10px] text-ash mb-1">' +
          '<span>' + this.fmtMoney(current) + ' / ' + this.fmtMoney(target) + '</span>' +
          '<span>' + pct + '%</span>' +
        '</div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('');
  }
};
