'use strict';

// ===== STATE =====
let db;
// Navigation stack: array of { id, name } — id=null means root
let navStack = [];
let currentFolderId = null; // null = root
let editingFolderId = null;
let editingLinkId = null;
let pendingImg = null;
let currentView = localStorage.getItem('vault_view') || 'list';
let accent = localStorage.getItem('vault_accent') || '#4af';

// ===== DB =====
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('vault2_db', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      // folders: { id, parentId, name, order }
      if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
      // links: { id, folderId, title, url, img, order }
      if (!d.objectStoreNames.contains('links')) d.createObjectStore('links', { keyPath: 'id' });
    };
    req.onsuccess = e => { db = e.target.result; res(); };
    req.onerror = () => rej(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store,'readonly').objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function dbPut(store, obj) {
  return new Promise((res, rej) => {
    const req = db.transaction(store,'readwrite').objectStore(store).put(obj);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
function dbDelete(store, id) {
  return new Promise((res, rej) => {
    const req = db.transaction(store,'readwrite').objectStore(store).delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

// Delete folder and all descendants recursively
async function deleteFolderDeep(folderId) {
  const allFolders = await dbGetAll('folders');
  const allLinks   = await dbGetAll('links');
  // collect all folder ids to delete
  const toDelete = [];
  const collect = (pid) => {
    toDelete.push(pid);
    allFolders.filter(f => f.parentId === pid).forEach(f => collect(f.id));
  };
  collect(folderId);
  for (const fid of toDelete) {
    await dbDelete('folders', fid);
    for (const lnk of allLinks.filter(l => l.folderId === fid)) await dbDelete('links', lnk.id);
  }
}

// ===== HELPERS =====
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const shortUrl = url => { try { return new URL(url).hostname.replace('www.',''); } catch { return url; } };
const fixUrl = url => { url = url.trim(); if (!url) return ''; if (!/^https?:\/\//i.test(url)) url = 'https://' + url; return url; };
const showSheet = id => document.getElementById(id).classList.add('open');
const hideSheet = id => document.getElementById(id).classList.remove('open');

// ===== NAVIGATION =====
function updateTopbar() {
  const backBtn = document.getElementById('btnBack');
  const breadcrumb = document.getElementById('breadcrumb');
  if (navStack.length === 0) {
    backBtn.style.display = 'none';
    const name = localStorage.getItem('vault_name') || 'Vault';
    breadcrumb.textContent = name.toUpperCase();
  } else {
    backBtn.style.display = 'flex';
    breadcrumb.textContent = navStack.map(n => n.name).join(' › ');
  }
}

document.getElementById('btnBack').addEventListener('click', () => {
  if (navStack.length === 0) return;
  navStack.pop();
  currentFolderId = navStack.length > 0 ? navStack[navStack.length-1].id : null;
  updateTopbar();
  render();
});

async function openFolder(id, name) {
  navStack.push({ id, name });
  currentFolderId = id;
  updateTopbar();
  await render();
}

// ===== RENDER =====
async function render() {
  const allFolders = await dbGetAll('folders');
  const allLinks   = await dbGetAll('links');

  const folders = allFolders.filter(f => f.parentId === currentFolderId).sort((a,b) => a.order - b.order);
  const links   = allLinks.filter(l => l.folderId === currentFolderId).sort((a,b) => a.order - b.order);

  const area  = document.getElementById('contentArea');
  const empty = document.getElementById('emptyState');

  if (!folders.length && !links.length) {
    area.innerHTML = '';
    area.className = '';
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');
  area.className = currentView === 'grid' ? 'grid-mode' : '';

  // Count children for each folder
  const childCount = {};
  for (const f of folders) {
    const subFolders = allFolders.filter(x => x.parentId === f.id).length;
    const subLinks   = allLinks.filter(x => x.folderId === f.id).length;
    childCount[f.id] = subFolders + subLinks;
  }

  const foldersHtml = folders.map((f, i) => `
    <div class="folder-card" data-folder-id="${f.id}" data-folder-name="${esc(f.name)}" style="animation-delay:${Math.min(i*.04,.25)}s">
      <span class="folder-icon">▤</span>
      <div class="folder-info">
        <div class="folder-name">${esc(f.name)}</div>
        <div class="folder-meta">${childCount[f.id]} elemento${childCount[f.id]!==1?'s':''}</div>
      </div>
      <button class="folder-edit" data-edit-folder="${f.id}">✎</button>
      <span class="folder-arrow">›</span>
    </div>
  `).join('');

  const linksHtml = links.map((l, i) => `
    <div class="link-card" data-link-id="${l.id}" data-url="${esc(l.url)}" style="animation-delay:${Math.min((folders.length+i)*.04,.25)}s">
      <div class="link-thumb">
        ${l.img ? `<img src="${esc(l.img)}" loading="lazy" onerror="this.style.display='none'">` : '🔗'}
      </div>
      <div class="link-info">
        <div class="link-title">${esc(l.title)}</div>
        <div class="link-url">${esc(shortUrl(l.url))}</div>
      </div>
      <button class="link-edit" data-edit-link="${l.id}">✎</button>
    </div>
  `).join('');

  area.innerHTML = foldersHtml + linksHtml;

  // Folder click → navigate
  area.querySelectorAll('.folder-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.folder-edit')) return;
      openFolder(Number(el.dataset.folderId), el.dataset.folderName);
    });
  });

  // Folder edit
  area.querySelectorAll('.folder-edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditFolder(Number(btn.dataset.editFolder)); });
  });

  // Link click → open URL
  area.querySelectorAll('.link-card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.link-edit')) return;
      const url = fixUrl(el.dataset.url);
      if (url) window.open(url, '_blank');
    });
  });

  // Link edit
  area.querySelectorAll('.link-edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditLink(Number(btn.dataset.editLink)); });
  });
}

