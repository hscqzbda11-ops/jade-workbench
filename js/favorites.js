/* ===== Jade 工作台 收藏模块 ===== */

const Favorites = {
  // 当前选中的分区
  currentTab: 'world',

  // 当前渲染的收藏列表（供 onclick 索引查找）
  _items: [],

  // 分区标签映射
  TAB_LABELS: {
    world: '我与世界',
    edu: '专升本',
    finance: '理财/存钱',
    todo: '待办任务',
  },

  // 空状态文案
  EMPTY_TEXTS: {
    world: '暂无世界资讯收藏',
    edu: '暂无专升本收藏',
    finance: '暂无理财收藏',
    todo: '暂无任务收藏',
  },

  // ===== 渲染收藏列表 =====
  async render() {
    await this.renderList();
  },

  // ===== 切换分区 =====
  setTab(type) {
    this.currentTab = type;
    // 更新标签 active 状态
    document.querySelectorAll('.fav-tab').forEach(btn => {
      btn.classList.remove('active');
      const onclickAttr = btn.getAttribute('onclick') || '';
      if (onclickAttr.includes(`'${type}'`)) {
        btn.classList.add('active');
      }
    });
    this.renderList();
  },

  // ===== 渲染列表内容 =====
  async renderList() {
    const container = document.getElementById('fav-list');
    const countLabel = document.getElementById('fav-count-label');
    if (!container) return;

    let allFavs = [];
    try {
      allFavs = await Store.getAll('favorites');
    } catch (e) {
      console.error('读取收藏失败', e);
      container.innerHTML = '<div class="text-center text-xs text-ash py-8">读取收藏失败</div>';
      return;
    }

    // 按当前分区过滤
    const filtered = allFavs.filter(f => f.type === this.currentTab);

    // 按收藏时间倒序
    filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    this._items = filtered;

    // 更新数量标签
    if (countLabel) {
      const label = this.TAB_LABELS[this.currentTab] || '';
      countLabel.textContent = `${label} · 共 ${filtered.length} 条收藏`;
    }

    // 空状态
    if (filtered.length === 0) {
      const emptyText = this.EMPTY_TEXTS[this.currentTab] || '暂无收藏';
      container.innerHTML =
        '<div class="text-center text-ash py-12">'
        + '<div class="text-4xl mb-3" style="opacity:0.3;">☆</div>'
        + '<div class="text-xs">' + emptyText + '</div>'
        + '</div>';
      return;
    }

    // 渲染卡片
    container.innerHTML = filtered.map((fav, idx) => this.renderCard(fav, idx)).join('');
  },

  // ===== 渲染单条收藏卡片 =====
  renderCard(fav, idx) {
    const noteHtml = fav.note
      ? `<div class="mt-1.5 px-2 py-1.5 bg-fog rounded-lg text-[11px] text-gray-600 leading-relaxed">批注：${_esc(fav.note)}</div>`
      : '';
    const time = fav.createdAt ? DateUtil.fmtFull(fav.createdAt) : '';
    const sourceLabel = this.getSourceLabel(fav);

    return `
      <div class="fav-card">
        <div class="text-sm font-semibold leading-snug">${_esc(fav.title || '无标题')}</div>
        <div class="news-desc mt-1">${_esc(fav.content || '无内容')}</div>
        ${noteHtml}
        <div class="news-meta">
          ${sourceLabel ? `<span>${_esc(sourceLabel)}</span><span>·</span>` : ''}
          <span>${time}</span>
        </div>
        <div class="flex gap-3 mt-2 text-[10px] text-ash">
          <button onclick="Favorites.openNoteModal(${idx})" class="hover:text-ink">编辑批注</button>
          <button onclick="Favorites.copyContent(${idx})" class="hover:text-ink">复制</button>
          <button onclick="Favorites.confirmDelete(${idx})" class="hover:text-ink">删除</button>
          <button onclick="Favorites.confirmUnfavorite(${idx})" class="hover:text-ink">取消收藏</button>
        </div>
      </div>
    `;
  },

  // ===== 获取来源标签 =====
  getSourceLabel(fav) {
    if (!fav.sourceData) return '';
    try {
      const data = JSON.parse(fav.sourceData);
      return data.source || data.category || '';
    } catch (e) {
      return '';
    }
  },

  // ===== 打开批注编辑弹窗 =====
  openNoteModal(idx) {
    const fav = this._items[idx];
    if (!fav) return;

    const html = `
      <div class="space-y-3">
        <h3 class="text-base font-bold">编辑批注</h3>
        <p class="text-xs text-ash" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${_esc(fav.title || '')}</p>
        <textarea id="fav-note-input" rows="4" placeholder="写点什么..." style="min-height:80px;">${_esc(fav.note || '')}</textarea>
        <div class="flex gap-2">
          <button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>
          <button onclick="Favorites.saveNote(${idx})" class="btn-primary flex-1">保存</button>
        </div>
      </div>
    `;
    Modal.open(html);
  },

  // ===== 保存批注 =====
  async saveNote(idx) {
    const fav = this._items[idx];
    if (!fav) return;

    const input = document.getElementById('fav-note-input');
    const note = input ? input.value.trim() : '';

    try {
      fav.note = note;
      await Store.put('favorites', fav);
      Modal.closeForce();
      Toast.show('批注已保存');
      this.renderList();
    } catch (e) {
      console.error('保存批注失败', e);
      Toast.show('保存失败，请重试');
    }
  },

  // ===== 确认删除 =====
  confirmDelete(idx) {
    const fav = this._items[idx];
    if (!fav) return;

    const html = `
      <div class="space-y-3">
        <h3 class="text-base font-bold">确认删除</h3>
        <p class="text-xs text-ash">确定要删除收藏「<span class="font-medium text-ink">${_esc(fav.title || '')}</span>」吗？此操作不可撤销。</p>
        <div class="flex gap-2">
          <button onclick="Modal.closeForce()" class="btn-secondary flex-1">取消</button>
          <button onclick="Favorites.doDelete(${idx})" class="btn-primary flex-1">确认删除</button>
        </div>
      </div>
    `;
    Modal.open(html);
  },

  // ===== 执行删除 =====
  async doDelete(idx) {
    const fav = this._items[idx];
    if (!fav) return;
    try {
      await Store.del('favorites', fav.id);
      Modal.closeForce();
      Toast.show('已删除');
      this.renderList();
    } catch (e) {
      console.error('删除失败', e);
      Toast.show('删除失败，请重试');
    }
  },

  // ===== 确认取消收藏 =====
  confirmUnfavorite(idx) {
    const fav = this._items[idx];
    if (!fav) return;

    const html = `
      <div class="space-y-3">
        <h3 class="text-base font-bold">取消收藏</h3>
        <p class="text-xs text-ash">确定要取消收藏「<span class="font-medium text-ink">${_esc(fav.title || '')}</span>」吗？</p>
        <div class="flex gap-2">
          <button onclick="Modal.closeForce()" class="btn-secondary flex-1">保留</button>
          <button onclick="Favorites.doUnfavorite(${idx})" class="btn-primary flex-1">确认取消</button>
        </div>
      </div>
    `;
    Modal.open(html);
  },

  // ===== 执行取消收藏 =====
  async doUnfavorite(idx) {
    const fav = this._items[idx];
    if (!fav) return;
    try {
      await Store.del('favorites', fav.id);
      Modal.closeForce();
      Toast.show('已取消收藏');
      this.renderList();
    } catch (e) {
      console.error('取消收藏失败', e);
      Toast.show('操作失败，请重试');
    }
  },

  // ===== 复制内容 =====
  async copyContent(idx) {
    const fav = this._items[idx];
    if (!fav) return;

    let text = fav.title || '';
    if (fav.content) text += '\n\n' + fav.content;
    if (fav.note) text += '\n\n批注：' + fav.note;

    const ok = await _copyText(text);
    Toast.show(ok ? '已复制到剪贴板' : '复制失败');
  },
};
