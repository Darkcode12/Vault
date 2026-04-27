'use strict';

// ===== STATE =====
let sections = [];
let currentSectionId = null;
let editingSectionId = null;
let editingItemId = null;
let pendingImg = null;
let imgTab = 'url';

// ===== INDEXEDDB =====
let db;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('vault_db', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('sections')) d.createObjectStore('sections', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
    };
    req.onsuccess = e => { db = e.target.result; res(); };
    req.onerror = () => rej(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function dbPut(store, obj) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
function dbDelete(store, id) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
function dbDeleteWhere(store, field, value) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    const req = s.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { if (cursor.value[field] === value) cursor.delete(); cursor.continue(); }
    };
    tx.oncomplete = res; tx.onerror = rej;
  });
}

async function loadAll() {
  sections = await dbGetAll('sections');
  sections.sort((a, b) => a.order - b.order);
}

// ===== HELPERS =====
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const shortUrl = url => { try { return new URL(url).hostname.replace('www.',''); } catch { return url; }};
const show = id => document.getElementById(id).classList.add('open');
const hide = id => document.getElementById(id).classList.remove('open');

// ===== VIEWS =====
function goHome() {
  document.getElementById('viewSection').classList.remove('active');
  document.getElementById('viewHome').classList.add('active');
  currentSectionId = null;
  renderSections();
}

async function goSection(id) {
  currentSectionId = id;
  const sec = sections.find(s => s.id === id);
  document.getElementById('sectionTitle').textContent = sec?.name || '';
  document.getElementById('viewHome').classList.remove('active');
  document.getElementById('viewSection').classList.add('active');
  await renderItems();
}

// ===== SECTIONS =====
function renderSections() {
  const list = document.getElementById('sectionsList');
  const empty = document.getElementById('emptySections');
  if (!sections.length) { list.innerHTML = ''; empty.classList.add('show'); return; }
  empty.classList.remove('show');
  list.innerHTML = sections.map((s, i) => `
    <div class="section-card" data-id="${s.id}" style="animation-delay:${Math.min(i*.04,.3)}s">
      <div class="section-card-left">
        <span class="section-name">${esc(s.name)}</span>
        <span class="section-count" id="sc-${s.id}">...</span>
      </div>
      <span class="section-arrow">›</span>
    </div>
  `).join('');
  list.querySelectorAll('.section-card').forEach(el => {
    el.addEventListener('click', () => goSection(Number(el.dataset.id)));
  });
  // Load counts async
  sections.forEach(async s => {
    const items = await dbGetAll('items');
    const count = items.filter(i => i.sectionId === s.id).length;
    const el = document.getElementById(`sc-${s.id}`);
    if (el) el.textContent = `${count} ${count === 1 ? 'link' : 'links'}`;
  });
}