// ===== VIEW TOGGLE =====
document.getElementById('btnToggleView').addEventListener('click', async () => {
  currentView = currentView === 'list' ? 'grid' : 'list';
  localStorage.setItem('vault_view', currentView);
  document.getElementById('btnToggleView').textContent = currentView === 'list' ? '▦' : '≡';
  await render();
});

// ===== ADD BUTTON =====
document.getElementById('btnAdd').addEventListener('click', () => showSheet('sheetChoice'));
document.getElementById('choiceFolder').addEventListener('click', () => { hideSheet('sheetChoice'); openAddFolder(); });
document.getElementById('choiceLink').addEventListener('click', () => { hideSheet('sheetChoice'); openAddLink(); });

// ===== FOLDER SHEET =====
function openAddFolder() {
  editingFolderId = null;
  document.getElementById('folderSheetTitle').textContent = 'Nueva carpeta';
  document.getElementById('inp-folder-name').value = '';
  document.getElementById('folderDeleteWrap').style.display = 'none';
  showSheet('sheetFolder');
  setTimeout(() => document.getElementById('inp-folder-name').focus(), 300);
}

function openEditFolder(id) {
  editingFolderId = id;
  document.getElementById('folderSheetTitle').textContent = 'Editar carpeta';
  dbGetAll('folders').then(all => {
    const f = all.find(x => x.id === id);
    if (f) document.getElementById('inp-folder-name').value = f.name;
  });
  document.getElementById('folderDeleteWrap').style.display = 'block';
  showSheet('sheetFolder');
  setTimeout(() => document.getElementById('inp-folder-name').focus(), 300);
}

document.getElementById('btnSaveFolder').addEventListener('click', async () => {
  const name = document.getElementById('inp-folder-name').value.trim();
  if (!name) return;
  if (editingFolderId) {
    const all = await dbGetAll('folders');
    const f = all.find(x => x.id === editingFolderId);
    if (f) { f.name = name; await dbPut('folders', f); }
  } else {
    const all = await dbGetAll('folders');
    const order = all.filter(f => f.parentId === currentFolderId).length;
    await dbPut('folders', { id: Date.now(), parentId: currentFolderId, name, order });
  }
  hideSheet('sheetFolder');
  await render();
});

