/* ===== Jade 工作台 · 待办清单模块 =====
 * 全黑白灰色系 · 圆角卡片 · iOS Safari 优化
 * 依赖全局：Store / Nav / Modal / Toast / DateUtil
 */

const Todo = {

  /* ---------- 主渲染入口 ---------- */
  async render() {
    const label = document.getElementById('todo-date-label');
    if (label) label.textContent = DateUtil.fmt(DateUtil.today());

    const list = document.getElementById('todo-list');
    if (!list) return;

    const todos = await Store.getAll('todos');
    const today = DateUtil.today();

    // 拆分：今日及未来 ↑ / 历史过期 ↓（仅按日期，不看完成状态）
    const upcoming = todos.filter(t => (t.date || today) >= today);
    const overdue = todos.filter(t => (t.date || today) < today);

    // 今日及未来：日期升序；同日内未完成在前、已完成在后
    upcoming.sort((a, b) => {
      const da = a.date || today, db = b.date || today;
      if (da !== db) return da.localeCompare(db);
      if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    // 历史：日期降序（越近越靠上）
    overdue.sort((a, b) => {
      const da = a.date || today, db = b.date || today;
      if (da !== db) return db.localeCompare(da);
      if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    // 空状态
    if (todos.length === 0) {
      list.innerHTML = `
        <div class="text-center py-16">
          <div class="text-5xl text-fog mb-3" style="line-height:1">✓</div>
          <p class="text-sm text-ash mb-1">还没有任务</p>
          <p class="text-xs text-ash mb-5">点击右上角 + 创建第一个任务</p>
          <button onclick="Todo.openAdd()" class="btn-primary px-6">新建任务</button>
        </div>`;
      return;
    }

    let html = '';
    if (upcoming.length) html += this.renderGroups(upcoming, false);
    if (overdue.length) {
      html += `
        <div class="flex items-center gap-2 px-1 pt-3 pb-1">
          <span class="text-[11px] font-semibold text-ash tracking-wider">历史任务</span>
          <span class="flex-1 h-px bg-fog"></span>
          <span class="text-[10px] text-ash">${overdue.length}</span>
        </div>`;
      html += this.renderGroups(overdue, true);
    }

    list.innerHTML = html;
  },

  /* ---------- 按日期分组渲染（每个日期一个独立板块） ---------- */
  renderGroups(todos, isHistory) {
    const groups = {};
    const order = [];
    todos.forEach(t => {
      const d = t.date;
      if (!groups[d]) { groups[d] = []; order.push(d); }
      groups[d].push(t);
    });
    // 排序日期键：未来升序 / 历史降序
    const keys = order.sort((a, b) => isHistory ? b.localeCompare(a) : a.localeCompare(b));
    const today = DateUtil.today();

    let html = '';
    keys.forEach(date => {
      let title;
      if (date === today) title = '今日 · ' + DateUtil.fmt(date);
      else title = DateUtil.fmt(date);

      html += `<div class="date-group">`;
      html += `<div class="date-group-title flex items-center gap-2">
        <span>${title}</span>
        ${isHistory ? '<span class="text-[10px] text-ash">· 已过期</span>' : ''}
      </div>`;
      groups[date].forEach(t => { html += this.renderItem(t); });
      html += `</div>`;
    });
    return html;
  },

  /* ---------- 单条任务卡片 ---------- */
  renderItem(t) {
    const done = !!t.completed;
    const fav = !!t.favorite;
    const safeText = this.escape(t.text || '');

    return `
      <div class="task-item mb-2" data-id="${t.id}">
        <div class="task-check ${done ? 'done' : ''}"
             onclick="Todo.toggle(${t.id})"
             role="checkbox" aria-checked="${done}" aria-label="切换完成状态"></div>
        <div class="flex-1 min-w-0">
          <div class="task-text ${done ? 'done' : ''} text-sm leading-snug break-words">${safeText}</div>
          <div class="text-[10px] text-ash mt-1">${DateUtil.fmt(t.date)}</div>
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <button onclick="Todo.toggleFav(${t.id})"
                  class="w-7 h-7 flex items-center justify-center rounded-full active:bg-fog text-base ${fav ? 'text-ink' : 'text-ash'}"
                  aria-label="收藏" aria-pressed="${fav}">${fav ? '♥' : '♡'}</button>
          <button onclick="Todo.openEdit(${t.id})"
                  class="w-7 h-7 flex items-center justify-center rounded-full active:bg-fog text-sm text-ash"
                  aria-label="编辑">✎</button>
          <button onclick="Todo.confirmDelete(${t.id})"
                  class="w-7 h-7 flex items-center justify-center rounded-full active:bg-fog text-sm text-ash"
                  aria-label="删除">✕</button>
        </div>
      </div>`;
  },

  /* ---------- HTML 转义 ---------- */
  escape(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  /* ---------- 切换完成 ---------- */
  async toggle(id) {
    const t = await Store.get('todos', id);
    if (!t) return;
    t.completed = !t.completed;
    t.updatedAt = new Date().toISOString();
    await Store.put('todos', t);
    this.render();
  },

  /* ---------- 切换收藏 ---------- */
  async toggleFav(id) {
    const t = await Store.get('todos', id);
    if (!t) return;
    t.favorite = !t.favorite;
    t.updatedAt = new Date().toISOString();
    await Store.put('todos', t);
    this.render();
  },

  /* ---------- 新增弹窗 ---------- */
  openAdd() {
    const today = DateUtil.today();
    const html = `
      <div class="space-y-3">
        <h3 class="text-base font-semibold text-ink">新建任务</h3>
        <div>
          <label class="text-xs text-ash block mb-1">任务内容</label>
          <input id="todo-add-text" type="text" placeholder="输入任务内容..."
                 maxlength="100" autocomplete="off" enterkeyhint="done"
                 onkeydown="if(event.key==='Enter'){Todo.saveAdd()}" />
        </div>
        <div>
          <label class="text-xs text-ash block mb-1">截止日期</label>
          <input id="todo-add-date" type="date" value="${today}" />
        </div>
        <div class="flex gap-2 pt-1">
          <button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>
          <button onclick="Todo.saveAdd()" class="btn-primary flex-1">确认添加</button>
        </div>
      </div>`;
    Modal.open(html);
    setTimeout(() => {
      const el = document.getElementById('todo-add-text');
      if (el) el.focus();
    }, 120);
  },

  /* ---------- 保存新增 ---------- */
  async saveAdd() {
    const textEl = document.getElementById('todo-add-text');
    const dateEl = document.getElementById('todo-add-date');
    if (!textEl) return;
    const text = textEl.value.trim();
    const date = (dateEl && dateEl.value) || DateUtil.today();
    if (!text) { Toast.show('请输入任务内容'); return; }
    const now = new Date().toISOString();
    await Store.add('todos', {
      text, date,
      completed: false,
      favorite: false,
      createdAt: now
    });
    Modal.closeForce();
    Toast.show('任务已创建');
    this.render();
  },

  /* ---------- 编辑弹窗 ---------- */
  async openEdit(id) {
    const t = await Store.get('todos', id);
    if (!t) { Toast.show('任务不存在'); return; }
    const html = `
      <div class="space-y-3">
        <h3 class="text-base font-semibold text-ink">编辑任务</h3>
        <div>
          <label class="text-xs text-ash block mb-1">任务内容</label>
          <input id="todo-edit-text" type="text" value="${this.escape(t.text)}"
                 maxlength="100" autocomplete="off" enterkeyhint="done"
                 onkeydown="if(event.key==='Enter'){Todo.saveEdit(${t.id})}" />
        </div>
        <div>
          <label class="text-xs text-ash block mb-1">截止日期</label>
          <input id="todo-edit-date" type="date" value="${t.date}" />
        </div>
        <div class="flex gap-2 pt-1">
          <button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>
          <button onclick="Todo.saveEdit(${t.id})" class="btn-primary flex-1">保存修改</button>
        </div>
      </div>`;
    Modal.open(html);
    setTimeout(() => {
      const el = document.getElementById('todo-edit-text');
      if (el) { el.focus(); el.select(); }
    }, 120);
  },

  /* ---------- 保存编辑 ---------- */
  async saveEdit(id) {
    const textEl = document.getElementById('todo-edit-text');
    const dateEl = document.getElementById('todo-edit-date');
    if (!textEl) return;
    const text = textEl.value.trim();
    const date = (dateEl && dateEl.value) || DateUtil.today();
    if (!text) { Toast.show('请输入任务内容'); return; }
    const t = await Store.get('todos', id);
    if (!t) { Toast.show('任务不存在'); return; }
    t.text = text;
    t.date = date;
    t.updatedAt = new Date().toISOString();
    await Store.put('todos', t);
    Modal.closeForce();
    Toast.show('已保存修改');
    this.render();
  },

  /* ---------- 删除确认弹窗 ---------- */
  confirmDelete(id) {
    const html = `
      <div class="text-center space-y-3">
        <h3 class="text-base font-semibold text-ink">删除任务</h3>
        <p class="text-xs text-ash leading-relaxed">确定要删除这个任务吗？<br/>删除后无法恢复。</p>
        <div class="flex gap-2 pt-1">
          <button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>
          <button onclick="Todo.doDelete(${id})" class="btn-primary flex-1">确认删除</button>
        </div>
      </div>`;
    Modal.open(html);
  },

  /* ---------- 执行删除 ---------- */
  async doDelete(id) {
    await Store.del('todos', id);
    Modal.closeForce();
    Toast.show('已删除');
    this.render();
  }
};