async function renderItems() {
  const all = await dbGetAll('items');
  const items = all.filter(i => i.sectionId === currentSectionId).sort((a,b) => b.id - a.id);
  const list = document.getElementById('itemsList');
  const empty = document.getElementById('emptyItems');
  if (!items.length) { list.innerHTML = ''; empty.classList.add('show'); return; }
  empty.classList.remove('show');
  list.innerHTML = items.map((item, i) => `
    <div class="item-card" data-id="${item.id}" data-url="${esc(item.url)}" style="animation-delay:${Math.min(i*.04,.3)}s">
      <div class="item-thumb">
        ${item.img
          ? `<img src="${esc(item.img)}" loading="lazy" onerror="this.style.display='none'">`
          : `<span class="item-thumb-placeholder">🔗</span>`}
      </div>
      <div class="item-info">
        <div class="item-title">${esc(item.title)}</div>
        <div class="item-url">${esc(shortUrl(item.url))}</div>
      </div>
      <div class="item-actions">
        <button class="item-edit-btn" data-edit="${item.id}">✎</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.item-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.item-edit-btn')) return;
      const url = el.dataset.url;
      if (url) window.open(url, '_blank');
    });
  });
  list.querySelectorAll('.item-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditItem(Number(btn.dataset.edit)); });
  });
}

// ===== SECTION SHEET =====
document.getElementById('btnAddSection').addEventListener('click', () => {
  editingSectionId = null;
  document.getElementById('sheetSectionTitle').textContent = 'Nueva sección';
  document.getElementById('inp-section-name').value = '';
  document.getElementById('deleteSectionWrap').style.display = 'none';
  show('sheetSection');
  setTimeout(() => document.getElementById('inp-section-name').focus(), 300);
});

document.getElementById('btnEditSection').addEventListener('click', () => {
  const sec = sections.find(s => s.id === currentSectionId);
  if (!sec) return;
  editingSectionId = currentSectionId;
  document.getElementById('sheetSectionTitle').textContent = 'Editar sección';
  document.getElementById('inp-section-name').value = sec.name;
  document.getElementById('deleteSectionWrap').style.display = 'block';
  show('sheetSection');
  setTimeout(() => document.getElementById('inp-section-name').focus(), 300);
});

document.getElementById('btnSaveSection').addEventListener('click', async () => {
  const name = document.getElementById('inp-section-name').value.trim();
  if (!name) return;
  if (editingSectionId) {
    const sec = sections.find(s => s.id === editingSectionId);
    if (sec) { sec.name = name; await dbPut('sections', sec); }
    document.getElementById('sectionTitle').textContent = name;
  } else {
    const sec = { id: Date.now(), name, order: sections.length };
    sections.push(sec);
    await dbPut('sections', sec);
  }
  hide('sheetSection');
  renderSections();
});

document.getElementById('inp-section-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnSaveSection').click();
});

document.getElementById('btnDeleteSection').addEventListener('click', async () => {
  if (!editingSectionId) return;
  await dbDelete('sections', editingSectionId);
  await dbDeleteWhere('items', 'sectionId', editingSectionId);
  sections = sections.filter(s => s.id !== editingSectionId);
  hide('sheetSection');
  goHome();
});

// ===== ITEM SHEET =====
function resetItemForm() {
  document.getElementById('inp-item-title').value = '';
  document.getElementById('inp-item-url').value = '';
  document.getElementById('inp-item-img').value = '';
  document.getElementById('item-file-label').textContent = 'Toca para elegir imagen';
  document.getElementById('item-img-preview-wrap').style.display = 'none';
  document.getElementById('item-img-preview').src = '';
  pendingImg = null;
  setImgTab('url', document.querySelector('.itab[data-tab="url"]'));
}

function setImgTab(tab, el) {
  imgTab = tab;
  document.querySelectorAll('.itab').forEach(b => b.classList.remove('active'));
  el?.classList.add('active');
  document.getElementById('itab-url').style.display  = tab === 'url'  ? '' : 'none';
  document.getElementById('itab-file').style.display = tab === 'file' ? '' : 'none';
}
document.querySelectorAll('.itab').forEach(btn => {
  btn.addEventListener('click', () => setImgTab(btn.dataset.tab, btn));
});

document.getElementById('inp-item-img').addEventListener('input', e => {
  const url = e.target.value.trim();
  if (url) { document.getElementById('item-img-preview').src = url; document.getElementById('item-img-preview-wrap').style.display = 'flex'; pendingImg = url; }
  else { document.getElementById('item-img-preview-wrap').style.display = 'none'; pendingImg = null; }
});

document.getElementById('inp-item-img-file').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    pendingImg = ev.target.result;
    document.getElementById('item-img-preview').src = pendingImg;
    document.getElementById('item-img-preview-wrap').style.display = 'flex';
    document.getElementById('item-file-label').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

document.getElementById('btnClearItemImg').addEventListener('click', () => {
  pendingImg = null;
  document.getElementById('inp-item-img').value = '';
  document.getElementById('item-file-label').textContent = 'Toca para elegir imagen';
  document.getElementById('item-img-preview-wrap').style.display = 'none';
});

document.getElementById('btnAddItem').addEventListener('click', () => {
  editingItemId = null;
  document.getElementById('sheetItemTitle').textContent = 'Nuevo link';
  resetItemForm();
  show('sheetItem');
  setTimeout(() => document.getElementById('inp-item-title').focus(), 300);
});

async function openEditItem(id) {
  const all = await dbGetAll('items');
  const item = all.find(i => i.id === id);
  if (!item) return;
  editingItemId = id;
  document.getElementById('sheetItemTitle').textContent = 'Editar link';
  document.getElementById('inp-item-title').value = item.title;
  document.getElementById('inp-item-url').value = item.url;
  pendingImg = item.img || null;
  if (item.img) {
    document.getElementById('item-img-preview').src = item.img;
    document.getElementById('item-img-preview-wrap').style.display = 'flex';
    if (!item.img.startsWith('data:')) {
      document.getElementById('inp-item-img').value = item.img;
      setImgTab('url', document.querySelector('.itab[data-tab="url"]'));
    } else {
      setImgTab('file', document.querySelector('.itab[data-tab="file"]'));
      document.getElementById('item-file-label').textContent = 'Imagen guardada';
    }
  } else {
    setImgTab('url', document.querySelector('.itab[data-tab="url"]'));
    document.getElementById('item-img-preview-wrap').style.display = 'none';
  }
  show('sheetItem');
}

document.getElementById('btnSaveItem').addEventListener('click', async () => {
  const title = document.getElementById('inp-item-title').value.trim();
  const url   = document.getElementById('inp-item-url').value.trim();
  if (!title || !url) {
    if (!title) document.getElementById('inp-item-title').focus();
    else document.getElementById('inp-item-url').focus();
    return;
  }
  if (editingItemId) {
    const all = await dbGetAll('items');
    const item = all.find(i => i.id === editingItemId);
    if (item) { item.title = title; item.url = url; item.img = pendingImg || null; await dbPut('items', item); }
  } else {
    await dbPut('items', { id: Date.now(), sectionId: currentSectionId, title, url, img: pendingImg || null });
  }
  hide('sheetItem');
  await renderItems();
});

// Delete from edit
document.getElementById('sheetItem').addEventListener('click', async e => {
  if (!e.target.classList.contains('btn-danger-item')) return;
  if (!editingItemId) return;
  await dbDelete('items', editingItemId);
  hide('sheetItem');
  await renderItems();
});

// ===== NAVIGATION =====
document.getElementById('btnBack').addEventListener('click', goHome);

// Close overlays on backdrop tap
['sheetSection','sheetItem','sheetSettings'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target.id === id) hide(id);
  });
});

// ===== SETTINGS =====
const PRESETS = ['#4af','#ff4757','#ff6b35','#ffd32a','#2ed573','#a55eea','#ff6eb4','#00d2d3','#ff9f43','#e8ff47','#fff','#aaa'];
let accent = localStorage.getItem('vault_accent') || '#4af';

function applyAccent(c) {
  document.documentElement.style.setProperty('--accent', c);
  accent = c;
}

function buildColorGrid() {
  const grid = document.getElementById('colorGrid');
  grid.innerHTML = PRESETS.map(c => `<div class="color-swatch${c===accent?' selected':''}" style="background:${c}" data-c="${c}"></div>`).join('');
  grid.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      document.getElementById('inp-accent-color').value = sw.dataset.c;
      applyAccent(sw.dataset.c);
    });
  });
}

document.getElementById('btnOpenSettings').addEventListener('click', () => {
  document.getElementById('inp-app-name').value = localStorage.getItem('vault_name') || '';
  document.getElementById('inp-accent-color').value = accent;
  buildColorGrid();
  show('sheetSettings');
});

document.getElementById('inp-accent-color').addEventListener('input', e => {
  applyAccent(e.target.value);
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
});

document.getElementById('btnSaveSettings').addEventListener('click', () => {
  const name = document.getElementById('inp-app-name').value.trim() || 'Vault';
  localStorage.setItem('vault_name', name);
  localStorage.setItem('vault_accent', accent);
  document.querySelectorAll('.topbar-title').forEach(el => { if (el.id !== 'sectionTitle') el.textContent = name.toUpperCase(); });
  document.querySelector('.splash-mark').textContent = name[0].toUpperCase();
  document.title = name;
  hide('sheetSettings');
});

// ===== BACKUP =====
function hint(msg, type='ok') {
  const el = document.getElementById('backupHint');
  el.textContent = msg; el.className = `backup-hint ${type}`;
  setTimeout(() => { el.textContent = ''; el.className = 'backup-hint'; }, 3000);
}

document.getElementById('btnExport').addEventListener('click', async () => {
  const allSections = await dbGetAll('sections');
  const allItems    = await dbGetAll('items');
  if (!allSections.length) { hint('No hay nada que exportar', 'err'); return; }
  const blob = new Blob([JSON.stringify({ v:1, exportedAt: new Date().toISOString(), accent, name: localStorage.getItem('vault_name')||'', sections: allSections, items: allItems }, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vault-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  hint(`✓ ${allSections.length} secciones, ${allItems.length} links exportados`);
});

document.getElementById('btnImport').addEventListener('click', () => {
  document.getElementById('inp-backup').value = '';
  document.getElementById('inp-backup').click();
});

document.getElementById('inp-backup').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.sections || !data.items) throw new Error();
      const existSec = new Set((await dbGetAll('sections')).map(s => s.id));
      const existItm = new Set((await dbGetAll('items')).map(i => i.id));
      let ns=0, ni=0;
      for (const s of data.sections) { if (!existSec.has(s.id)) { await dbPut('sections', s); ns++; } }
      for (const i of data.items)    { if (!existItm.has(i.id)) { await dbPut('items', i); ni++; } }
      if (data.accent) { applyAccent(data.accent); localStorage.setItem('vault_accent', data.accent); }
      if (data.name)   { localStorage.setItem('vault_name', data.name); document.title = data.name; }
      await loadAll(); renderSections();
      hint(`✓ ${ns} secciones, ${ni} links importados`);
    } catch { hint('Archivo no válido', 'err'); }
  };
  reader.readAsText(file);
});

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

// ===== INIT =====
window.addEventListener('load', async () => {
  await openDB();
  await loadAll();
  applyAccent(accent);
  const name = localStorage.getItem('vault_name');
  if (name) {
    document.querySelectorAll('.topbar-title').forEach(el => { if (el.id !== 'sectionTitle') el.textContent = name.toUpperCase(); });
    document.querySelector('.splash-mark').textContent = name[0].toUpperCase();
    document.title = name;
  }
  renderSections();
  setTimeout(() => document.getElementById('splash').classList.add('out'), 700);
});