document.getElementById('inp-folder-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btnSaveFolder').click();
});

document.getElementById('btnDeleteFolder').addEventListener('click', async () => {
  if (!editingFolderId) return;
  await deleteFolderDeep(editingFolderId);
  hideSheet('sheetFolder');
  await render();
});

// ===== LINK SHEET =====
function resetLinkForm() {
  document.getElementById('inp-link-title').value = '';
  document.getElementById('inp-link-url').value = '';
  document.getElementById('inp-link-img').value = '';
  document.getElementById('link-file-label').textContent = 'Toca para elegir imagen';
  document.getElementById('link-img-preview-wrap').style.display = 'none';
  document.getElementById('link-img-preview').src = '';
  document.getElementById('linkDeleteWrap').style.display = 'none';
  pendingImg = null;
  setImgTab('url', document.querySelector('.itab[data-tab="url"]'));
}

function setImgTab(tab, el) {
  document.querySelectorAll('.itab').forEach(b => b.classList.remove('active'));
  el?.classList.add('active');
  document.getElementById('itab-url').style.display  = tab === 'url'  ? '' : 'none';
  document.getElementById('itab-file').style.display = tab === 'file' ? '' : 'none';
}
document.querySelectorAll('.itab').forEach(btn => {
  btn.addEventListener('click', () => setImgTab(btn.dataset.tab, btn));
});

document.getElementById('inp-link-img').addEventListener('input', e => {
  const url = e.target.value.trim();
  const wrap = document.getElementById('link-img-preview-wrap');
  if (url) { document.getElementById('link-img-preview').src = url; wrap.style.display = 'flex'; pendingImg = url; }
  else { wrap.style.display = 'none'; pendingImg = null; }
});

document.getElementById('inp-link-img-file').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    pendingImg = ev.target.result;
    document.getElementById('link-img-preview').src = pendingImg;
    document.getElementById('link-img-preview-wrap').style.display = 'flex';
    document.getElementById('link-file-label').textContent = file.name;
  };
  reader.readAsDataURL(file);
});

document.getElementById('btnClearLinkImg').addEventListener('click', () => {
  pendingImg = null;
  document.getElementById('inp-link-img').value = '';
  document.getElementById('link-file-label').textContent = 'Toca para elegir imagen';
  document.getElementById('link-img-preview-wrap').style.display = 'none';
});

function openAddLink() {
  editingLinkId = null;
  document.getElementById('linkSheetTitle').textContent = 'Nuevo link';
  resetLinkForm();
  showSheet('sheetLink');
  setTimeout(() => document.getElementById('inp-link-title').focus(), 300);
}

async function openEditLink(id) {
  editingLinkId = id;
  document.getElementById('linkSheetTitle').textContent = 'Editar link';
  const all = await dbGetAll('links');
  const l = all.find(x => x.id === id);
  if (!l) return;
  document.getElementById('inp-link-title').value = l.title;
  document.getElementById('inp-link-url').value = l.url;
  pendingImg = l.img || null;
  if (l.img) {
    document.getElementById('link-img-preview').src = l.img;
    document.getElementById('link-img-preview-wrap').style.display = 'flex';
    if (!l.img.startsWith('data:')) {
      document.getElementById('inp-link-img').value = l.img;
      setImgTab('url', document.querySelector('.itab[data-tab="url"]'));
    } else {
      setImgTab('file', document.querySelector('.itab[data-tab="file"]'));
      document.getElementById('link-file-label').textContent = 'Imagen guardada';
    }
  } else {
    setImgTab('url', document.querySelector('.itab[data-tab="url"]'));
    document.getElementById('link-img-preview-wrap').style.display = 'none';
  }
  document.getElementById('linkDeleteWrap').style.display = 'block';
  showSheet('sheetLink');
}

