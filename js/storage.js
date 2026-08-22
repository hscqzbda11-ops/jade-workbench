/* ===== Jade 数据存储层 ===== */
const Store = (() => {
  const DB_NAME = 'jade_workbench';
  const DB_VER = 1;
  const STORES = ['todos', 'finance_records', 'assets', 'savings_plans', 'favorites', 'world_cache', 'edu_cache'];
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        STORES.forEach(s => {
          if (!d.objectStoreNames.contains(s)) {
            const store = d.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
            if (s === 'todos') store.createIndex('date', 'date', { unique: false });
            if (s === 'finance_records') store.createIndex('date', 'date', { unique: false });
            if (s === 'assets') store.createIndex('type', 'type', { unique: false });
            if (s === 'favorites') store.createIndex('type', 'type', { unique: false });
          }
        });
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function get(storeName, id) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function add(storeName, data) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName, 'readwrite').add(data);
      req.onsuccess = () => { snapshot(); resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  }

  function put(storeName, data) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName, 'readwrite').put(data);
      req.onsuccess = () => { snapshot(); resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  }

  function del(storeName, id) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName, 'readwrite').delete(id);
      req.onsuccess = () => { snapshot(); resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  function clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // localStorage 快照兜底
  async function snapshot() {
    try {
      const todos = await getAll('todos');
      const records = await getAll('finance_records');
      const plans = await getAll('savings_plans');
      const faves = await getAll('favorites');
      localStorage.setItem('jade_snap_todos', JSON.stringify(todos));
      localStorage.setItem('jade_snap_finance', JSON.stringify(records));
      localStorage.setItem('jade_snap_plans', JSON.stringify(plans));
      localStorage.setItem('jade_snap_favs', JSON.stringify(faves));
    } catch (e) { console.warn('快照失败', e); }
  }

  async function exportAll() {
    const data = {};
    for (const s of STORES) {
      data[s] = await getAll(s);
    }
    data._exportTime = new Date().toISOString();
    return data;
  }

  async function importData(data) {
    for (const s of STORES) {
      if (data[s]) {
        await clearStore(s);
        for (const item of data[s]) {
          delete item.id;
          await add(s, item);
        }
      }
    }
  }

  // 清空所有数据
  async function clearAll() {
    for (const s of STORES) {
      await clearStore(s);
    }
    // 同时清空 localStorage 备份
    try {
      localStorage.removeItem('jade_backup');
    } catch (e) {}
  }

  async function requestPersistent() {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      console.log('持久存储:', granted ? '已授权' : '未授权');
      return granted;
    }
    return false;
  }

  return { open, getAll, get, add, put, del, clearStore, exportAll, importData, clearAll, requestPersistent, snapshot };
})();
