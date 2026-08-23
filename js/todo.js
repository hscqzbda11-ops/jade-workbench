/* ===== 待办清单模块 · 极简版 ===== */
const Todo = {
  async render() {
    const list = document.getElementById('todo-list');
    if (!list) return;

    const todos = await Store.getAll('todos');
    const today = DateUtil.today();

    // 拆分：今日及未来 / 已过期
    const upcoming = todos.filter(t => (t.date || today) >= today);
    const overdue = todos.filter(t => (t.date || today) < today);

    // 排序
    upcoming.sort((a, b) => {
      const da = a.date || today, db = b.date || today;
      if (da !== db) return da.localeCompare(db);
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    overdue.sort((a, b) => {
      const da = a.date || today, db = b.date || today;
      if (da !== db) return db.localeCompare(da);
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    if (todos.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;padding:80px 20px;color:#ddd;font-size:13px">
          <div style="font-size:40px;margin-bottom:12px">✓</div>
          <div>还没有任务</div>
          <div style="font-size:11px;margin-top:4px">点击右上角 + 创建</div>
        </div>`;
      return;
    }

    let html = '';
    if (upcoming.length) html += this.renderGroups(upcoming, false);
    if (overdue.length) {
      html += '<div class="overdue-mark">— 已过期 —</div>';
      html += '<div class="overdue">';
      html += this.renderGroups(overdue, true);
      html += '</div>';
    }

    list.innerHTML = html;
  },

  renderGroups(todos, isOverdue) {
    const groups = {};
    const order = [];
    todos.forEach(t => {
      const d = t.date;
      if (!groups[d]) { groups[d] = []; order.push(d); }
      groups[d].push(t);
    });
    const keys = order.sort((a, b) => isOverdue ? b.localeCompare(a) : a.localeCompare(b));
    const today = DateUtil.today();

    let html = '';
    let isFirst = true;
    keys.forEach(date => {
      let title;
      if (date === today) title = '今日 · ' + DateUtil.fmt(date);
      else title = DateUtil.fmt(date);

      const cls = isFirst ? 'date-head first' : 'date-head';
      isFirst = false;

      html += `<div class="date-section">`;
      html += `<div class="${cls}">${title}</div>`;
      groups[date].forEach(t => { html += this.renderItem(t); });
      html += `</div>`;
    });
    return html;
  },

  renderItem(t) {
    const done = !!t.completed;
    const safeText = this.escape(t.text || '');

    return `
      <div class="task">
        <div class="task-check ${done ? 'done' : ''}"
             onclick="Todo.toggle(${t.id})"></div>
        <div class="task-body">
          <div class="task-text ${done ? 'done' : ''}">${safeText}</div>
          ${t.note ? `<div style="font-size:11px;color:#ccc;margin-top:4px">${this.escape(t.note)}</div>` : ''}
        </div>
        <span onclick="Todo.openEdit(${t.id})" style="font-size:12px;color:#ddd;flex-shrink:0">⋯</span>
      </div>`;
  },

  escape(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  async toggle(id) {
    const todos = await Store.getAll('todos');
    const t = todos.find(x => x.id === id);
    if (!t) return;
    t.completed = !t.completed;
    t.updatedAt = new Date().toISOString();
    await Store.put('todos', t);
    this.render();
    if (Nav.current === 'home') Home.render();
  },

  openAdd() {
    const today = DateUtil.today();
    const html = `
      <div class="modal-title">新建任务</div>
      <div class="form-row">
        <label class="form-label">任务内容</label>
        <input id="todo-add-text" type="text" placeholder="输入任务内容..." />
      </div>
      <div class="form-row">
        <label class="form-label">日期</label>
        <input id="todo-add-date" type="date" value="${today}" />
      </div>
      <div class="form-row">
        <label class="form-label">备注（可选）</label>
        <input id="todo-add-note" type="text" placeholder="备注信息..." />
      </div>
      <div class="form-actions">
        <button class="btn-cancel" onclick="Modal.closeForce()">取消</button>
        <button class="btn-ok" onclick="Todo.doAdd()">保存</button>
      </div>
    `;
    Modal.open(html);
    setTimeout(() => {
      const el = document.getElementById('todo-add-text');
      if (el) el.focus();
    }, 100);
  },

  async doAdd() {
    const textEl = document.getElementById('todo-add-text');
    const dateEl = document.getElementById('todo-add-date');
    const noteEl = document.getElementById('todo-add-note');
    const text = (textEl && textEl.value.trim()) || '';
    if (!text) { Toast.show('请输入任务内容'); return; }
    const date = (dateEl && dateEl.value) || DateUtil.today();
    const note = (noteEl && noteEl.value.trim()) || '';
    const now = new Date().toISOString();
    await Store.add('todos', { text, date, note, completed: false, createdAt: now, updatedAt: now });
    Modal.closeForce();
    Toast.show('已添加');
    this.render();
    if (Nav.current === 'home') Home.render();
  },

  async openEdit(id) {
    const todos = await Store.getAll('todos');
    const t = todos.find(x => x.id === id);
    if (!t) return;
    const html = `
      <div class="modal-title">编辑任务</div>
      <div class="form-row">
        <label class="form-label">任务内容</label>
        <input id="todo-edit-text" type="text" value="${this.escape(t.text)}" />
      </div>
      <div class="form-row">
        <label class="form-label">日期</label>
        <input id="todo-edit-date" type="date" value="${t.date || DateUtil.today()}" />
      </div>
      <div class="form-row">
        <label class="form-label">备注</label>
        <input id="todo-edit-note" type="text" value="${this.escape(t.note || '')}" />
      </div>
      <div class="form-actions">
        <button class="btn-cancel" style="color:#c00" onclick="Todo.doDelete(${t.id})">删除</button>
        <button class="btn-ok" onclick="Todo.doEdit(${t.id})">保存</button>
      </div>
    `;
    Modal.open(html);
  },

  async doEdit(id) {
    const todos = await Store.getAll('todos');
    const t = todos.find(x => x.id === id);
    if (!t) return;
    const textEl = document.getElementById('todo-edit-text');
    const dateEl = document.getElementById('todo-edit-date');
    const noteEl = document.getElementById('todo-edit-note');
    t.text = (textEl && textEl.value.trim()) || t.text;
    t.date = (dateEl && dateEl.value) || t.date;
    t.note = (noteEl && noteEl.value.trim()) || '';
    t.updatedAt = new Date().toISOString();
    await Store.put('todos', t);
    Modal.closeForce();
    Toast.show('已保存');
    this.render();
    if (Nav.current === 'home') Home.render();
  },

  async doDelete(id) {
    if (!confirm('确定删除这个任务吗？')) return;
    await Store.del('todos', id);
    Modal.closeForce();
    Toast.show('已删除');
    this.render();
    if (Nav.current === 'home') Home.render();
  }
};