document.getElementById('btnSaveLink').addEventListener('click', async () => {
  const title = document.getElementById('inp-link-title').value.trim();
  const url   = fixUrl(document.getElementById('inp-link-url').value);
  if (!title || !url) {
    if (!title) document.getElementById('inp-link-title').focus();
    else document.getElementById('inp-link-url').focus();
    return;
  }
  if (editingLinkId) {
    const all = await dbGetAll('links');
    const l = all.find(x => x.id === editingLinkId);
    if (l) { l.title = title; l.url = url; l.img = pendingImg || null; await dbPut('links', l); }
  } else {
    const all = await dbGetAll('links');
    const order = all.filter(l => l.folderId === currentFolderId).length;
    await dbPut('links', { id: Date.now(), folderId: currentFolderId, title, url, img: pendingImg || null, order });
  }
  hideSheet('sheetLink');
  await render();
});

document.getElementById('btnDeleteLink').addEventListener('click', async () => {
  if (!editingLinkId) return;
  await dbDelete('links', editingLinkId);
  hideSheet('sheetLink');
  await render();
});

// ===== OVERLAY CLOSE ON BACKDROP =====
['sheetChoice','sheetFolder','sheetLink','sheetSettings'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target.id === id) hideSheet(id);
  });
});

// ===== SETTINGS =====
const PRESETS = ['#4af','#ff4757','#ff6b35','#ffd32a','#2ed573','#a55eea','#ff6eb4','#00d2d3','#ff9f43','#e8ff47','#fff','#aaa'];

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
  showSheet('sheetSettings');
});

document.getElementById('inp-accent-color').addEventListener('input', e => {
  applyAccent(e.target.value);
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
});

document.getElementById('btnSaveSettings').addEventListener('click', () => {
  const name = document.getElementById('inp-app-name').value.trim() || 'Vault';
  localStorage.setItem('vault_name', name);
  localStorage.setItem('vault_accent', accent);
  document.title = name;
  updateTopbar();
  hideSheet('sheetSettings');
});

// ===== BACKUP =====
function hint(msg, type='ok') {
  const el = document.getElementById('backupHint');
  el.textContent = msg; el.className = `backup-hint ${type}`;
  setTimeout(() => { el.textContent=''; el.className='backup-hint'; }, 3000);
}

document.getElementById('btnExport').addEventListener('click', async () => {
  const folders = await dbGetAll('folders');
  const links   = await dbGetAll('links');
  if (!folders.length && !links.length) { hint('No hay nada que exportar','err'); return; }
  const data = { v:2, exportedAt: new Date().toISOString(), accent, name: localStorage.getItem('vault_name')||'', folders, links };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download = `vault-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  hint(`✓ ${folders.length} carpetas, ${links.length} links exportados`);
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
      if (!data.folders || !data.links) throw new Error();
      const ef = new Set((await dbGetAll('folders')).map(x=>x.id));
      const el = new Set((await dbGetAll('links')).map(x=>x.id));
      let nf=0, nl=0;
      for (const f of data.folders) { if (!ef.has(f.id)) { await dbPut('folders',f); nf++; } }
      for (const l of data.links)   { if (!el.has(l.id)) { await dbPut('links',l);   nl++; } }
      if (data.accent) { applyAccent(data.accent); localStorage.setItem('vault_accent',data.accent); }
      if (data.name)   { localStorage.setItem('vault_name',data.name); document.title=data.name; updateTopbar(); }
      await render();
      hint(`✓ ${nf} carpetas, ${nl} links importados`);
    } catch { hint('Archivo no válido','err'); }
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
  applyAccent(accent);
  document.getElementById('btnToggleView').textContent = currentView === 'list' ? '▦' : '≡';
  const name = localStorage.getItem('vault_name');
  if (name) document.title = name;
  updateTopbar();
  await render();
  setTimeout(() => document.getElementById('splash').classList.add('out'), 700);
});
