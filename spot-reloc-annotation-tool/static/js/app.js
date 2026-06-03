import {
  S,
  SQ,
  ENVS,
  RESOURCES,
  selectedEnvId,
  selectedFileIds,
  lastClickedFileId,
  _renderedFileOrder,
  collapsedEnvs,
  setEnvs,
  setResources,
  setSelectedEnvId,
  setLastClickedFileId,
  setRenderedFileOrder,
} from '/static/js/state.js';

window.addEventListener('load', () => {
  let attempts = 0;

  const tryRestore = () => {
    attempts += 1;

    if (!window.S || S.cur || !Array.isArray(S.projects) || !S.projects.length) {
      if (attempts < 20) {
        setTimeout(tryRestore, 100);
      }
      return;
    }

    const firstProject = S.projects[0];
    const projectRef = firstProject.id ?? firstProject.name ?? firstProject;
    const openers = [window.openProject, window.selectProject, window.loadProject, window.setCurrentProject];
    for (const opener of openers) {
      if (typeof opener === 'function') {
        opener(projectRef);
        return;
      }
    }
  };

  setTimeout(tryRestore, 100);
});

// ── Action binding (replaces inline handlers) ──
function bindStaticActions() {
  const actions = {
    setMode: (el) => setMode(el.dataset.arg),
    toggleSparql: () => (SQ.open ? closeSparqlPanel() : openSparqlPanel()),
    zoomIn: () => zoomIn(),
    zoomOut: () => zoomOut(),
    zoomFit: () => zoomFit(),
    zoom100: () => zoom100(),
    undo: () => undo(),
    redo: () => redo(),
    toggleFlattenImage: () => toggleFlattenImage(),
    toggleHideLabels: () => toggleHideLabels(),
    toggleHideAnnotations: () => toggleHideAnnotations(),
    toggleDedupPanel: () => (DP.open ? closeDedupPanel() : openDedupPanel()),
    closeDedupPanel: () => closeDedupPanel(),
    createEnvironment: () => createEnvironment(null),
    triggerImport: () => document.getElementById('import-input')?.click(),
    triggerResource: () => document.getElementById('resource-input')?.click(),
    toggleFileMeta: () => toggleFileMeta(),
    createRootDocSpace: () => createRootDocSpace(),
    applyImageFilter: () => applyImageFilter(),
    resetImageFilter: () => resetImageFilter(),
    exportRDF: () => exportRDF(),
    exportJSON: () => exportJSON(),
    exportAllJSON: () => exportAllJSON(),
    exportAllRDF: () => exportAllRDF(),
    updateFileMetaComment: (el, evt) => updateFileMeta('comment', evt?.target?.value ?? ''),
    updateFileMeta_display_name: (el, evt) => updateFileMeta('display_name', evt?.target?.value ?? ''),
    updateFileMeta_url: (el, evt) => updateFileMeta('url', evt?.target?.value ?? ''),
    updateFileMeta_filetype: (el, evt) => updateFileMeta('filetype', evt?.target?.value ?? ''),
    updateFileMeta_dct_type: (el, evt) => updateFileMeta('dct_type', evt?.target?.value ?? ''),
    sparqlContextChange: (el, evt) => {
      SQ.contextMode = evt?.target?.value || 'file';
      if (document.getElementById('sparql-ttl-wrap')?.classList.contains('open')) loadTtlContent();
    },
    sparqlPresetChange: (el, evt) => sparqlPresetChange(evt?.target?.value || ''),
    sparqlEditorKey: (el, evt) => {
      if (evt && evt.ctrlKey && evt.key === 'Enter') { evt.preventDefault(); runSparqlQuery(); }
    },
    runSparqlQuery: () => runSparqlQuery(),
    sparqlToggleTtl: () => toggleTtlViewer(),
    toggleTtlStyle: () => toggleTtlStyle(),
    sparqlSavePreset: () => saveSparqlPreset(),
    sparqlSaveNameKey: (el, evt) => { if (evt?.key === 'Enter') { evt.preventDefault(); saveSparqlPreset(); } },
    closeSparqlPanel: () => closeSparqlPanel(),
    sparqlExportCSV:  () => sparqlExportCSV(),
    // TTL edit-mode actions disabled — TTL is read-only, generated live from annotations
    // toggleTtlEdit, saveTtlContent, regenerateTtl, ttlFindKey, ttlReplaceKey, ttlReplaceOne, ttlReplaceAll
  };

  const bind = (el) => {
    const action = el.dataset.action;
    if (!action || !actions[action]) return;
    const ev = el.dataset.event || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? 'input' : 'click');
    el.addEventListener(ev, (evt) => actions[action](el, evt));
  };

  document.querySelectorAll('[data-action]').forEach(bind);
}

document.addEventListener('DOMContentLoaded', bindStaticActions);

// Wire the clear-chat button independently so it always works regardless of
// the bindStaticActions binding order or any other initialization issue.
document.addEventListener('DOMContentLoaded', () => {
  // (TTL edit-mode textarea listeners removed — edit mode disabled)

  // TTL viewer is open by default — trigger initial load
  // (loadTtlContent is a no-op if no project is open yet, openProject will refresh)
  loadTtlContent();
});

function toggleEnvCollapse(eid) {
  if (collapsedEnvs.has(eid)) collapsedEnvs.delete(eid);
  else collapsedEnvs.add(eid);
  renderFileList();
}

// Call before any mutating operation to save a snapshot for undo
function snapshot() {
  if (S._skipSnapshot) return;
  S.undoStack.push(JSON.stringify(S.spaces));
  if (S.undoStack.length > 60) S.undoStack.shift();
  S.redoStack = []; // clear redo on new action
}
function undo() {
  if (!S.undoStack.length) { notify('Nothing to undo'); return; }
  S.redoStack.push(JSON.stringify(S.spaces));
  S._skipSnapshot = true;
  S.spaces = JSON.parse(S.undoStack.pop());
  S._skipSnapshot = false;
  S.dirty = true;
  renderAnnotations(); renderSpacesPanel(); autoSave();
}
function redo() {
  if (!S.redoStack.length) { notify('Nothing to redo'); return; }
  S.undoStack.push(JSON.stringify(S.spaces));
  S._skipSnapshot = true;
  S.spaces = JSON.parse(S.redoStack.pop());
  S._skipSnapshot = false;
  S.dirty = true;
  renderAnnotations(); renderSpacesPanel(); autoSave();
}

const COLORS = ['#b30000','#009a00','#0000b3','#b300b3','#cece00','#00b3b3'];
const CARD_BG = ['#330000','#003300','#000033','#330033','#333300','#003333'];
const CARD_BD = ['#8B3A3A','#3D7A3D','#3A3A8B','#8B3A8B','#8B8B3A','#3A8B8B'];
function colIdx(id) {
  let d = 0, sp = S.spaces[id];
  while (sp && sp.parent_id) { d++; sp = S.spaces[sp.parent_id]; if (d>10) break; }
  return d % COLORS.length;
}
function col(id) { return COLORS[colIdx(id)]; }

// ── Dark-mode colour helpers ──────────────────────────────────────
function lightenHex(hex, f) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const lr=Math.round(r+(255-r)*f), lg=Math.round(g+(255-g)*f), lb=Math.round(b+(255-b)*f);
  return '#'+[lr,lg,lb].map(v=>v.toString(16).padStart(2,'0')).join('');
}
const DARK_COLORS = COLORS.map(c => lightenHex(c, 0.20));
const DARK_AXIS = { x: lightenHex('#c0392b',0.20), y: lightenHex('#1e8449',0.20), z: lightenHex('#1a5276',0.20) };
function isDarkMode() { return document.getElementById('canvas-container')?.classList.contains('viewer-dark') ?? false; }
function colDark(id)  { return DARK_COLORS[colIdx(id)]; }
function colEff(id)   { return isDarkMode() ? colDark(id) : col(id); }
function srcAxisColor(name) {
  const base = { x:'#c0392b', y:'#1e8449', z:'#1a5276' };
  const dark = DARK_AXIS;
  const k = (name||'').toLowerCase();
  return (isDarkMode() ? dark[k] : base[k]) || '#888888';
}

const UI_STATE_KEY = 'a2ds_ui_state_v1';

function _readUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function _writeUiState(patch) {
  try {
    const current = _readUiState();
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (err) {
    // best-effort only
  }
}

function _persistSelectedFiles() {
  _writeUiState({
    selectedFileIds: [...selectedFileIds],
    lastClickedFileId,
  });
}

function _restoreSelectedFiles() {
  const state = _readUiState();
  selectedFileIds.clear();
  for (const pid of Array.isArray(state.selectedFileIds) ? state.selectedFileIds : []) {
    selectedFileIds.add(pid);
  }
  setLastClickedFileId(state.lastClickedFileId || null);
}

function _restoreSelectedEnv() {
  const state = _readUiState();
  setSelectedEnvId(state.selectedEnvId || null);
}

function _persistCurrentProject(pid) {
  _writeUiState({ lastProjectId: pid || null });
}

function _getStoredProjectId() {
  const state = _readUiState();
  return state.lastProjectId || null;
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    await loadProjects();
  })();
  refreshGlobalEntities();
  setupCanvas();
  setupKeyboard();
  applyDocFilter(); // initialise canvas filter (dark mode may be on by default)
  document.getElementById('import-input').addEventListener('change', onImport);
  document.getElementById('resource-input').addEventListener('change', onResourceImport);
  setupResizers();
  setupDedupColResizers();
  restoreLayout();
  // Track focus inside right panel to lock viewer selection
  const rp = document.getElementById('right-panel');
  rp.addEventListener('focusin',  () => { S.panelFocus = true; });
  rp.addEventListener('focusout', (e) => {
    // Only clear if focus moved outside right-panel entirely
    if (!rp.contains(e.relatedTarget)) S.panelFocus = false;
  });

  // File rename: commit rename on blur or Enter from the filename input
  const _fmFn = document.getElementById('fm-filename');
  if (_fmFn) {
    _fmFn.addEventListener('blur', e => renameCurrentFile(e.target.value));
    _fmFn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  }

  // Expose functions used in dynamically-generated inline HTML event handlers to
  // window scope — required because app.js runs as an ES module (not global scope).
  Object.assign(window, {
    onFileClick, onFileDragStart, removeFile, deleteResource,
    onEnvDragStart, onDropOnEnv, selectEnvironment, toggleEnvCollapse,
    promptRenameEnv, createEnvironment, deleteEnvironment,
    onDragEnd, onDragOver, onDragLeave,
  });
});

// ════════════════════════════════════════════════════════════════
// FILE MANAGEMENT
// ════════════════════════════════════════════════════════════════
async function loadProjects() {
  renderFileList(); // show immediately (empty state) — avoids half-second blank panel
  // Fetch environments and projects in parallel
  await Promise.all([
    loadEnvironments().catch(e => console.error('loadEnvironments:', e)),
    fetch('/api/projects').then(r => r.json()).then(data => { S.projects = data; }).catch(e => console.error('fetch projects:', e)),
  ]);
  _restoreSelectedEnv();
  _restoreSelectedFiles();
  renderFileList(); // update with loaded data

  const savedPid = _getStoredProjectId();
  if (!S.cur && savedPid) {
    await openProject(savedPid);
  }
  loadResources();
}

function onFileClick(e, pid) {
  if (e.ctrlKey || e.metaKey) {
    // Ctrl/Cmd+click: toggle selection, don’t open
    if (selectedFileIds.has(pid)) selectedFileIds.delete(pid);
    else selectedFileIds.add(pid);
    setLastClickedFileId(pid);
    _persistSelectedFiles();
    renderFileList();
    return;
  }
  if (e.shiftKey && lastClickedFileId && _renderedFileOrder.length) {
    // Shift+click: range select
    const a = _renderedFileOrder.indexOf(lastClickedFileId);
    const b = _renderedFileOrder.indexOf(pid);
    if (a !== -1 && b !== -1) {
      const lo = Math.min(a,b), hi = Math.max(a,b);
      for (let i = lo; i <= hi; i++) selectedFileIds.add(_renderedFileOrder[i]);
    }
    setLastClickedFileId(pid);
    _persistSelectedFiles();
    renderFileList();
    return;
  }
  // Normal click: open and set single selection
  selectedFileIds.clear();
  selectedFileIds.add(pid);
  setLastClickedFileId(pid);
  _persistSelectedFiles();
  openProject(pid);
}

function renderFileList() {
  const el = document.getElementById('file-list');
  setRenderedFileOrder([]);
  const html = [];

  function renderEnvNode(envId, depth) {
    const env = ENVS[envId]; if (!env) return;
    const isSelected = selectedEnvId === envId;
    const childEnvIds = Object.keys(ENVS).filter(eid => ENVS[eid].parent_id === envId);
    const envProjects = S.projects.filter(p => p.env_id === envId)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
    const pl = depth * 12 + 4;
    const isCollapsed = collapsedEnvs.has(envId);
    const arrowChar = isCollapsed ? '&#9654;' : '&#9660;'; // ▶ / ▼
    html.push(
      `<div class="env-item${isSelected ? ' selected' : ''}" style="padding-left:${pl}px"`+
      ` draggable="true" data-env-id="${envId}"`+
      ` ondragstart="onEnvDragStart(event,'${envId}')" ondragend="onDragEnd(event)"`+
      ` ondragover="onDragOver(event)" ondragleave="onDragLeave(event)"`+
      ` ondrop="onDropOnEnv(event,'${envId}')" onclick="selectEnvironment('${envId}')">` +
      `<button class="env-collapse-btn" onclick="event.stopPropagation();toggleEnvCollapse('${envId}')" title="Expand/collapse">${arrowChar}</button>`+
      `<span class="env-name" title="${esc(env.name)}" ondblclick="event.stopPropagation();promptRenameEnv('${envId}')">${esc(env.name)}</span>`+
      `<button class="env-btn" onclick="event.stopPropagation();createEnvironment('${envId}')" title="Add sub-folder">&#128194;</button>`+
      `<button class="env-btn" onclick="event.stopPropagation();promptRenameEnv('${envId}')" title="Rename">&#9998;</button>`+
      `<button class="env-btn env-del-btn" onclick="event.stopPropagation();deleteEnvironment('${envId}')" title="Delete">&#10005;</button>`+
      `</div>`
    );
    if (!isCollapsed) {
    for (const ceid of childEnvIds) renderEnvNode(ceid, depth + 1);
    for (const p of envProjects) {
      const icon = p.ext === '.pdf' ? '&#128196;' : '&#128444;';
      const act  = S.cur?.id === p.id ? ' active' : '';
      const msel = selectedFileIds.has(p.id) && S.cur?.id !== p.id ? ' multi-sel' : '';
      _renderedFileOrder.push(p.id);
      html.push(
        `<div class="file-item${act}${msel}" style="padding-left:${pl}px"`+
        ` draggable="true" data-project-id="${p.id}"`+
        ` ondragstart="onFileDragStart(event,'${p.id}')" ondragend="onDragEnd(event)"`+
        ` onclick="onFileClick(event,'${p.id}')">` +
        `<span class="file-item-indent"></span>`+
        `<span class="file-item-name" title="${esc(p.name)}">${esc(p.name)}</span>`+
        `<button class="file-del-btn" onclick="removeFile(event,'${p.id}')" title="Remove">&#10005;</button>`+
        `</div>`
      );
    }
    } // end if (!isCollapsed)
  }

  const rootEnvIds = Object.keys(ENVS).filter(eid => !ENVS[eid].parent_id);
  for (const eid of rootEnvIds) renderEnvNode(eid, 0);

  const unassigned = S.projects.filter(p => !p.env_id)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
  for (const p of unassigned) {
    const icon = p.ext === '.pdf' ? '&#128196;' : '&#128444;';
    const act  = S.cur?.id === p.id ? ' active' : '';
    const msel = selectedFileIds.has(p.id) && S.cur?.id !== p.id ? ' multi-sel' : '';
    _renderedFileOrder.push(p.id);
    html.push(
      `<div class="file-item${act}${msel}"`+
      ` draggable="true" data-project-id="${p.id}"`+
      ` ondragstart="onFileDragStart(event,'${p.id}')" ondragend="onDragEnd(event)"`+
      ` onclick="onFileClick(event,'${p.id}')">` +
      `<span class="file-item-name" title="${esc(p.name)}">${esc(p.name)}</span>`+
      `<button class="file-del-btn" onclick="removeFile(event,'${p.id}')" title="Remove">&#10005;</button>`+
      `</div>`
    );
  }

  el.innerHTML = html.length
    ? html.join('')
    : '<div style="color:var(--text3);font-size:9px;font-family:var(--mono);padding:10px 8px;text-align:center;">Import a file or add an environment</div>';

  // Root-level drop zone: drop on blank area of list = move to root
  el.ondragover  = e => { e.preventDefault(); el.classList.add('drag-over-root'); };
  el.ondragleave = e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over-root'); };
  el.ondrop      = e => {
    el.classList.remove('drag-over-root');
    if (e.target !== el) return;
    e.preventDefault();
    const idsJson = e.dataTransfer.getData('text/project-ids');
    const pid = e.dataTransfer.getData('text/project-id');
    const eid = e.dataTransfer.getData('text/env-id');
    if (idsJson) { try { JSON.parse(idsJson).forEach(p => moveProjectToEnv(p, null)); } catch(_) {} }
    else if (pid) moveProjectToEnv(pid, null);
    if (eid) moveEnvToParent(eid, null);
  };
}

// ── Drag-and-drop handlers ──
function onFileDragStart(e, pid) {
  // If pid is in a multi-selection, drag all selected IDs together
  const ids = (selectedFileIds.size > 1 && selectedFileIds.has(pid))
    ? [...selectedFileIds]
    : [pid];
  e.dataTransfer.setData('text/project-ids', JSON.stringify(ids));
  e.dataTransfer.setData('text/project-id', pid); // fallback
  e.dataTransfer.effectAllowed = 'move';
  e.stopPropagation();
}
function onEnvDragStart(e, eid) {
  e.dataTransfer.setData('text/env-id', eid);
  e.dataTransfer.effectAllowed = 'move';
  e.stopPropagation();
}
function onDragEnd(e) {
  document.querySelectorAll('.drag-over,.drag-over-root').forEach(el => {
    el.classList.remove('drag-over','drag-over-root');
  });
}
function onDragOver(e) {
  e.preventDefault(); e.stopPropagation();
  e.currentTarget.classList.add('drag-over');
}
function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}
function onDropOnEnv(e, targetEnvId) {
  e.preventDefault(); e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  const idsJson = e.dataTransfer.getData('text/project-ids');
  const pid = e.dataTransfer.getData('text/project-id');
  const eid = e.dataTransfer.getData('text/env-id');
  if (idsJson) {
    try { JSON.parse(idsJson).forEach(p => moveProjectToEnv(p, targetEnvId)); } catch(_) {}
  } else if (pid) { moveProjectToEnv(pid, targetEnvId); }
  if (eid && eid !== targetEnvId) moveEnvToParent(eid, targetEnvId);
}

async function moveProjectToEnv(pid, envId) {
  const p = S.projects.find(x => x.id === pid);
  if (!p || p.env_id === envId) return;
  // Flush unsaved changes BEFORE the server records the new env_id, otherwise
  // a concurrent autoSave that fires during the move can overwrite stale data.
  if (S.cur?.id === pid && S.dirty) await saveSpaces(pid);
  try {
    await fetch(`/api/project/${pid}/set-env`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({env_id: envId}),
    });
    p.env_id = envId;
    // S.cur is fetched independently so it won't share the same reference as p;
    // keep it in sync so SPARQL context queries the correct env after a move.
    if (S.cur?.id === pid) S.cur.env_id = envId;
    renderFileList();
    notify(`Moved to ${envId ? (ENVS[envId]?.name || envId) : 'root'}`);
  } catch(err) { notify('Move failed'); }
}

async function moveEnvToParent(eid, newParentId) {
  if (eid === newParentId) return;
  try {
    const r = await fetch(`/api/environment/${eid}/move`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({parent_id: newParentId}),
    });
    const data = await r.json();
    if (data.error) { notify(data.error); return; }
    ENVS[eid] = data;
    renderFileList();
    notify(`Folder moved to ${newParentId ? (ENVS[newParentId]?.name || newParentId) : 'root'}`);
  } catch(err) { notify('Move failed'); }
}

async function onImport(e) {
  for (const file of e.target.files) {
    setStatus(`Uploading ${file.name}…`);
    const fd = new FormData();
    fd.append('file', file);
    if (selectedEnvId) fd.append('env_id', selectedEnvId);
    try {
      const r = await fetch('/api/upload', {method:'POST', body:fd});
      const d = await r.json();
      if (d.error) { notify('Error: '+d.error); continue; }
      S.projects.push({id:d.id, name:d.name, ext:d.ext, env_id: d.env_id || null});
      renderFileList();
      await openProject(d.id);
    } catch(err) { notify('Upload failed'); }
  }
  e.target.value = '';
  setStatus('ready');
}

async function onResourceImport(e) {
  for (const file of e.target.files) {
    setStatus(`Uploading resource: ${file.name}\u2026`);
    const fd = new FormData();
    fd.append('file', file);
    if (selectedEnvId) fd.append('env_id', selectedEnvId);
    try {
      const r = await fetch('/api/resources/upload', {method:'POST', body:fd});
      const d = await r.json();
      if (d.error) { notify('Error: '+d.error); continue; }
      RESOURCES.push(d);
      renderResourceList();
      notify(`Resource added: ${d.name}`);
    } catch(err) { notify('Resource upload failed'); }
  }
  e.target.value = '';
  setStatus('ready');
}

async function removeFile(e, pid) {
  e.stopPropagation();
  try {
    await fetch(`/api/project/${pid}/delete`, {method:'POST'});
    S.projects = S.projects.filter(p => p.id !== pid);
    if (S.cur?.id === pid) {
      S.cur = null; S.spaces = {}; S.selId = null;
      document.getElementById('doc-canvas').style.display = 'none';
      document.getElementById('viewer-empty').style.display = 'flex';
      document.getElementById('fname').textContent = '— no file open —';
      document.getElementById('btn-export-rdf').disabled  = true;
      document.getElementById('btn-export-json').disabled = true;
      clearFileMeta();
      renderSpacesPanel();
      renderAnnotations();
    }
    renderFileList();
    notify('File removed');
  } catch(err) { notify('Remove failed'); }
}

// ════════════════════════════════════════════════════════════════
// ENVIRONMENT MANAGEMENT
// ════════════════════════════════════════════════════════════════
async function loadEnvironments() {
  try {
    const r = await fetch('/api/environments');
    setEnvs(await r.json());
  } catch(e) {}
}

async function loadResources() {
  try {
    const r = await fetch('/api/resources');
    setResources(await r.json());
    renderResourceList();
  } catch(e) {}
}

function renderResourceList() {
  const el = document.getElementById('resource-list');
  if (!el) return;
  if (!RESOURCES.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:9px;font-family:var(--mono);padding:6px 8px;text-align:center;">No resources attached</div>';
    return;
  }
  el.innerHTML = RESOURCES.map(r =>
    `<div class="resource-item">`+
    `<span style="font-size:11px;flex-shrink:0">&#128206;</span>`+
    `<span class="resource-name" title="${esc(r.name)}">${esc(r.name)}</span>`+
    `<button class="file-del-btn" onclick="deleteResource('${r.id}')" title="Remove">✕</button>`+
    `</div>`
  ).join('');
}

async function deleteResource(rid) {
  try {
    await fetch(`/api/resource/${rid}`, {method:'DELETE'});
    setResources(RESOURCES.filter(r => r.id !== rid));
    renderResourceList();
    notify('Resource removed');
  } catch(e) { notify('Remove failed'); }
}

function selectEnvironment(envId) {
  // Toggle selection: click selected env again to deselect
  setSelectedEnvId(selectedEnvId === envId ? null : envId);
  _writeUiState({ selectedEnvId });
  renderFileList();
  updateAIContextBadge();
  // Live-reload TTL viewer when folder selection changes
  if (document.getElementById('sparql-ttl-wrap')?.classList.contains('open')) loadTtlContent();
}

async function createEnvironment(parentId) {
  const name = prompt('Environment name:', 'New Environment');
  if (!name || !name.trim()) return;
  try {
    const r = await fetch('/api/environments', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: name.trim(), parent_id: parentId || null}),
    });
    const env = await r.json();
    ENVS[env.id] = env;
    if (!parentId) setSelectedEnvId(env.id);  // auto-select new root env
    _writeUiState({ selectedEnvId });
    renderFileList();
    notify('Environment created: ' + env.name);
  } catch(e) { notify('Failed to create environment'); }
}

async function promptRenameEnv(eid) {
  const env = ENVS[eid];
  if (!env) return;
  const name = prompt('Rename environment:', env.name);
  if (!name || !name.trim() || name.trim() === env.name) return;
  try {
    const r = await fetch(`/api/environment/${eid}/rename`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: name.trim()}),
    });
    const updated = await r.json();
    ENVS[eid] = updated;
    renderFileList();
    updateAIContextBadge();
  } catch(e) { notify('Rename failed'); }
}

async function deleteEnvironment(eid) {
  const env = ENVS[eid];
  if (!confirm(`Delete environment "${env?.name}"?\nFiles inside will move to parent level.`)) return;
  try {
    await fetch(`/api/environment/${eid}`, {method:'DELETE'});
    delete ENVS[eid];
    if (selectedEnvId === eid) setSelectedEnvId(null);
    _writeUiState({ selectedEnvId });
    // Reload projects to get fresh env_id assignments
    const r = await fetch('/api/projects');
    S.projects = await r.json();
    renderFileList();
    updateAIContextBadge();
    notify('Environment deleted');
  } catch(e) { notify('Delete failed'); }
}

async function openProject(pid) {
  if (S.dirty && S.cur) await saveSpaces(S.cur.id);
  try {
    const r = await fetch(`/api/project/${pid}`);
    const d = await r.json();
    S.cur = d; S.spaces = d.spaces || {}; S.selId = null; S.dirty = false;
    _persistCurrentProject(d.id);
    _dedupFullCache.set(d.id, d); // keep dedup cache warm for env/all context modes
    // Migrate any per-file entity_classes data into the global store
    const _legacyEC = d.meta?.entity_classes;
    if (_legacyEC && Object.keys(_legacyEC).length) {
      let changed = false;
      for (const [ek, assocs] of Object.entries(_legacyEC)) {
        if (!_globalEntityClasses[ek]) _globalEntityClasses[ek] = [];
        for (const a of (assocs || [])) {
          if (!_globalEntityClasses[ek].some(x => x.pred === a.pred && x.cls === a.cls)) {
            _globalEntityClasses[ek].push(a);
            changed = true;
          }
        }
      }
      if (changed) {
        fetch('/api/entity_classes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(_globalEntityClasses) }).catch(() => {});
      }
    }
    // Migrate legacy type names
    Object.values(S.spaces).forEach(sp => { if (sp.type === 'VectorSpace') sp.type = 'LineSpace'; });
    // Merge per-project ontologies into global store (don't replace global with per-project)
    const _normOnto = o => {
      if (!o.mainPrefix) {
        const usedPf = new Map();
        for (const term of [...(o.classes||[]), ...(o.predicates||[])]) {
          const colon = term.indexOf(':');
          if (colon > 0) { const pf = term.slice(0, colon); usedPf.set(pf, (usedPf.get(pf)||0)+1); }
        }
        o.mainPrefix = usedPf.size > 0 ? [...usedPf.entries()].sort((a,b)=>b[1]-a[1])[0][0] : '';
      }
      return o;
    };
    const projOntos = (d.ontologies || []).filter(o => o && o.name).map(_normOnto);
    let _ontoChanged = false;
    for (const o of projOntos) {
      if (!_globalOntologies.some(g => g.name === o.name)) {
        _globalOntologies.push(o); _ontoChanged = true;
      }
    }
    if (_ontoChanged) _saveGlobalOntologies();
    DP.ontologies = _globalOntologies;
    _renderOntologyList();
    renderFileList();
    loadImage(d);
    document.getElementById('fname').textContent = d.original_name;
    document.getElementById('btn-export-rdf').disabled  = false;
    document.getElementById('btn-export-json').disabled = false;
    loadFileMeta(d);
    renderSpacesPanel();
    if (DP.open) { renderDedupSpaceList(); _refreshDedupGraph(); }
    // Keep chat history — only reset focused space and add a context-switch notice
    AI.focusSpaceId = null;
    const prevProject = AI.currentProjectName;
    AI.currentProjectName = d.original_name;
    if (prevProject && prevProject !== d.original_name) {
      aiAppendSys(`─── Context switched to: "${d.original_name}" ───`);
    }
    updateAIContextBadge();
    // Live-reload TTL viewer when the open file changes
    if (document.getElementById('sparql-ttl-wrap')?.classList.contains('open')) loadTtlContent();
    // Refresh 3D asset picker list if it is open
    if (document.getElementById('v3d-asset-picker')?.style.display !== 'none') {
      _v3dFilterSpaces(document.getElementById('v3d-asset-search')?.value || '');
    }
  } catch(err) { notify('Failed to open'); }
}

function loadImage(d) {
  const img = document.getElementById('doc-canvas');
  const emp = document.getElementById('viewer-empty');
  img.onload = () => {
    img.style.display = 'block'; emp.style.display = 'none';
    if (_pendingNavSpaceId) {
      const navId = _pendingNavSpaceId;
      _pendingNavSpaceId = null;
      renderAnnotations();
      fitSpaceInView(navId);
    } else {
      zoomFit(); renderAnnotations();
    }
  };
  img.onerror= () => { img.style.display = 'none'; emp.style.display = 'flex'; emp.querySelector('.et').textContent = 'PDF preview unavailable'; renderAnnotations(); };
  img.src = `/static/uploads/${d.filename}?t=${Date.now()}`;
  img.style.width = d.width+'px'; img.style.height = d.height+'px';
}

// ════════════════════════════════════════════════════════════════
// FILE META
// ════════════════════════════════════════════════════════════════
function loadFileMeta(d) {
  const meta = d.meta || {};
  // Editable display name (defaults to original filename)
  document.getElementById('fm-filename').value    = meta.display_name || d.original_name || '';
  // URL: derive from file path, anonymized to last 3 path segments
  const rawUrl = meta.url !== undefined ? meta.url : anonymizeUrl(d.filename || d.original_name || '');
  document.getElementById('fm-url').value         = rawUrl;
  document.getElementById('fm-filetype').value    = meta.filetype || (d.ext ? d.ext.replace('.','') : '');
  // dct_type dropdown — default Image
  const dctEl = document.getElementById('fm-dcttype');
  const dctVal = meta.dct_type || 'Image';
  dctEl.value = dctVal;
  if (!dctEl.value) dctEl.value = 'Image'; // fallback if stored value not in list
  document.getElementById('fm-comment').value     = meta.comment  || '';
}
function anonymizeUrl(filePath) {
  // Keep only last 3 segments of a path/url, separated by /
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}
function clearFileMeta() {
  document.getElementById('fm-filename').value = '';
  document.getElementById('fm-url').value = '';
  document.getElementById('fm-filetype').value = '';
  document.getElementById('fm-dcttype').value = 'Image';
  document.getElementById('fm-comment').value = '';
}
function updateFileMeta(key, val) {
  if (!S.cur) return;
  if (!S.cur.meta) S.cur.meta = {};
  S.cur.meta[key] = val;
  S.dirty = true; autoSave();
}

async function renameCurrentFile(newName) {
  if (!S.cur) return;
  const trimmed = (newName || '').trim();
  // Compare against original_name (actual stored name), not the display_name override,
  // because the input-event handler will already have set display_name = trimmed.
  if (!trimmed || trimmed === S.cur.original_name) {
    // Restore the input to the real current name (discards any display_name override)
    const input = document.getElementById('fm-filename');
    if (input) input.value = S.cur.original_name || '';
    if (S.cur.meta) delete S.cur.meta.display_name;
    return;
  }
  // Clear the temporary display_name override immediately so a concurrent autoSave
  // does not persist a stale value on top of the renamed original_name.
  if (S.cur.meta) delete S.cur.meta.display_name;
  try {
    const r = await fetch(`/api/project/${S.cur.id}/rename`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({new_name: trimmed}),
    });
    const data = await r.json();
    if (data.error) { notify(data.error); return; }
    const actualName = data.name;
    // Sync S.cur
    S.cur.original_name = actualName;
    // Sync the matching entry in S.projects (which stores a lean copy loaded via /api/projects)
    const p = S.projects.find(x => x.id === S.cur.id);
    if (p) p.name = actualName;
    // Update the input to reflect the saved name (especially if a _copy01 suffix was added)
    const input = document.getElementById('fm-filename');
    if (input) input.value = actualName;
    renderFileList();
    if (data.renamed) {
      notify(`Duplicate name — saved as "${actualName}"`, 3500);
    } else {
      notify(`Renamed to "${actualName}"`);
    }
  } catch(err) { notify('Rename failed'); }
}

// ════════════════════════════════════════════════════════════════
// ZOOM & PAN
// ════════════════════════════════════════════════════════════════
function applyT() {
  const t = `translate(${S.panX}px,${S.panY}px) scale(${S.zoom})`;
  document.getElementById('doc-canvas').style.transform = t;
  document.getElementById('anno-layer').style.transform = t;
  document.getElementById('zoom-info').textContent = Math.round(S.zoom*100)+'%';
  renderLabels();
}
function zoomFit() {
  if (!S.cur) return;
  const c = document.getElementById('canvas-container');
  const cw = c.clientWidth-40, ch = c.clientHeight-40;
  S.zoom = Math.min(cw/S.cur.width, ch/S.cur.height, 1);
  S.panX = (c.clientWidth  - S.cur.width  * S.zoom) / 2;
  S.panY = (c.clientHeight - S.cur.height * S.zoom) / 2;
  applyT();
}
function zoom100() { S.zoom=1; applyT(); }
function zoomIn()  { S.zoom = Math.min(S.zoom*1.2, 8); applyT(); }
function zoomOut() { S.zoom = Math.max(S.zoom/1.2, .05); applyT(); }

// ── Space navigation helpers ───────────────────────────────────
// Mirror of Python's _safe() in exporter.py
function _jsSafe(name) {
  return (String(name).trim() || 'Space')
    .replace(/[\s\x00-\x1f"#<>{}|\\^`\[\]\/]/g, '_') || 'Space';
}

// Find space ID by its TTL safe local name (first match in current project)
function _findSpaceByLocalName(localName) {
  if (!localName || !S.spaces) return null;
  for (const [id, sp] of Object.entries(S.spaces)) {
    if (_jsSafe(sp.name || '') === localName) return id;
  }
  return null;
}

// Pending nav target consumed by loadImage onload (when switching projects)
let _pendingNavSpaceId = null;

// Cycle state: repeated calls with the same localName step through all appearances
let _navCycle = { localName: null, matches: [], idx: 0 };

// Navigate to a space by its TTL local name, crossing project/env boundaries.
// Repeated calls with the same name cycle through all appearances in the context.
async function _navigateToLocalName(localName) {
  if (!localName) return;

  // If same name as last call, advance to next appearance; otherwise fetch fresh
  if (localName !== _navCycle.localName) {
    const { projectIds, envId } = _sparqlGetContext();
    // Always include the currently open project so navigation works even in
    // mismatched context modes (e.g. panel set to "file" but IRI is from another)
    const extraIds = S.cur?.id ? [S.cur.id] : [];
    // Also queue all loaded projects as fallback if context is narrow
    const allKnownIds = (S.projects || []).map(p => p.id);
    try {
      const resp = await fetch('/api/sparql/find_space', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          local_name: localName,
          project_ids: projectIds,
          env_id: envId,
          extra_project_ids: extraIds,
        }),
      });
      let d = await resp.json();
      let matches = d.matches || [];
      // Fallback: search ALL known projects if context search came up empty
      if (!matches.length && allKnownIds.length) {
        const r2 = await fetch('/api/sparql/find_space', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ local_name: localName, project_ids: allKnownIds, env_id: null, extra_project_ids: [] }),
        });
        d = await r2.json();
        matches = d.matches || [];
      }
      if (!matches.length) { notify(`"${localName}" not found`); return; }
      _navCycle = { localName, matches, idx: 0 };
    } catch(err) { notify('Navigation failed: ' + err.message); return; }
  } else {
    // Cycle to next
    _navCycle.idx = (_navCycle.idx + 1) % _navCycle.matches.length;
  }

  const m = _navCycle.matches[_navCycle.idx];
  const total = _navCycle.matches.length;
  const label = total > 1 ? ` (${_navCycle.idx + 1}/${total})` : '';
  notify(`${m.space_name || localName}${label} — ${m.project_name}`);

  if (m.project_id === S.cur?.id) {
    fitSpaceInView(m.space_id);
  } else {
    // Switch project; fitSpaceInView fires from loadImage onload once image is ready
    _pendingNavSpaceId = m.space_id;
    await openProject(m.project_id);
  }
}

// Pan + zoom viewer to fit the given space with a slight margin
function fitSpaceInView(id) {
  const sp = S.spaces[id];
  if (!sp || !S.cur) return;
  const c    = document.getElementById('canvas-container');
  const cw   = c.clientWidth, ch = c.clientHeight;
  const docW = S.cur.width,  docH = S.cur.height;
  const MARGIN = 60, MIN_DIM = 30;

  let px0, py0, px1, py1;
  if (sp.type === 'DocumentSpace' && sp.bbox) {
    const rb = bboxRootNorm(sp.bbox, sp.parent_id);
    px0 = rb.left  * docW; py0 = rb.top    * docH;
    px1 = rb.right * docW; py1 = rb.bottom * docH;
  } else if (sp.type === 'PointSpace' && sp.point) {
    const rp = ptRootNorm(sp.point, sp.parent_id);
    const cx0 = rp.x * docW, cy0 = rp.y * docH;
    // Show a generous window around a point (300px radius in doc-pixels)
    const PT_HALF = 300;
    px0 = cx0 - PT_HALF; py0 = cy0 - PT_HALF;
    px1 = cx0 + PT_HALF; py1 = cy0 + PT_HALF;
  } else if ((sp.type === 'LineSpace' || sp.type === 'VectorSpace') && sp.start && sp.end) {
    const rs = ptRootNorm(sp.start, sp.parent_id);
    const re = ptRootNorm(sp.end,   sp.parent_id);
    px0 = Math.min(rs.x, re.x) * docW; py0 = Math.min(rs.y, re.y) * docH;
    px1 = Math.max(rs.x, re.x) * docW; py1 = Math.max(rs.y, re.y) * docH;
  } else {
    // Fallback: no geometry yet (new space, old data) – scroll to parent bbox or full doc
    const parent = sp.parent_id ? S.spaces[sp.parent_id] : null;
    if (parent && parent.bbox) {
      fitSpaceInView(parent.id);
    }
    selectSpace(id, true);
    return;
  }

  const bw = Math.max(px1 - px0, MIN_DIM);
  const bh = Math.max(py1 - py0, MIN_DIM);
  S.zoom = Math.min((cw - 2 * MARGIN) / bw, (ch - 2 * MARGIN) / bh, 8);
  S.zoom = Math.max(S.zoom, 0.05);
  const cx = (px0 + px1) / 2, cy = (py0 + py1) / 2;
  S.panX = cw / 2 - cx * S.zoom;
  S.panY = ch / 2 - cy * S.zoom;
  applyT();
  selectSpace(id, true);
}

// ════════════════════════════════════════════════════════════════
// MODE
// ════════════════════════════════════════════════════════════════
function setMode(m) {
  S.mode = m;
  ['select','bbox','volume','point','vector'].forEach(k => {
    const btn = document.getElementById('btn-'+k);
    if (btn) btn.classList.toggle('active', k===m);
  });
  // Swap only mode-* class — preserve viewer-dark, ocr-drawing and any other persistent classes
  const c = document.getElementById('canvas-container');
  ['select','bbox','volume','vector','point'].forEach(k => c.classList.remove('mode-'+k));
  c.classList.add('mode-' + (m === 'volume' ? 'bbox' : m));
}

// ════════════════════════════════════════════════════════════════
// COORDINATE HELPERS
// (bbox & point stored parent-relative; root-norm used for display)
// ════════════════════════════════════════════════════════════════
function docXY(cx, cy) {
  const r = document.getElementById('canvas-container').getBoundingClientRect();
  return { x: (cx - r.left - S.panX) / S.zoom, y: (cy - r.top - S.panY) / S.zoom };
}
const W = () => S.cur?.width  || 1;
const H = () => S.cur?.height || 1;

function bboxRootNorm(bbox, parentId) {
  if (!parentId) return bbox;
  const ps = S.spaces[parentId]; if (!ps?.bbox) return bbox;
  const b = ps.bbox, pw = b.right-b.left, ph = b.bottom-b.top;
  // recurse: parent's bbox is itself parent-relative → get its root-norm first
  const rb = bboxRootNorm(b, ps.parent_id);
  const rpw = rb.right-rb.left, rph = rb.bottom-rb.top;
  return {
    left:   rb.left + bbox.left   * rpw,
    top:    rb.top  + bbox.top    * rph,
    right:  rb.left + bbox.right  * rpw,
    bottom: rb.top  + bbox.bottom * rph,
  };
}

// Like bboxRootNorm but operates on an external spaces dictionary (cross-project)
function bboxRootNormExt(bbox, parentId, spacesDict) {
  if (!parentId) return bbox;
  const ps = spacesDict[parentId];
  if (!ps?.bbox) return bbox;
  const rb = bboxRootNormExt(ps.bbox, ps.parent_id, spacesDict);
  const rpw = rb.right - rb.left, rph = rb.bottom - rb.top;
  return {
    left:   rb.left + bbox.left   * rpw,
    top:    rb.top  + bbox.top    * rph,
    right:  rb.left + bbox.right  * rpw,
    bottom: rb.top  + bbox.bottom * rph,
  };
}

function pointInSpace(sp, nx, ny) {
  if (sp.type === 'PointSpace' || sp.type === 'LineSpace') return false;
  const b = bboxRootNorm(sp.bbox, sp.parent_id);
  return nx >= b.left && nx <= b.right && ny >= b.top && ny <= b.bottom;
}

function spacesUnderPoint(nx, ny) {
  // Compute depth once per space, cache in map
  const depthMap = {};
  function getDepth(sp) {
    if (depthMap[sp.id] !== undefined) return depthMap[sp.id];
    let d = 0, cur = sp;
    while (cur.parent_id && S.spaces[cur.parent_id]) {
      d++;
      cur = S.spaces[cur.parent_id];
    }
    depthMap[sp.id] = d;
    return d;
  }

  const all = Object.values(S.spaces).filter(sp => pointInSpace(sp, nx, ny));

  // Sort: deepest (youngest child) first, then by area ascending (smaller box on top)
  all.sort((a, b) => {
    const dd = getDepth(b) - getDepth(a);
    if (dd !== 0) return dd;
    // Same depth — prefer smaller area (tighter box = more specific)
    const areaA = (a.bbox.right - a.bbox.left) * (a.bbox.bottom - a.bbox.top);
    const areaB = (b.bbox.right - b.bbox.left) * (b.bbox.bottom - b.bbox.top);
    return areaA - areaB;
  });

  return all.map(sp => sp.id);
}

function ptRootNorm(pt, parentId) {
  if (!parentId) return pt;
  const ps = S.spaces[parentId]; if (!ps?.bbox) return pt;
  const rb = bboxRootNorm(ps.bbox, ps.parent_id);
  const rpw = rb.right-rb.left, rph = rb.bottom-rb.top;
  return { x: rb.left + pt.x * rpw, y: rb.top + pt.y * rph };
}
function bboxToParentRel(rootBbox, parentId) {
  if (!parentId) return round5Bbox(rootBbox);
  const ps = S.spaces[parentId]; if (!ps?.bbox) return round5Bbox(rootBbox);
  const prb = bboxRootNorm(ps.bbox, ps.parent_id);
  const pw = prb.right-prb.left, ph = prb.bottom-prb.top;
  if (!pw || !ph) return round5Bbox(rootBbox);
  return round5Bbox({
    left:   (rootBbox.left   - prb.left) / pw,
    top:    (rootBbox.top    - prb.top)  / ph,
    right:  (rootBbox.right  - prb.left) / pw,
    bottom: (rootBbox.bottom - prb.top)  / ph,
  });
}
function ptToParentRel(rootPt, parentId) {
  if (!parentId) return {x:r5(rootPt.x), y:r5(rootPt.y)};
  const ps = S.spaces[parentId]; if (!ps?.bbox) return {x:r5(rootPt.x), y:r5(rootPt.y)};
  const prb = bboxRootNorm(ps.bbox, ps.parent_id);
  const pw = prb.right-prb.left, ph = prb.bottom-prb.top;
  if (!pw || !ph) return {x:r5(rootPt.x), y:r5(rootPt.y)};
  return { x: r5((rootPt.x - prb.left)/pw), y: r5((rootPt.y - prb.top)/ph) };
}
function round5Bbox(b) { return {left:r5(b.left),top:r5(b.top),right:r5(b.right),bottom:r5(b.bottom)}; }
function r5(v) { return Math.round(v*100000)/100000; }
function c01(v) { return Math.max(0, Math.min(1, v)); }

// ════════════════════════════════════════════════════════════════
// CANVAS EVENTS
// ════════════════════════════════════════════════════════════════
let draw = {on:false, sx:0, sy:0};
let pan  = {on:false, sx:0, sy:0, ox:0, oy:0};
let drag = {on:false, id:null, sx:0, sy:0, isPt:false,
            ol:0, ot:0, or:0, ob:0, ox:0, oy:0};
let rsz  = {on:false, id:null, h:'', sx:0, sy:0, ob:null};
let vecDraw = {on:false, sx:0, sy:0};          // LineSpace draw preview
let vecDrag = {on:false, id:null, handle:'', srx:0, sry:0, erx:0, ery:0}; // handle drag
let pendingDrag = null;  // potential drag waiting for movement threshold (3px)

// RAF-batched annotation render — avoids multiple redraws per frame during drag
let _rafAnno = null;
function scheduleAnnotations() {
  if (_rafAnno) return;
  _rafAnno = requestAnimationFrame(() => { _rafAnno = null; renderAnnotations(); });
}

let clickCycleState = {
  x: -1, y: -1,
  stack: [],
  idx: 0,
};

function setupCanvas() {
  const c = document.getElementById('canvas-container');
  // Capture phase: intercept resize-handle clicks BEFORE they reach spaceMD
  c.addEventListener('mousedown', onMD_capture, true);
  c.addEventListener('mousedown', onMD, false);
  c.addEventListener('contextmenu', e=>e.preventDefault());
  document.addEventListener('mousemove', onMM);
  document.addEventListener('mouseup',   onMU);
  c.addEventListener('wheel', onWheel, {passive:false});
}

// Capture-phase handler: intercept resize-handle / offset-handle clicks BEFORE spaceMD / onMD
function onMD_capture(e) {
  if (_BP.active) return;           // BP overlay handles its own capture events
  if (ocrState.active) return;   // let ocrMD (also capture phase, added later) handle it
  if (e.button !== 0) return;
  const tg = e.target;

  // ── Offset-alignment drag handles (SVG circles with data-ofs-sp) ──
  const ofsSp = tg.getAttribute('data-ofs-sp');
  if (ofsSp) {
    // Property Panel Mode: block interaction with non-selected spaces
    if (S.propertyPanelMode && ofsSp !== S.selId) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const ofsIdx   = parseInt(tg.getAttribute('data-ofs-idx'), 10);
    const ofsAsset = parseInt(tg.getAttribute('data-ofs-asset') || '0', 10);
    offsetHandleMD(e, ofsSp, ofsIdx, ofsAsset);
    return;
  }

  // LineSpace handles
  if (tg.classList.contains('vec-handle') || tg.classList.contains('vec-body-handle')) {
    e.stopImmediatePropagation();
    const id = tg.dataset.spaceId;
    // Property Panel Mode: block interaction with non-selected spaces
    if (S.propertyPanelMode && id !== S.selId) return;
    const handle = tg.classList.contains('vec-body-handle') ? 'body' : tg.dataset.handle;
    const sp = S.spaces[id]; if (!sp) return;
    selectSpace(id, true);
    const rs = ptRootNorm(sp.start||{x:.2,y:.5}, sp.parent_id);
    const re = ptRootNorm(sp.end  ||{x:.8,y:.5}, sp.parent_id);
    vecDrag = {on:true, id, handle, srx:rs.x, sry:rs.y, erx:re.x, ery:re.y,
               sx:e.clientX, sy:e.clientY};
    snapshot();
    e.preventDefault(); return;
  }
  if (!tg.classList.contains('resize-handle')) return;
  const id = tg.dataset.spaceId, sp = S.spaces[id]; if (!sp) return;
  // Property Panel Mode: block interaction with non-selected spaces
  if (S.propertyPanelMode && id !== S.selId) return;
  e.stopImmediatePropagation();
  const rb = bboxRootNorm(sp.bbox, sp.parent_id);
  rsz = {on:true, id, h:tg.dataset.handle, sx:e.clientX, sy:e.clientY,
         ob:{left:rb.left, top:rb.top, right:rb.right, bottom:rb.bottom}};
  e.preventDefault();
}

function onMD(e) {
  if (!S.cur) return;
  if (_BP.active) return;           // BP overlay handles all mouse interaction
  if (ocrState.active) return;   // blocks pan, draw, point placement too

  // Middle mouse → pan (all modes)
  if (e.button === 1) {
    pan = {on:true, sx:e.clientX, sy:e.clientY, ox:S.panX, oy:S.panY};
    document.getElementById('canvas-container').classList.add('panning');
    e.preventDefault();
    return;
  }

  const tg = e.target;
  const _d = docXY(e.clientX, e.clientY);
  const nx = _d.x / W();
  const ny = _d.y / H();

  // resize-handle clicks are handled in capture phase (onMD_capture) — skip here
  if (tg.classList.contains('resize-handle')) return;

  // PointSpace dots — kept as direct handler since points aren’t in spacesUnderPoint
  if (S.mode === 'select' && tg.classList.contains('anno-point')) {
    const id = tg.dataset.spaceId, sp = S.spaces[id]; if (!sp) return;
    // Property Panel Mode: block interaction with non-selected spaces
    if (S.propertyPanelMode && id !== S.selId) return;
    selectSpace(id);
    const rp = ptRootNorm(sp.point, sp.parent_id);
    drag = {on:true, id, sx:e.clientX, sy:e.clientY, isPt:true, ox:rp.x, oy:rp.y};
    e.stopPropagation(); return;
  }

  if (S.mode === 'bbox' || S.mode === 'volume') {
    const d = docXY(e.clientX, e.clientY);
    draw = {on:true, sx:d.x, sy:d.y, mode:S.mode};
    const dr = document.getElementById('draw-rect'); dr.style.display='block';
    updDrawRect(d.x,d.y,d.x,d.y); return;
  }
  if (S.mode === 'point') {
    const d = docXY(e.clientX, e.clientY);
    placePoint(d.x/W(), d.y/H()); return;
  }
  if (S.mode === 'vector') {
    const d = docXY(e.clientX, e.clientY);
    vecDraw = {on:true, sx:d.x, sy:d.y};
    // Show draw-rect as a thin line indicator (reuse element briefly)
    const dr = document.getElementById('draw-rect');
    dr.style.display='block'; dr.style.height='2px';
    updDrawRect(d.x, d.y, d.x+1, d.y+1); return;
  }

  if (S.mode === 'select') {
    const rx    = Math.round(nx * 1000);
    const ry    = Math.round(ny * 1000);

    // Build stack sorted: deepest/youngest child first
    const stack = spacesUnderPoint(nx, ny);

    if (stack.length === 0) {
      selectSpace(null);
      clickCycleState = { x:-1, y:-1, stack:[], idx:0 };
      pendingDrag = null;
      return;
    }

    const sameSpot =
      rx === clickCycleState.x &&
      ry === clickCycleState.y &&
      stack.length === clickCycleState.stack.length &&
      stack.every((id, i) => id === clickCycleState.stack[i]);

    if (sameSpot) {
      // Cycle towards parent on repeated clicks at same spot
      clickCycleState.idx = (clickCycleState.idx + 1) % stack.length;
    } else {
      // Fresh click — always start at index 0 = topmost/youngest child
      clickCycleState = { x:rx, y:ry, stack, idx:0 };
    }

    const selId = stack[clickCycleState.idx];
    // Property Panel Mode: block selecting different spaces
    if (S.propertyPanelMode && selId !== S.selId) return;
    selectSpace(selId, true);

    // Arm a pending drag — only converts to real drag if mouse moves >3px (see onMM)
    const selSp = S.spaces[selId];
    if (selSp) {
      const rb = bboxRootNorm(selSp.bbox, selSp.parent_id);
      pendingDrag = {id:selId, sx:e.clientX, sy:e.clientY, isPt:false,
                    ol:rb.left, ot:rb.top, or:rb.right, ob2:rb.bottom};
    }
    e.stopPropagation();
    return;
  }
}

function onMM(e) {
  // Threshold drag: convert pendingDrag to real drag after >3px movement
  if (pendingDrag) {
    const mdx = e.clientX - pendingDrag.sx, mdy = e.clientY - pendingDrag.sy;
    if (Math.abs(mdx) > 3 || Math.abs(mdy) > 3) {
      snapshot();  // snapshot right before drag actually starts
      drag = {on:true, ...pendingDrag};
      pendingDrag = null;
    } else {
      return;
    }
  }

  if (pan.on) {
    S.panX = pan.ox + (e.clientX - pan.sx);
    S.panY = pan.oy + (e.clientY - pan.sy);
    applyT(); return;
  }
  if (vecDraw.on) {
    const d = docXY(e.clientX, e.clientY);
    updDrawRect(vecDraw.sx, vecDraw.sy, d.x, d.y); return;
  }
  if (vecDrag.on) {
    const sp = S.spaces[vecDrag.id]; if (!sp) return;
    const ddx = (e.clientX - vecDrag.sx) / S.zoom / W();
    const ddy = (e.clientY - vecDrag.sy) / S.zoom / H();
    let newSrx = vecDrag.srx, newSry = vecDrag.sry;
    let newErx = vecDrag.erx, newEry = vecDrag.ery;
    if (vecDrag.handle === 'start') {
      newSrx = c01(vecDrag.srx + ddx); newSry = c01(vecDrag.sry + ddy);
    } else if (vecDrag.handle === 'end') {
      newErx = c01(vecDrag.erx + ddx); newEry = c01(vecDrag.ery + ddy);
    } else if (vecDrag.handle === 'body') {
      newSrx = c01(vecDrag.srx + ddx); newSry = c01(vecDrag.sry + ddy);
      newErx = c01(vecDrag.erx + ddx); newEry = c01(vecDrag.ery + ddy);
    }
    // Snap endpoints to horizontal or vertical (not for body drag)
    if (vecDrag.handle !== 'body') {
      const angDeg = Math.atan2(newEry - newSry, newErx - newSrx) * 180 / Math.PI;
      const absAng = Math.abs(angDeg);
      if (absAng < 45 || absAng > 135) {
        // Snap horizontal: fix dragged point's Y to the other endpoint's Y
        if (vecDrag.handle === 'start') newSry = vecDrag.ery;
        else                             newEry = vecDrag.sry;
        // Auto-align X axis of LineSpace to parent x direction
        if (newErx >= newSrx) { if (sp.axes[0] !== 'x')     { sp.axes[0] = 'x';     syncLegacyAxes(sp); } }
        else                  { if (sp.axes[0] !== 'inv_x') { sp.axes[0] = 'inv_x'; syncLegacyAxes(sp); } }
      } else {
        // Snap vertical: fix dragged point's X to the other endpoint's X
        if (vecDrag.handle === 'start') newSrx = vecDrag.erx;
        else                             newErx = vecDrag.srx;
        // Auto-align X axis of LineSpace to parent y direction
        if (newEry >= newSry) { if (sp.axes[0] !== 'y')     { sp.axes[0] = 'y';     syncLegacyAxes(sp); } }
        else                  { if (sp.axes[0] !== 'inv_y') { sp.axes[0] = 'inv_y'; syncLegacyAxes(sp); } }
      }
    }
    sp.start = ptToParentRel({x: newSrx, y: newSry}, sp.parent_id);
    sp.end   = ptToParentRel({x: newErx, y: newEry}, sp.parent_id);
    S.dirty = true; scheduleAnnotations(); return;
  }
  if (draw.on) {
    const d = docXY(e.clientX, e.clientY);
    updDrawRect(draw.sx, draw.sy, d.x, d.y); return;
  }
  if (drag.on) {
    const sp = S.spaces[drag.id]; if (!sp) return;
    const dx = (e.clientX - drag.sx) / S.zoom / W();
    const dy = (e.clientY - drag.sy) / S.zoom / H();
    if (drag.isPt) {
      const rp = {x:c01(drag.ox+dx), y:c01(drag.oy+dy)};
      sp.point = ptToParentRel(rp, sp.parent_id);
    } else {
      const bw = drag.or - drag.ol, bh = drag.ob2 - drag.ot;
      const rb = {left:c01(drag.ol+dx), top:c01(drag.ot+dy), right:c01(drag.ol+dx+bw), bottom:c01(drag.ot+dy+bh)};
      sp.bbox = bboxToParentRel(rb, sp.parent_id);
    }
    S.dirty = true; scheduleAnnotations(); return;  // panel refreshed on mouseup
  }
  if (rsz.on) {
    const sp = S.spaces[rsz.id]; if (!sp) return;
    const dx = (e.clientX - rsz.sx) / S.zoom / W();
    const dy = (e.clientY - rsz.sy) / S.zoom / H();
    const ob = rsz.ob, rb = {...ob};
    if (rsz.h==='nw') { rb.left=c01(ob.left+dx); rb.top=c01(ob.top+dy); }
    if (rsz.h==='ne') { rb.right=c01(ob.right+dx); rb.top=c01(ob.top+dy); }
    if (rsz.h==='sw') { rb.left=c01(ob.left+dx); rb.bottom=c01(ob.bottom+dy); }
    if (rsz.h==='se') { rb.right=c01(ob.right+dx); rb.bottom=c01(ob.bottom+dy); }
    sp.bbox = bboxToParentRel(rb, sp.parent_id);
    S.dirty = true; scheduleAnnotations(); return;  // panel refreshed on mouseup
  }
}

function onMU(e) {
  pendingDrag = null;  // cancel any pending drag that didn’t become a real drag
  document.getElementById('canvas-container').classList.remove('panning');
  if (pan.on)  { pan.on=false; return; }
  if (drag.on) { drag.on=false; snapshot(); renderAnnotations(); renderSpacesPanel(); autoSave(); return; }
  if (rsz.on)  { rsz.on=false; snapshot(); renderAnnotations(); renderSpacesPanel(); autoSave(); return; }
  if (vecDrag.on) { vecDrag.on=false; snapshot(); renderAnnotations(); renderSpacesPanel(); autoSave(); return; }
  if (vecDraw.on) {
    vecDraw.on = false;
    document.getElementById('draw-rect').style.display = 'none';
    document.getElementById('draw-rect').style.height = '';
    const d = docXY(e.clientX, e.clientY);
    const dx = Math.abs(d.x - vecDraw.sx), dy = Math.abs(d.y - vecDraw.sy);
    if (dx < 3 && dy < 3) { setMode('select'); return; }
    const _dvx = d.x - vecDraw.sx, _dvy = d.y - vecDraw.sy;
    const _absAng = Math.abs(Math.atan2(_dvy, _dvx) * 180 / Math.PI);
    let _x2 = d.x, _y2 = d.y;
    if (_absAng < 45 || _absAng > 135) { _y2 = vecDraw.sy; } // snap horizontal
    else                               { _x2 = vecDraw.sx; } // snap vertical
    placeVector(vecDraw.sx/W(), vecDraw.sy/H(), _x2/W(), _y2/H(), null);
    return;
  }
  if (draw.on) {
    draw.on = false;
    document.getElementById('draw-rect').style.display = 'none';
    const d = docXY(e.clientX, e.clientY);
    const x1=Math.min(draw.sx,d.x), y1=Math.min(draw.sy,d.y);
    const x2=Math.max(draw.sx,d.x), y2=Math.max(draw.sy,d.y);
    if ((x2-x1)<5 || (y2-y1)<5) return;
    const rb = {left:c01(x1/W()), top:c01(y1/H()), right:c01(x2/W()), bottom:c01(y2/H())};
    if (draw.mode === 'volume') createVolumeSpace(rb, null);
    else createDocSpace(rb, null);
  }
}

function onWheel(e) {
  if (_BP.active) return;           // BP overlay handles its own scroll zoom
  e.preventDefault();
  const c = document.getElementById('canvas-container'), r = c.getBoundingClientRect();
  const mx=e.clientX-r.left, my=e.clientY-r.top;
  const f = e.deltaY<0 ? 1.1 : 0.9;
  const nz = Math.max(.05, Math.min(8, S.zoom*f));
  S.panX = mx - (mx-S.panX)*(nz/S.zoom);
  S.panY = my - (my-S.panY)*(nz/S.zoom);
  S.zoom = nz; applyT();
}

function updDrawRect(x1,y1,x2,y2) {
  const dr = document.getElementById('draw-rect');
  dr.style.left   = (Math.min(x1,x2)*S.zoom+S.panX)+'px';
  dr.style.top    = (Math.min(y1,y2)*S.zoom+S.panY)+'px';
  dr.style.width  = Math.abs(x2-x1)*S.zoom+'px';
  dr.style.height = Math.abs(y2-y1)*S.zoom+'px';
}

// ════════════════════════════════════════════════════════════════
// SPACE CREATION
// ════════════════════════════════════════════════════════════════
function genId() { return 'sp_'+Math.random().toString(36).substr(2,9); }
function nextName(type, parentId) {
  const sib = Object.values(S.spaces).filter(s=>s.parent_id===(parentId||null)&&s.type===type);
  const prefix = type==='PointSpace' ? 'PointSpace' : type==='LineSpace' ? 'LineSpace' : type==='VolumeSpace' ? 'VolSpace' : 'DocSpace';
  const letter = String.fromCharCode(65+sib.length);
  if (parentId && S.spaces[parentId]) {
    return S.spaces[parentId].name + '_' + prefix + '_' + letter;
  }
  return prefix+'_'+letter;
}

function createDocSpace(rootBbox, parentId) {
  if (!S.cur) return;
  snapshot();
  const id = genId();
  S.spaces[id] = {
    id, type:'DocumentSpace',
    created_at: Date.now(),
    name: nextName('DocumentSpace', parentId||null),
    parent_id: parentId||null,
    bbox: bboxToParentRel(rootBbox, parentId||null),
    origin:'top_left',
    axes: ['x','y'],
    x_axis:'x', y_axis:'y'
  };
  S.dirty=true; selectSpace(id);
  renderAnnotations(); renderSpacesPanel(); autoSave();
}

function createVolumeSpace(rootBbox, parentId) {
  if (!S.cur) return;
  snapshot();
  const id = genId();
  S.spaces[id] = {
    id, type:'VolumeSpace',
    created_at: Date.now(),
    name: nextName('VolumeSpace', parentId||null),
    parent_id: parentId||null,
    bbox: bboxToParentRel(rootBbox, parentId||null),
    origin:'top_left',
    axes: ['x','y'],
    x_axis:'x', y_axis:'y'
  };
  S.dirty=true; selectSpace(id);
  renderAnnotations(); renderSpacesPanel(); autoSave();
}

function createRootDocSpace() {
  createDocSpace({left:.1,top:.1,right:.6,bottom:.6}, null);
}

function placePoint(nx, ny, parentId) {
  if (!S.cur) return;
  snapshot();
  const id = genId();
  S.spaces[id] = {
    id, type:'PointSpace',
    created_at: Date.now(),
    name: nextName('PointSpace', parentId||null),
    parent_id: parentId||null,
    point: { ...ptToParentRel({x:nx,y:ny}, parentId||null) },
    origin:'center',
    axes: ['x'],
    src_axes: ['x'],
    x_axis:'x', y_axis:'y'
  };
  S.dirty=true; selectSpace(id);
  renderAnnotations(); renderSpacesPanel(); autoSave();
}

function placeVector(nx1, ny1, nx2, ny2, parentId) {
  if (!S.cur) return;
  snapshot();
  const id = genId();
  // Auto-detect initial axis alignment from the line's direction
  const adx = nx2 - nx1, ady = ny2 - ny1;
  const absAng = Math.abs(Math.atan2(ady, adx) * 180 / Math.PI);
  const initAxis = (absAng < 45 || absAng > 135)
    ? (nx2 >= nx1 ? 'x' : 'inv_x')  // horizontal
    : (ny2 >= ny1 ? 'y' : 'inv_y'); // vertical
  S.spaces[id] = {
    id, type:'LineSpace',
    created_at: Date.now(),
    name: nextName('LineSpace', parentId||null),
    parent_id: parentId||null,
    start: { ...ptToParentRel({x:nx1, y:ny1}, parentId||null), z: 0.5 },
    end:   { ...ptToParentRel({x:nx2, y:ny2}, parentId||null), z: 0.5 },
    dashed: true,
    axes:     [initAxis],
    src_axes: ['X'],
    comment: ''
  };
  S.dirty=true; selectSpace(id);
  renderAnnotations(); renderSpacesPanel(); autoSave();
}

function vecHandleMD(e, id, handle) {
  if (e.button !== 0) return;
  e.stopPropagation();
  selectSpace(id, true);
}

function vecBodyMD(e, id) {
  if (e.button !== 0) return;
  e.stopPropagation();
  selectSpace(id, true);
}

function syncLegacyAxes(sp) {
  const axes = sp.axes || ['x','y'];
  sp.x_axis = axes[0] || 'x';
  sp.y_axis = axes[1] || 'y';
  sp.z_axis = axes[2] || null;
}

function axisToAssetLabel(code) {
  const map = {
    'x':     'Rear',  'inv_x': 'Front',
    'y':     'Left',  'inv_y': 'Right',
    'z':     'Top',   'inv_z': 'Bottom',
  };
  return map[code] || code;
}

// ════════════════════════════════════════════════════════════════
// TOPOLOGICAL NATURAL LANGUAGE LABELS FOR COORDINATES
// ════════════════════════════════════════════════════════════════
function topoLabel(val, axis, isAsset) {
  const v = parseFloat(val);
  if (isNaN(v)) return '';
  if (!isAsset) {
    // File / Screen context
    if (axis === 'x') return v < 0.33 ? 'left' : v < 0.66 ? 'transversalCenter' : 'right';
    if (axis === 'y') return v < 0.33 ? 'top'  : v < 0.66 ? 'verticalCenter'    : 'bottom';
    // z in screen context → asset depth
    if (axis === 'z') return v < 0.33 ? 'bottom' : v < 0.66 ? 'verticalCenter' : 'top';
  } else {
    // Asset context
    if (axis === 'x') return v < 0.33 ? 'front'  : v < 0.66 ? 'longitudinalCenter' : 'rear';
    if (axis === 'y') return v < 0.33 ? 'right'  : v < 0.66 ? 'transversalCenter'  : 'left';
    if (axis === 'z') return v < 0.33 ? 'bottom' : v < 0.66 ? 'verticalCenter'     : 'top';
  }
  return '';
}

const AXIS_OPTIONS = [
  ['x','x'], ['inv_x','inv x'],
  ['y','y'], ['inv_y','inv y'],
  ['z','z'], ['inv_z','inv z'],
];

function addChildSpace(type, parentId) {
  const sp = S.spaces[parentId]; if (!sp) return;
  // For PointSpace parent: use the point position as anchor
  if (sp.type === 'PointSpace') {
    const rp = ptRootNorm(sp.point || {x:0.5, y:0.5}, sp.parent_id);
    if (type === 'PointSpace') {
      placePoint(rp.x, rp.y, parentId);
    } else if (type === 'LineSpace') {
      const hw = 0.05;
      placeVector(c01(rp.x - hw), rp.y, c01(rp.x + hw), rp.y, parentId);
    } else {
      const inset = 0.05;
      const bbox = {
        left: c01(rp.x - inset), top: c01(rp.y - inset),
        right: c01(rp.x + inset), bottom: c01(rp.y + inset),
      };
      if (type === 'VolumeSpace') createVolumeSpace(bbox, parentId);
      else createDocSpace(bbox, parentId);
    }
    return;
  }
  // For LineSpace parent: use the line midpoint and direction
  if (sp.type === 'LineSpace') {
    const s = ptRootNorm(sp.start || {x:0.3, y:0.5}, sp.parent_id);
    const e = ptRootNorm(sp.end || {x:0.7, y:0.5}, sp.parent_id);
    const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2;
    if (type === 'PointSpace') {
      placePoint(mx, my, parentId);
    } else if (type === 'LineSpace') {
      const dx = e.x - s.x, dy = e.y - s.y;
      const len = Math.sqrt(dx*dx + dy*dy) * 0.5;
      const nx = dx / (Math.sqrt(dx*dx + dy*dy) || 1);
      const ny = dy / (Math.sqrt(dx*dx + dy*dy) || 1);
      placeVector(c01(mx - nx*len), c01(my - ny*len), c01(mx + nx*len), c01(my + ny*len), parentId);
    } else {
      const inset = 0.08;
      const bbox = {
        left: c01(mx - inset), top: c01(my - inset),
        right: c01(mx + inset), bottom: c01(my + inset),
      };
      if (type === 'VolumeSpace') createVolumeSpace(bbox, parentId);
      else createDocSpace(bbox, parentId);
    }
    return;
  }
  // For area spaces (DocumentSpace, VolumeSpace): use bbox
  if (type==='PointSpace') {
    const rb = bboxRootNorm(sp.bbox, sp.parent_id);
    placePoint((rb.left+rb.right)/2, (rb.top+rb.bottom)/2, parentId);
  } else if (type==='LineSpace') {
    const rb = bboxRootNorm(sp.bbox, sp.parent_id);
    const mx=(rb.left+rb.right)/2, my=(rb.top+rb.bottom)/2;
    const hw=(rb.right-rb.left)*0.3;
    placeVector(mx-hw, my, mx+hw, my, parentId);
  } else {
    const rb = bboxRootNorm(sp.bbox||{left:.05,top:.05,right:.5,bottom:.5}, sp.parent_id);
    const inset = 0.12;
    const child = {
      left:   rb.left + (rb.right-rb.left)*inset,
      top:    rb.top  + (rb.bottom-rb.top)*inset,
      right:  rb.left + (rb.right-rb.left)*(1-inset),
      bottom: rb.top  + (rb.bottom-rb.top)*(1-inset),
    };
    if (type === 'VolumeSpace') createVolumeSpace(child, parentId);
    else createDocSpace(child, parentId);
  }
}

function deleteSpaceById(id) {
  snapshot();
  function del(sid) {
    Object.values(S.spaces).filter(s=>s.parent_id===sid).forEach(c=>del(c.id));
    delete S.spaces[sid];
  }
  del(id);
  if (S.selId===id) S.selId=null;
  S.dirty=true;
  renderAnnotations(); renderSpacesPanel(); autoSave();
}

// ════════════════════════════════════════════════════════════════
// SELECTION
// ════════════════════════════════════════════════════════════════
function selectSpace(id, fromViewer = false) {
  if (!fromViewer) {
    clickCycleState = { x:-1, y:-1, stack:[], idx:0 };
  }
  S.selId = id;
  // Expand the card only when triggered from the viewer canvas
  const wasCollapsed = id && fromViewer && collapsedSpaces.has(id);
  if (wasCollapsed) collapsedSpaces.delete(id);
  renderAnnotations();
  if (wasCollapsed) {
    // full re-render needed to show the body
    renderSpacesPanel();
  } else {
    // highlight correct card
    document.querySelectorAll('.space-card').forEach(el=>
      el.classList.toggle('selected-card', el.dataset.spaceId===id));
  }
  // scroll card into view
  if (id) {
    const card = document.querySelector(`.space-card[data-space-id="${id}"]`);
    if (card) card.scrollIntoView({block:'center', behavior:'smooth'});
  }
}

// ════════════════════════════════════════════════════════════════
// ANNOTATION RENDERING
// ════════════════════════════════════════════════════════════════
function originPxInBox(sp, bw, bh) {
  const o = sp.origin||'top_left';
  return {
    ox: (o==='top_right'||o==='bottom_right') ? bw : 0,
    oy: (o==='bottom_left'||o==='bottom_right') ? bh : 0,
  };
}

// Recursively compute screen [dx,dy] for an axis code in the coord frame of a space's parent.
// code: 'x','inv_x','y','inv_y','z','inv_z'  ctxId: parent space id (null = root doc)
function getAxisCodeScreenDir(code, ctxId) {
  const ROOT = {
    'x':[1,0],'inv_x':[-1,0],
    'y':[0,1],'inv_y':[0,-1],
    'z':[0.6,0.6],'inv_z':[-0.6,-0.6],
  };
  if (!ctxId || !S.spaces[ctxId]) return ROOT[code] || [1,0];
  const sp = S.spaces[ctxId];
  const inv = code.startsWith('inv_');
  const base = code.replace('inv_','');
  const tgtAxes = sp.axes || ['x','y'];
  const srcAxes = sp.src_axes || tgtAxes.map((_,i)=>['X','Y','Z'][i]||'X');
  const idx = srcAxes.findIndex(n => n && n.toLowerCase() === base);
  if (idx >= 0 && idx < tgtAxes.length) {
    const d = getAxisCodeScreenDir(tgtAxes[idx], sp.parent_id);
    return inv ? [-d[0],-d[1]] : d;
  }
  return ROOT[code] || [1,0];
}

// axisSVG: generates a full-canvas SVG overlay for axis arrows (placed directly in anno-layer,
// NOT inside the .anno-space div — so circles at arrow tips are always within the SVG hit-box).
// absOX, absOY: axis origin in canvas-pixel coordinates (absolute, not bbox-relative).
function axisSVG(sp, absOX, absOY, bw, bh, dimStyle='') {
  const al = Math.min(bw*.35, bh*.35, 120, Math.max(bw, bh)*.25) * 1;
  if (al < 8) return '';

  // Color keyed on source axis name: x→red, y→green, z→blue, other→grey
  const srcColor = srcAxisColor;

  const arw = (x1,y1,x2,y2,c,lbl,dashed,offsetOn,spId,axIdx,isAsset) => {
    const dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy)||1;
    const ux=dx/len, uy=dy/len, hw=6, hl=10;
    const dash = dashed ? 'stroke-dasharray="8,4"' : '';
    if (offsetOn) {
      return `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
            stroke="${c}" stroke-width="2" stroke-opacity="1" ${dash} pointer-events="none"/>
      <circle cx="${x2}" cy="${y2}" r="7"
              fill="${c}" stroke="#fff" stroke-width="1.5"
              style="cursor:grab;pointer-events:all"
              data-ofs-sp="${spId}" data-ofs-idx="${axIdx}" data-ofs-asset="${isAsset?1:0}"/>
      <text x="${x2+ux*20}" y="${y2+uy*20}"
            font-size="16" font-family="IBM Plex Mono,monospace"
            fill="${c}" dominant-baseline="middle" text-anchor="middle"
            font-weight="600" pointer-events="none">${lbl}</text>`;
    }
    const p1x=x2-ux*hl+uy*hw, p1y=y2-uy*hl-ux*hw;
    const p2x=x2-ux*hl-uy*hw, p2y=y2-uy*hl+ux*hw;
    const lx2=x2-ux*hl, ly2=y2-uy*hl; // line ends at arrowhead base
    return `
      <line x1="${x1}" y1="${y1}" x2="${lx2}" y2="${ly2}"
            stroke="${c}" stroke-width="2" stroke-opacity="1" ${dash} pointer-events="none"/>
      <polygon points="${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}"
               fill="${c}" fill-opacity="1" pointer-events="none"/>
      <text x="${x2+ux*16}" y="${y2+uy*16}"
            font-size="16" font-family="IBM Plex Mono,monospace"
            fill="${c}" dominant-baseline="middle" text-anchor="middle"
            font-weight="600" pointer-events="none">${lbl}</text>`;
  };

  // Use sp.axes (target codes) and sp.src_axes (source labels)
  const axes    = sp.axes || [];
  const srcAxes = sp.src_axes || axes.map((_,i)=>['x','y','z'][i]||'x');
  if (axes.length === 0 && !(sp.target_asset && (sp.asset_axes||[]).length)) return '';

  let svgContent = '';
  axes.forEach((tgtVal, idx) => {
    const srcName = (srcAxes[idx] || ['x','y','z'][idx] || '?').toLowerCase();
    // Direction: trace the target code through the parent chain
    let [dx, dy] = getAxisCodeScreenDir(tgtVal, sp.parent_id);
    const len = Math.sqrt(dx*dx+dy*dy)||1;
    dx /= len; dy /= len;
    // Apply offset rotation: CCW positive (standard math), screen y is down
    const offsetOn = false; // DISABLED — /* !!(sp.axis_offset_on && sp.axis_offset_on[idx]) */
    if (offsetOn) {  // offset angle branch kept for future restore (offsetOn is always false)
      const offsetDeg = (sp.axis_offsets && sp.axis_offsets[idx]) || 0;
      const offsetRad = offsetDeg * Math.PI / 180;
      const cosA = Math.cos(offsetRad), sinA = Math.sin(offsetRad);
      const newDx = dx * cosA + dy * sinA;
      const newDy = dy * cosA - dx * sinA;
      dx = newDx; dy = newDy;
    }
    // Use custom handle length if set, otherwise default to al
    const handleLen = (sp.axis_handle_lengths && sp.axis_handle_lengths[idx]) || al;
    const tipX = absOX + dx*handleLen;
    const tipY = absOY + dy*handleLen;
    const lbl = srcName;
    const dashed = tgtVal === 'inv_z';
    svgContent += arw(absOX, absOY, tipX, tipY, srcColor(srcName), lbl, dashed, offsetOn, sp.id, idx, 0);
  });

  // Asset axes (when TargetAsset ON) — drawn shorter + dashed to distinguish from parent axes
  if (sp.target_asset) {
    const asAxes    = sp.asset_axes    || [];
    const asSrcAxes = sp.asset_src_axes || asAxes.map((_,i)=>['x','y','z'][i]||'x');
    const asAl = al * 0.72; // slightly shorter than parent axes (default)
    asAxes.forEach((tgtVal, idx) => {
      const srcName = (asSrcAxes[idx] || ['x','y','z'][idx] || '?').toLowerCase();
      let [dx, dy] = getAxisCodeScreenDir(tgtVal, null); // asset → document root directions
      const len = Math.sqrt(dx*dx+dy*dy)||1;
      dx /= len; dy /= len;
      const offsetOn = false; // DISABLED — /* !!(sp.asset_axis_offset_on && sp.asset_axis_offset_on[idx]) */
      if (offsetOn) {  // asset offset angle branch kept for future restore (offsetOn is always false)
        const offsetDeg = (sp.asset_axis_offsets && sp.asset_axis_offsets[idx]) || 0;
        const offsetRad = offsetDeg * Math.PI / 180;
        const cosA = Math.cos(offsetRad), sinA = Math.sin(offsetRad);
        const newDx = dx * cosA + dy * sinA;
        const newDy = dy * cosA - dx * sinA;
        dx = newDx; dy = newDy;
      }
      // Use custom handle length if set, otherwise default to asAl (72% of parent)
      const asHandleLen = (sp.asset_axis_handle_lengths && sp.asset_axis_handle_lengths[idx]) || asAl;
      const tipX = absOX + dx*asHandleLen;
      const tipY = absOY + dy*asHandleLen;
      svgContent += arw(absOX, absOY, tipX, tipY, srcColor(srcName), srcName, true, offsetOn, sp.id, idx, 1);
    });
  }

  if (!svgContent) return '';

  // SVG is placed directly in anno-layer (full canvas size) so circles at arrow tips
  // are always within the SVG's CSS bounding box — ensuring reliable hit-testing.
  const hasAnyOffset = false; // DISABLED — /* (sp.axis_offset_on && sp.axis_offset_on.some(Boolean)) ||
                               //    (sp.asset_axis_offset_on && sp.asset_axis_offset_on.some(Boolean)) */
  const svgW = S.cur ? S.cur.width  : 8000;
  const svgH = S.cur ? S.cur.height : 8000;
  return `<svg xmlns="http://www.w3.org/2000/svg"
               style="${dimStyle}position:absolute;top:0;left:0;width:${svgW}px;height:${svgH}px;overflow:visible;z-index:8;pointer-events:${hasAnyOffset?'all':'none'}">${svgContent}</svg>`;
}

// BASE label font size in screen pixels (fixed reference)
const LABEL_BASE_PX = 13;
const LABEL_MAX_SCALE = 3.0; // never shrink below 1/3× zoom-compensated

// Update renderAnnotations() to render points with fixed screen size:
function renderAnnotations() {
  const layer = document.getElementById('anno-layer');
  if (!S.cur) { layer.innerHTML=''; document.getElementById('label-overlay').innerHTML=''; return; }
  layer.style.width  = S.cur.width+'px';
  layer.style.height = S.cur.height+'px';
  let html = '';
  for (const [id,sp] of Object.entries(S.spaces)) {
    const c = colEff(id), sel = id===S.selId;
    // Property Panel Mode: only selected space is interactable
    const dimmed = S.propertyPanelMode && !sel;
    const dimStyle = dimmed ? 'opacity:0.3;' : '';
    if (sp.type==='PointSpace') {
      const rp = ptRootNorm(sp.point||{x:.5,y:.5}, sp.parent_id);
      const lx = rp.x * S.cur.width;
      const ty = rp.y * S.cur.height;
      const fixedSize = 12 * Math.min(LABEL_MAX_SCALE, Math.max(2/LABEL_BASE_PX*S.zoom, 1));
      const al = 70; // axis arrow length in doc-pixels
      const srcColor = srcAxisColor;
      const arw = (x1,y1,x2,y2,c,lbl,dashed,offsetOn,spId,axIdx) => {
        const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy)||1;
        const ux=dx/len,uy=dy/len,hw=6,hl=10;
        const dash = dashed ? 'stroke-dasharray="8,4"' : '';
        if (offsetOn) {
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="2" ${dash} pointer-events="none"/>` +
                 `<circle cx="${x2}" cy="${y2}" r="7" fill="${c}" stroke="#fff" stroke-width="1.5" style="cursor:grab;pointer-events:all" data-ofs-sp="${spId}" data-ofs-idx="${axIdx}" data-ofs-asset="0"/>` +
                 `<text x="${x2+ux*20}" y="${y2+uy*20}" font-size="16" font-family="IBM Plex Mono,monospace" fill="${c}" dominant-baseline="middle" text-anchor="middle" font-weight="600" pointer-events="none">${lbl}</text>`;
        }
        const p1x=x2-ux*hl+uy*hw,p1y=y2-uy*hl-ux*hw;
        const p2x=x2-ux*hl-uy*hw,p2y=y2-uy*hl+ux*hw;
        const lx2=x2-ux*hl, ly2=y2-uy*hl;
        return `<line x1="${x1}" y1="${y1}" x2="${lx2}" y2="${ly2}" stroke="${c}" stroke-width="2" ${dash} pointer-events="none"/>` +
               `<polygon points="${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}" fill="${c}" pointer-events="none"/>` +
               `<text x="${x2+ux*16}" y="${y2+uy*16}" font-size="16" font-family="IBM Plex Mono,monospace" fill="${c}" dominant-baseline="middle" text-anchor="middle" font-weight="600" pointer-events="none">${lbl}</text>`;
      };
      const ptAxes    = sp.axes || [];
      const ptSrcAxes = sp.src_axes || ptAxes.map((_,i)=>['x','y','z'][i]||'x');
      let ptArrows = '';
      ptAxes.forEach((tgtVal, idx) => {
        const srcName = (ptSrcAxes[idx] || ['x','y','z'][idx] || '?').toLowerCase();
        let [ddx,ddy] = getAxisCodeScreenDir(tgtVal, sp.parent_id);
        const dlen = Math.sqrt(ddx*ddx+ddy*ddy)||1;
        ddx/=dlen; ddy/=dlen;
        const ptOffsetOn = false; // DISABLED — /* !!(sp.axis_offset_on && sp.axis_offset_on[idx]) */
        if (ptOffsetOn) {  // offset angle branch kept for future restore (ptOffsetOn is always false)
          const offsetDeg = (sp.axis_offsets && sp.axis_offsets[idx]) || 0;
          const offsetRad = offsetDeg * Math.PI / 180;
          const cosA = Math.cos(offsetRad), sinA = Math.sin(offsetRad);
          const newDx = ddx * cosA + ddy * sinA;
          const newDy = ddy * cosA - ddx * sinA;
          ddx = newDx; ddy = newDy;
        }
        // Use custom handle length if set, otherwise default to 70
        const handleLen = (sp.axis_handle_lengths && sp.axis_handle_lengths[idx]) || al;
        ptArrows += arw(lx, ty, lx+ddx*handleLen, ty+ddy*handleLen, srcColor(srcName), srcName, tgtVal==='inv_z', ptOffsetOn, id, idx);
      });
      const ptHasOffset = false; // DISABLED — /* sp.axis_offset_on && sp.axis_offset_on.some(Boolean) */
      html += `<div class="anno-point${sel?' selected':''}" data-space-id="${id}"
        style="${dimStyle}left:${lx}px;top:${ty}px;background:${c};border-color:rgba(255,255,255,.85);width:${fixedSize}px;height:${fixedSize}px;transform:translate(-50%,-50%)"
        onmousedown="ptMD(event,'${id}')">
      </div>
      <svg style="${dimStyle}position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;z-index:12${ptHasOffset?'':';pointer-events:none'}" xmlns="http://www.w3.org/2000/svg">
        ${ptArrows}
      </svg>`;
    } else if (sp.type === 'LineSpace') {
      const lineIsZMode = sp.axes && (sp.axes[0] === 'z' || sp.axes[0] === 'inv_z');
      const rs = ptRootNorm(sp.start||{x:.2,y:.5}, sp.parent_id);
      const re2 = ptRootNorm(sp.end  ||{x:.8,y:.5}, sp.parent_id);
      const sx=rs.x*S.cur.width, sy=rs.y*S.cur.height;
      const ex=re2.x*S.cur.width, ey=re2.y*S.cur.height;
      const mx=(sx+ex)/2, my=(sy+ey)/2;
      if (lineIsZMode) {
        // Z-mode: render as a point at midpoint — line extends into/out of screen
        const fixedSize = 14;
        html += `
          <div class="anno-point${sel?' selected':''}" data-space-id="${id}"
               style="${dimStyle}left:${mx}px;top:${my}px;background:${c};border-color:rgba(255,255,255,.85);width:${fixedSize}px;height:${fixedSize}px;transform:translate(-50%,-50%);outline:3px solid ${c};outline-offset:3px"
               onmousedown="vecBodyMD(event,'${id}')"></div>`;
      } else {
      const dx=ex-sx, dy=ey-sy, len=Math.sqrt(dx*dx+dy*dy)||1;
      const ux=dx/len, uy=dy/len, hw=6, hl=12;
      const p1x=ex-ux*hl+uy*hw, p1y=ey-uy*hl-ux*hw;
      const p2x=ex-ux*hl-uy*hw, p2y=ey-uy*hl+ux*hw;
      const dashArr = sp.dashed ? '10,6' : 'none';
      const sw = sel ? 3 : 2;
      // Axis arrows for LineSpace anchored at midpoint
      const srcColorL = srcAxisColor;
      const alL = 60;
      const lineAxes    = sp.axes || [];
      const lineSrcAxes = sp.src_axes || lineAxes.map((_,i)=>['x','y','z'][i]||'x');
      let lineArrows = '';
      lineAxes.forEach((tgtVal, idx) => {
        const srcName = (lineSrcAxes[idx] || ['x','y','z'][idx] || '?').toLowerCase();
        let [ddx,ddy] = getAxisCodeScreenDir(tgtVal, sp.parent_id);
        const dlen = Math.sqrt(ddx*ddx+ddy*ddy)||1;
        ddx/=dlen; ddy/=dlen;
        const lineOffsetOn = false; // DISABLED — /* !!(sp.axis_offset_on && sp.axis_offset_on[idx]) */
        if (lineOffsetOn) {  // offset angle branch kept for future restore (lineOffsetOn is always false)
          const offsetDeg = (sp.axis_offsets && sp.axis_offsets[idx]) || 0;
          const offsetRad = offsetDeg * Math.PI / 180;
          const cosA = Math.cos(offsetRad), sinA = Math.sin(offsetRad);
          const newDx = ddx * cosA + ddy * sinA;
          const newDy = ddy * cosA - ddx * sinA;
          ddx = newDx; ddy = newDy;
        }
        // Use custom handle length if set, otherwise default to 60
        const handleLen = (sp.axis_handle_lengths && sp.axis_handle_lengths[idx]) || alL;
        const hw=6,hl=10;
        const tx=mx+ddx*handleLen, ty2=my+ddy*handleLen;
        const ux=ddx,uy=ddy;
        const dash = tgtVal==='inv_z' ? 'stroke-dasharray="8,4"' : '';
        if (lineOffsetOn) {
          lineArrows += `<line x1="${mx}" y1="${my}" x2="${tx}" y2="${ty2}" stroke="${srcColorL(srcName)}" stroke-width="2" ${dash} pointer-events="none"/>`+
            `<circle cx="${tx}" cy="${ty2}" r="7" fill="${srcColorL(srcName)}" stroke="#fff" stroke-width="1.5" style="cursor:grab;pointer-events:all" data-ofs-sp="${id}" data-ofs-idx="${idx}" data-ofs-asset="0"/>`+
            `<text x="${tx+ux*20}" y="${ty2+uy*20}" font-size="16" font-family="IBM Plex Mono,monospace" fill="${srcColorL(srcName)}" dominant-baseline="middle" text-anchor="middle" font-weight="600" pointer-events="none">${srcName}</text>`;
        } else {
          const p1x=tx-ux*hl+uy*hw,p1y=ty2-uy*hl-ux*hw;
          const p2x=tx-ux*hl-uy*hw,p2y=ty2-uy*hl+ux*hw;
          const lx2=tx-ux*hl, ly2=ty2-uy*hl;
          lineArrows += `<line x1="${mx}" y1="${my}" x2="${lx2}" y2="${ly2}" stroke="${srcColorL(srcName)}" stroke-width="2" ${dash} pointer-events="none"/>`+
            `<polygon points="${tx},${ty2} ${p1x},${p1y} ${p2x},${p2y}" fill="${srcColorL(srcName)}" pointer-events="none"/>`+
            `<text x="${tx+ux*16}" y="${ty2+uy*16}" font-size="16" font-family="IBM Plex Mono,monospace" fill="${srcColorL(srcName)}" dominant-baseline="middle" text-anchor="middle" font-weight="600" pointer-events="none">${srcName}</text>`;
        }
      });
      const lineHasOffset = false; // DISABLED — /* sp.axis_offset_on && sp.axis_offset_on.some(Boolean) */
      html += `
        <svg style="${dimStyle}position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;z-index:11${lineHasOffset?'':';pointer-events:none'}" xmlns="http://www.w3.org/2000/svg">
          <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${c}" stroke-width="${sw}" stroke-dasharray="${dashArr}" stroke-opacity="0.9" pointer-events="none"/>
          <polygon points="${ex},${ey} ${p1x},${p1y} ${p2x},${p2y}" fill="${c}" fill-opacity="0.9" pointer-events="none"/>
          ${lineArrows}
        </svg>
        <div class="vec-handle${sel?' selected':''}" data-space-id="${id}" data-handle="start"
             style="${dimStyle}left:${sx}px;top:${sy}px;background:${c}"
             onmousedown="vecHandleMD(event,'${id}','start')"></div>
        <div class="vec-handle${sel?' selected':''}" data-space-id="${id}" data-handle="end"
             style="${dimStyle}left:${ex}px;top:${ey}px;background:${c}"
             onmousedown="vecHandleMD(event,'${id}','end')"></div>
        ${sel ? `<div class="vec-body-handle" data-space-id="${id}"
             style="left:${mx}px;top:${my}px;background:${c}"
             onmousedown="vecBodyMD(event,'${id}')"></div>` : ''}`;
      } // end !lineIsZMode
    } else {
      const rb = bboxRootNorm(sp.bbox||{left:.05,top:.05,right:.5,bottom:.5}, sp.parent_id);
      const lx=rb.left*S.cur.width, ty=rb.top*S.cur.height;
      const bw=(rb.right-rb.left)*S.cur.width, bh=(rb.bottom-rb.top)*S.cur.height;
      const {ox,oy} = originPxInBox(sp, bw, bh);
      // axisSVG is appended AFTER the div (not inside) so circles at arrow tips remain
      // within the full-canvas SVG's hit-testing box and are always draggable.
      html += `<div class="anno-space${sel?' selected':''}" data-space-id="${id}"
        style="${dimStyle}left:${lx}px;top:${ty}px;width:${bw}px;height:${bh}px;border-color:${c};background:${c}11;border-width:${sel?3:2}px;border-style:${sp.dashed?'dashed':'solid'}"
        onmousedown="spaceMD(event,'${id}')">
        <div class="origin-dot" style="left:${ox}px;top:${oy}px;background:${c}"></div>
        ${sel?`
          <div class="resize-handle rh-nw" data-space-id="${id}" data-handle="nw"></div>
          <div class="resize-handle rh-ne" data-space-id="${id}" data-handle="ne"></div>
          <div class="resize-handle rh-sw" data-space-id="${id}" data-handle="sw"></div>
          <div class="resize-handle rh-se" data-space-id="${id}" data-handle="se"></div>
        `:''}
      </div>${axisSVG(sp, lx+ox, ty+oy, bw, bh, dimStyle)}`;
    }
  }
  layer.innerHTML = html;
  renderLabels();
}

function renderLabels() {
  const overlay = document.getElementById('label-overlay');
  if (!S.cur || !overlay) return;
  const cc = document.getElementById('canvas-container');
  const cr = cc.getBoundingClientRect();

  // Counter-scale: at zoom=1 use LABEL_BASE_PX. At zoom<1 keep same screen size.
  // At zoom>1 allow labels to grow up to LABEL_MAX_SCALE * LABEL_BASE_PX, then cap.
  // labelScreenPx = LABEL_BASE_PX (always fixed screen size) BUT cap growth:
  // If zoom > LABEL_MAX_SCALE, compensate: divide by zoom so rendered = LABEL_BASE_PX screen px
  // If zoom <= LABEL_MAX_SCALE, just use LABEL_BASE_PX (labels stay constant screen size)
  // In other words: labels are ALWAYS LABEL_BASE_PX screen pixels until zoom hits LABEL_MAX_SCALE,
  // at which point they scale with document (so max document-space size = LABEL_BASE_PX/LABEL_MAX_SCALE docpx)
  const labelDocPx = S.zoom <= LABEL_MAX_SCALE
    ? LABEL_BASE_PX / S.zoom          // compensate so screen size stays constant
    : LABEL_BASE_PX / LABEL_MAX_SCALE; // cap: at 3× zoom labels are 3× their base screen size

  let html = '';
  const _dark = isDarkMode();
  for (const [id,sp] of Object.entries(S.spaces)) {
    const c = _dark ? colDark(id) : col(id);
    if (sp.type==='PointSpace') {
      const rp = ptRootNorm(sp.point||{x:.5,y:.5}, sp.parent_id);
      const sx = S.panX + rp.x*S.cur.width*S.zoom;
      const sy = S.panY + rp.y*S.cur.height*S.zoom;
      const screenFontPx = Math.min(LABEL_BASE_PX, labelDocPx*S.zoom);
      const offset = 7 + screenFontPx*0.4;
      html += `<div class="screen-label" style="left:${sx+offset}px;top:${sy}px;font-size:${screenFontPx}px;background:${c};transform:translateY(-100%)">${esc(sp.name)}</div>`;
    } else if (sp.type==='LineSpace') {
      const rs = ptRootNorm(sp.start||{x:.2,y:.5}, sp.parent_id);
      const re = ptRootNorm(sp.end  ||{x:.8,y:.5}, sp.parent_id);
      const mx = S.panX + (rs.x+re.x)/2 * S.cur.width * S.zoom;
      const my = S.panY + (rs.y+re.y)/2 * S.cur.height * S.zoom;
      const screenFontPx = Math.min(LABEL_BASE_PX, labelDocPx*S.zoom);
      html += `<div class="screen-label" style="left:${mx+6}px;top:${my}px;font-size:${screenFontPx}px;background:${c};transform:translateY(-100%)">${esc(sp.name)}</div>`;
    } else {
      const rb = bboxRootNorm(sp.bbox||{left:.05,top:.05,right:.5,bottom:.5}, sp.parent_id);
      // top-left corner of the bbox in screen coords
      const sx = S.panX + rb.left * S.cur.width  * S.zoom;
      const sy = S.panY + rb.top  * S.cur.height * S.zoom;
      const screenFontPx = Math.min(LABEL_BASE_PX, labelDocPx*S.zoom);
      // label sits on top of the left edge, outside the frame (translateY(-100%) lifts it above)
      html += `<div class="screen-label" style="left:${sx}px;top:${sy}px;font-size:${screenFontPx}px;background:${c};transform:translateY(-100%)">${esc(sp.name)}</div>`;
    }
  }
  overlay.innerHTML = html;
}

function spaceMD(e, id) {
  // Selection and drag are now handled entirely by onMD (spacesUnderPoint cycle + pendingDrag).
  // spaceMD is kept as a no-op so existing onmousedown attributes in renderAnnotations() don't error.
}

// ── Offset Alignment handle drag: rotate an axis tip in the viewer ──────────────
function offsetHandleMD(event, spaceId, axisIdx, isAsset) {
  if (event.button !== 0) return;
  const sp = S.spaces[spaceId];
  if (!sp) return;

  // Shift+drag = adjust handle length; normal drag = adjust rotation offset
  const adjustLength = event.shiftKey;

  // Prevent any competing drag system from activating
  pendingDrag = null;

  // Get the "aligned" (pre-offset) canonical direction for this axis in canvas coords
  const tgtVal = isAsset ? (sp.asset_axes || [])[axisIdx] : (sp.axes || [])[axisIdx];
  if (tgtVal === undefined) return;
  const ctxId = isAsset ? null : sp.parent_id;

  // Strip inversion prefix so offset is measured relative to non-inverted base direction
  // This keeps offset values independent of whether axis is inverted
  const baseCode = tgtVal.replace(/^inv_/, '');
  let [baseDx, baseDy] = getAxisCodeScreenDir(baseCode, ctxId);
  const bLen = Math.sqrt(baseDx*baseDx + baseDy*baseDy) || 1;
  baseDx /= bLen; baseDy /= bLen;
  const baseAngle = Math.atan2(baseDy, baseDx); // in screen coords (y-down)

  // Compute origin in canvas-pixel coords
  let originCX = 0, originCY = 0;
  if (!S.cur) return;
  const isPoint = sp.type === 'PointSpace';
  const isLine  = sp.type === 'LineSpace' || sp.type === 'VectorSpace';
  if (isPoint) {
    const rp = ptRootNorm(sp.point || {x:.5,y:.5}, sp.parent_id);
    originCX = rp.x * S.cur.width;
    originCY = rp.y * S.cur.height;
  } else if (isLine) {
    const rs = ptRootNorm(sp.start || {x:.2,y:.5}, sp.parent_id);
    const re = ptRootNorm(sp.end   || {x:.8,y:.5}, sp.parent_id);
    originCX = ((rs.x + re.x) / 2) * S.cur.width;
    originCY = ((rs.y + re.y) / 2) * S.cur.height;
  } else {
    const rb = bboxRootNorm(sp.bbox || {left:0,top:0,right:1,bottom:1}, sp.parent_id);
    const bw = (rb.right - rb.left) * S.cur.width;
    const bh = (rb.bottom - rb.top) * S.cur.height;
    const {ox, oy} = originPxInBox(sp, bw, bh);
    originCX = rb.left * S.cur.width + ox;
    originCY = rb.top  * S.cur.height + oy;
  }

  if (!sp.axis_offsets)         sp.axis_offsets         = [];
  if (!sp.axis_offset_on)       sp.axis_offset_on       = [];
  if (!sp.asset_axis_offsets)   sp.asset_axis_offsets   = [];
  if (!sp.asset_axis_offset_on) sp.asset_axis_offset_on = [];
  if (!sp.axis_handle_lengths)       sp.axis_handle_lengths       = [];
  if (!sp.asset_axis_handle_lengths) sp.asset_axis_handle_lengths = [];

  const container = document.getElementById('canvas-container');

  // Use AbortController so cleanup is guaranteed and does not conflict with
  // the main drag system's document.addEventListener('mousemove', onMM).
  const ac = new AbortController();
  const sig = ac.signal;

  document.addEventListener('mousemove', (e) => {
    const r = container.getBoundingClientRect();
    const curCX = (e.clientX - r.left - S.panX) / S.zoom;
    const curCY = (e.clientY - r.top  - S.panY) / S.zoom;
    
    if (adjustLength) {
      // Shift+drag: adjust handle length (distance from origin to cursor)
      const dx = curCX - originCX;
      const dy = curCY - originCY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const clampedDist = Math.max(20, Math.min(500, dist)); // clamp between 20-500px
      if (isAsset) sp.asset_axis_handle_lengths[axisIdx] = clampedDist;
      else         sp.axis_handle_lengths[axisIdx]       = clampedDist;
    } else {
      // Normal drag: adjust rotation offset
      const dragAngle = Math.atan2(curCY - originCY, curCX - originCX);
      let offsetRad = baseAngle - dragAngle;
      while (offsetRad >  Math.PI) offsetRad -= 2 * Math.PI;
      while (offsetRad < -Math.PI) offsetRad += 2 * Math.PI;
      const deg = Math.round(offsetRad * 180 / Math.PI);
      if (isAsset) sp.asset_axis_offsets[axisIdx] = deg;
      else         sp.axis_offsets[axisIdx]        = deg;
      // Live-update the degree label in the property panel without a full rebuild
      const degSel = isAsset
        ? `.offset-deg-lbl[data-sp="${spaceId}"][data-idx="${axisIdx}"][data-is-asset]`
        : `.offset-deg-lbl[data-sp="${spaceId}"][data-idx="${axisIdx}"]:not([data-is-asset])`;
      document.querySelectorAll(degSel).forEach(el => { el.textContent = `${deg}°`; });
    }
    S.dirty = true;
    renderAnnotations();
  }, { signal: sig });

  document.addEventListener('mouseup', () => {
    ac.abort(); // removes both mousemove and this mouseup listener
    S.dirty = true;
    autoSave();
    renderSpacesPanel();
  }, { signal: sig, once: true });
}

function ptMD(e, id) {
  if (e.button !== 0) return;                          // ← only left mouse moves points
  if (ocrState.active) { e.stopPropagation(); return; }
  if (S.mode !== 'select') return;
  // Property Panel Mode: block interaction with non-selected spaces
  if (S.propertyPanelMode && id !== S.selId) return;
  selectSpace(id, true);
  snapshot();
  const sp = S.spaces[id];
  const rp = ptRootNorm(sp.point, sp.parent_id);
  drag = {on:true, id, sx:e.clientX, sy:e.clientY, isPt:true, ox:rp.x, oy:rp.y};
  e.stopPropagation();
}

// ════════════════════════════════════════════════════════════════
// SPACES PANEL  — card-based layout matching reference image
// ════════════════════════════════════════════════════════════════
let creationSeed = Date.now();
const collapsedSpaces = new Set();  // persists across re-renders
const multiSelSpaces  = new Set();  // IDs of multi-selected spaces
let   _lastSelId      = null;       // anchor for shift-range selection

function toggleAllCollapsed() {
  const allIds = Object.keys(S.spaces);
  if (!allIds.length) return;
  const anyExpanded = allIds.some(id => !collapsedSpaces.has(id));
  if (anyExpanded) allIds.forEach(id => collapsedSpaces.add(id));
  else             allIds.forEach(id => collapsedSpaces.delete(id));
  renderSpacesPanel();
}

function _isAncestorOf(ancestorId, descendantId) {
  let cur = S.spaces[descendantId]?.parent_id;
  while (cur) { if (cur === ancestorId) return true; cur = S.spaces[cur]?.parent_id; }
  return false;
}

function ensureCreationTimestamps() {
  Object.values(S.spaces).forEach(sp => {
    if (sp.created_at == null) sp.created_at = creationSeed++;
  });
}

// Reparent a space while preserving its visual position in the viewer.
// Converts coords from old parent's space → root-normalized → new parent's space.
function reparentSpace(draggedId, newParentId) {
  const sp = S.spaces[draggedId];
  if (!sp) return;
  const oldParentId = sp.parent_id;
  if (oldParentId === newParentId) return;

  if (sp.type === 'PointSpace') {
    const rootPt = ptRootNorm(sp.point || {x:0.5, y:0.5}, oldParentId);
    sp.parent_id = newParentId;
    sp.point = ptToParentRel(rootPt, newParentId);
  } else if (sp.type === 'LineSpace') {
    const rootStart = ptRootNorm(sp.start || {x:0.2, y:0.5}, oldParentId);
    const rootEnd   = ptRootNorm(sp.end   || {x:0.8, y:0.5}, oldParentId);
    sp.parent_id = newParentId;
    sp.start = ptToParentRel(rootStart, newParentId);
    sp.end   = ptToParentRel(rootEnd,   newParentId);
  } else {
    // DocumentSpace — convert root-normalised bbox
    const rootBbox = bboxRootNorm(sp.bbox || {left:0.05,top:0.05,right:0.5,bottom:0.5}, oldParentId);
    sp.parent_id = newParentId;
    sp.bbox = bboxToParentRel(rootBbox, newParentId);
  }
}

function renderSpacesPanel() {
  // Remove any portal-ed entity dropdowns left from previous render
  document.querySelectorAll('.sc-entity-dropdown').forEach(el => el.remove());
  const container = document.getElementById('spaces-container');
  ensureCreationTimestamps();
  const roots = Object.values(S.spaces)
    .filter(s=>!s.parent_id)
    .sort((a,b)=>(b.created_at||0)-(a.created_at||0));
  if (!roots.length) {
    container.innerHTML = '<div style="color:var(--text3);font-size:10px;font-family:var(--mono);padding:12px 8px;text-align:center;">No spaces yet</div>';
    return;
  }
  container.innerHTML = '';

  // Root-level drop zone for drag-reparent
  const rootDrop = document.createElement('div');
  rootDrop.className = 'sc-root-dropzone';
  rootDrop.textContent = '↩ Drop here to make root-level';
  rootDrop.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/space-id')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    rootDrop.classList.add('active');
  });
  rootDrop.addEventListener('dragleave', () => rootDrop.classList.remove('active'));
  rootDrop.addEventListener('drop', (e) => {
    e.preventDefault(); rootDrop.classList.remove('active');
    // Multi-drag: bundle reparenting
    const multiData = e.dataTransfer.getData('text/space-ids');
    if (multiData) {
      let ids; try { ids = JSON.parse(multiData); } catch (err) { ids = []; }
      if (ids.length) {
        snapshot();
        ids.forEach(id => reparentSpace(id, null));
        multiSelSpaces.clear();
        S.dirty = true; renderAnnotations(); renderSpacesPanel(); autoSave();
        notify(`${ids.length} space${ids.length > 1 ? 's' : ''} moved to root level`);
      }
      return;
    }
    const draggedId = e.dataTransfer.getData('text/space-id');
    if (!draggedId) return;
    snapshot();
    reparentSpace(draggedId, null);
    S.dirty = true; renderAnnotations(); renderSpacesPanel(); autoSave();
    notify(`“${S.spaces[draggedId]?.name || draggedId}” moved to root level`);
  });

  roots.forEach(r => container.appendChild(buildCardWrap(r, 0)));
  container.appendChild(rootDrop);
  updateEntityDatalist();
}

function updateEntityDatalist() {
  // Entity names are read directly from S.spaces on dropdown open — no global DOM needed.
}

function buildCardWrap(sp, depth) {
  const wrap = document.createElement('div');
  wrap.className = 'space-card-wrap';
  wrap.appendChild(buildCard(sp, depth));
  const children = Object.values(S.spaces)
    .filter(c=>c.parent_id===sp.id)
    .sort((a,b)=>{
      const ca=a.created_at||0, cb=b.created_at||0;
      if (ca===cb) return (a.name||'').localeCompare(b.name||'');
      return cb - ca; // newest first → appears right below parent
    });
  children.forEach(c => wrap.appendChild(buildCardWrap(c, depth+1)));
  return wrap;
}

// ── Class association row for the property panel card ────────────────────────
function _buildCardClassRow(sp) {
  const row = document.createElement('div');
  row.className = 'sc-classes-row';

  const lbl = document.createElement('span');
  lbl.className = 'sc-classes-lbl';
  lbl.textContent = 'Classes';
  row.appendChild(lbl);

  // Tags showing current class associations
  const tagsEl = document.createElement('div');
  tagsEl.className = 'sc-class-tags';
  row.appendChild(tagsEl);

  function _refreshTags() {
    tagsEl.innerHTML = '';
    (sp.classes || []).forEach((assoc, i) => {
      const tag = document.createElement('span');
      tag.className = 'sc-class-tag';
      const kind = _assocKind(assoc);
      const txt = document.createElement('span');
      txt.title = `${kind} link: ${assoc.pred} ${assoc.cls}`;
      txt.textContent = assoc.cls;
      const badge = document.createElement('span');
      badge.style.cssText = 'margin-right:4px;font-size:8px;opacity:.75;text-transform:uppercase';
      badge.textContent = kind;
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Remove';
      del.onclick = (e) => {
        e.stopPropagation();
        snapshot();
        sp.classes.splice(i, 1);
        S.dirty = true; autoSave();
        _refreshTags();
        if (DP.graphSpaceId === sp.id) renderDedupGraph(sp.id);
        renderDedupClassList();
      };
      tag.appendChild(badge);
      tag.appendChild(txt);
      tag.appendChild(del);
      tagsEl.appendChild(tag);
    });
  }
  _refreshTags();

  // Autocomplete input to add a new class
  const inpWrap = document.createElement('div');
  inpWrap.className = 'sc-class-inp-wrap';
  inpWrap.style.marginTop = '2px';

  const inp = document.createElement('input');
  inp.className = 'sc-class-inp';
  inp.type = 'text';
  inp.placeholder = 'Add class (e.g. bot:Zone)…';
  inp.autocomplete = 'off';

  const acDrop = document.createElement('div');
  acDrop.className = 'sc-class-ac';

  inpWrap.appendChild(inp);
  inpWrap.appendChild(acDrop);
  row.insertBefore(inpWrap, tagsEl); // input above tags

  let acIdx = -1;

  function _classTerms() {
    // Built-in known types with prefixes
    const builtIn = [
      'spot:DocumentSpace','spot:PointSpace','spot:LineSpace','spot:AssetSpace',
      'bot:Zone','bot:Space','bot:Element','bot:Building','bot:Storey',
      'owl:Class','rdfs:Class','owl:NamedIndividual',
    ];
    const fromOntos = typeof _allOntologyTerms === 'function'
      ? _allOntologyTerms().classes : [];
    return [...new Set([...builtIn, ...fromOntos])];
  }

  function _buildAcOpts(filter) {
    const q = (filter || '').toLowerCase();
    const terms = _classTerms();
    const list = q ? terms.filter(t => t.toLowerCase().includes(q)) : terms;
    acIdx = -1;
    acDrop.innerHTML = '';
    if (!list.length) { acDrop.style.display = 'none'; return; }
    list.slice(0, 30).forEach(term => {
      const item = document.createElement('div');
      item.className = 'sc-class-ac-item';
      item.textContent = term;
      item.onmousedown = (ev) => {
        ev.preventDefault();
        _addClass(term);
        inp.value = '';
        acDrop.style.display = 'none';
      };
      acDrop.appendChild(item);
    });
    acDrop.style.display = '';
  }

  function _addClass(cls) {
    if (!cls.trim()) return;
    if (!sp.classes) sp.classes = [];
    if (sp.classes.some(a => a.cls === cls.trim())) return; // no dup
    snapshot();
    sp.classes.push({ pred: 'rdf:type', cls: cls.trim() });
    S.dirty = true; autoSave();
    _refreshTags();
    if (DP.graphSpaceId === sp.id) renderDedupGraph(sp.id);
    renderDedupClassList();
  }

  inp.onfocus = () => _buildAcOpts(inp.value);
  inp.oninput = () => _buildAcOpts(inp.value);
  inp.onblur = () => setTimeout(() => { acDrop.style.display = 'none'; acIdx = -1; }, 160);
  inp.onkeydown = (ev) => {
    const opts = acDrop.querySelectorAll('.sc-class-ac-item');
    if (ev.key === 'Escape') { acDrop.style.display = 'none'; return; }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (acIdx >= 0 && opts[acIdx]) _addClass(opts[acIdx].textContent);
      else if (inp.value.trim()) _addClass(inp.value.trim());
      inp.value = ''; acDrop.style.display = 'none';
      return;
    }
    if (!opts.length) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault(); acIdx = Math.min(acIdx + 1, opts.length - 1);
      opts.forEach((o, i) => o.classList.toggle('focused', i === acIdx));
      opts[acIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault(); acIdx = Math.max(acIdx - 1, 0);
      opts.forEach((o, i) => o.classList.toggle('focused', i === acIdx));
      opts[acIdx]?.scrollIntoView({ block: 'nearest' });
    }
  };

  return row;
}

function buildCard(sp, depth) {
  const ci = depth % CARD_BD.length;
  const card = document.createElement('div');
  card.className = `space-card${S.selId===sp.id?' selected-card':''}${multiSelSpaces.has(sp.id)?' multi-selected-card':''}`;
  card.dataset.spaceId = sp.id;
  card.style.borderColor = CARD_BD[ci];
  card.style.background  = CARD_BG[ci];
  card.onclick = (e) => {
    if (e.target.closest('input,select,button,textarea')) return;
    if (e.ctrlKey || e.metaKey) {
      if (multiSelSpaces.has(sp.id)) multiSelSpaces.delete(sp.id);
      else multiSelSpaces.add(sp.id);
      _lastSelId = sp.id;
      renderSpacesPanel();
    } else if (e.shiftKey && _lastSelId) {
      const orderedIds = [...document.querySelectorAll('#spaces-container .space-card')].map(el => el.dataset.spaceId);
      const fromIdx = orderedIds.indexOf(_lastSelId);
      const toIdx   = orderedIds.indexOf(sp.id);
      if (fromIdx >= 0 && toIdx >= 0) {
        const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx);
        orderedIds.slice(lo, hi + 1).forEach(id => multiSelSpaces.add(id));
      }
      renderSpacesPanel();
    } else {
      multiSelSpaces.clear();
      _lastSelId = sp.id;
      document.querySelectorAll('.multi-selected-card').forEach(el => el.classList.remove('multi-selected-card'));
      selectSpace(sp.id);
    }
  };

  const isPoint  = sp.type==='PointSpace';
  const isVector = sp.type==='LineSpace';

  // ── Header row ──
  const hdr = document.createElement('div');
  hdr.className = 'sc-header';

  // ── Collapse toggle ──
  const isCollapsed = collapsedSpaces.has(sp.id);
  const colBtn = document.createElement('button');
  colBtn.className = 'sc-collapse-btn';
  colBtn.textContent = isCollapsed ? '▶' : '▼';
  colBtn.title = isCollapsed ? 'Expand' : 'Minimize';
  colBtn.onclick = (e) => {
    e.stopPropagation();
    function collapseAll(id) {
      collapsedSpaces.add(id);
      Object.values(S.spaces).filter(c => c.parent_id === id).forEach(c => collapseAll(c.id));
    }
    function expandAll(id) {
      collapsedSpaces.delete(id);
      Object.values(S.spaces).filter(c => c.parent_id === id).forEach(c => expandAll(c.id));
    }
    if (collapsedSpaces.has(sp.id)) expandAll(sp.id);
    else collapseAll(sp.id);
    renderSpacesPanel();
  };

  // ── Drag grip for reparenting ──
  const dragGrip = document.createElement('span');
  dragGrip.className = 'sc-drag-grip';
  dragGrip.textContent = '⠿';
  dragGrip.title = 'Drag to reparent';
  dragGrip.draggable = true;
  dragGrip.addEventListener('dragstart', (e) => {
    const isDragMulti = multiSelSpaces.size > 1 && multiSelSpaces.has(sp.id);
    e.dataTransfer.setData('text/space-id', sp.id);  // always set for dragover detection
    if (isDragMulti) e.dataTransfer.setData('text/space-ids', JSON.stringify([...multiSelSpaces]));
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      if (isDragMulti) {
        [...multiSelSpaces].forEach(id => {
          const c = document.querySelector(`.space-card[data-space-id="${id}"]`);
          if (c) c.classList.add('sp-dragging');
        });
      } else {
        card.classList.add('sp-dragging');
      }
    }, 0);
  });
  dragGrip.addEventListener('dragend', () => document.querySelectorAll('.sp-dragging').forEach(c => c.classList.remove('sp-dragging')));

  const nameInp = document.createElement('input');
  nameInp.className = 'sc-name-input';
  nameInp.value = sp.name;
  nameInp.oninput = () => {
    sp.name = nameInp.value;
    S.dirty = true; renderAnnotations(); autoSave();
    if (DP.open) {
      renderDedupSpaceList();
      if (document.getElementById('dedup-sel-edit')?._sid === sp.id) _dedupUpdateSelEdit(sp.id);
      if (DP.graphSpaceId === sp.id) renderDedupGraph(sp.id);
    }
  };

  const delBtn = document.createElement('button');
  delBtn.className = 'sc-del-btn';
  delBtn.innerHTML = '✕';
  delBtn.title = 'Delete space';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteSpaceById(sp.id); };

  // OCR button
  const ocrBtn = document.createElement('button');
  ocrBtn.className = 'sc-ocr-btn';
  ocrBtn.textContent = 'OCR';
  ocrBtn.title = 'Draw a box in the viewer to read text into name';
  ocrBtn.onclick = (e) => { e.stopPropagation(); startOCR(sp.id, ocrBtn); };

  // Dedup toggle button + row (between OCR and delete)
  const dedupBtn = document.createElement('button');
  dedupBtn.className = 'sc-dedup-btn' + (sp.entity ? ' dedup-active' : '');
  dedupBtn.textContent = '⌄';
  dedupBtn.title = 'Set entity name for deduplication';

  const dedupRow = document.createElement('div');
  dedupRow.className = 'sc-dedup-row';
  dedupRow.style.display = sp.entity ? '' : 'none';

  const entityLbl = document.createElement('span');
  entityLbl.className = 'sc-dedup-lbl';
  entityLbl.textContent = 'Entity:';

  // Custom autocomplete widget
  const entityWrap = document.createElement('div');
  entityWrap.className = 'sc-entity-wrap';

  const entityInp = document.createElement('input');
  entityInp.className = 'sc-entity-inp';
  entityInp.value = sp.entity || '';
  entityInp.placeholder = 'shared entity name\u2026';
  entityInp.type = 'text';
  entityInp.autocomplete = 'off';

  const entityDrop = document.createElement('div');
  entityDrop.className = 'sc-entity-dropdown';
  entityDrop.style.display = 'none';
  document.body.appendChild(entityDrop);

  entityWrap.appendChild(entityInp);
  // entityDrop is portaled to body — not inside entityWrap

  let dropFocIdx = -1;

  function _entityNames() {
    const fromCurrent = Object.values(S.spaces).map(s => (s.entity||'').trim()).filter(Boolean);
    return [...new Set([..._globalEntityNames, ...fromCurrent])];
  }

  function _positionDrop() {
    const r = entityWrap.getBoundingClientRect();
    entityDrop.style.top   = (r.bottom + 2) + 'px';
    entityDrop.style.left  = r.left + 'px';
    entityDrop.style.width = r.width + 'px';
  }

  function _buildOpts(filter) {
    const q = (filter||'').toLowerCase();
    const all = _entityNames();
    const list = q ? all.filter(n => n.toLowerCase().includes(q)) : all;
    dropFocIdx = -1;
    entityDrop.innerHTML = '';
    if (!list.length) { entityDrop.style.display = 'none'; return; }
    list.forEach(name => {
      const opt = document.createElement('div');
      opt.className = 'sc-entity-opt';
      opt.textContent = name;
      opt.onmousedown = (ev) => {
        ev.preventDefault();
        entityInp.value = name;
        sp.entity = name;
        S.dirty = true; autoSave(); updateEntityDatalist();
        entityDrop.style.display = 'none';
        if (DP.open) {
          renderDedupSpaceList();
          if (DP.graphSpaceId === sp.id) renderDedupGraph(sp.id);
        }
      };
      entityDrop.appendChild(opt);
    });
    _positionDrop();
    entityDrop.style.display = '';
  }

  function _closeDropdown() {
    entityDrop.style.display = 'none';
    dropFocIdx = -1;
  }

  // Open full list on focus/click; user can type immediately to filter
  entityInp.onfocus = () => { _buildOpts(entityInp.value.trim()); };
  entityInp.onclick = (ev) => { ev.stopPropagation(); _buildOpts(entityInp.value.trim()); };

  // Prevent dropdown clicks from blurring the input
  entityDrop.onmousedown = (ev) => ev.preventDefault();

  entityInp.oninput = () => {
    sp.entity = entityInp.value;
    S.dirty = true; autoSave(); updateEntityDatalist();
    _buildOpts(entityInp.value.trim());
    if (DP.open) {
      renderDedupSpaceList();
      if (DP.graphSpaceId === sp.id) renderDedupGraph(sp.id);
    }
  };

  entityInp.onkeydown = (ev) => {
    const opts = entityDrop.querySelectorAll('.sc-entity-opt');
    if (ev.key === 'Escape') { _closeDropdown(); return; }
    if (!opts.length) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      dropFocIdx = Math.min(dropFocIdx + 1, opts.length - 1);
      opts.forEach((o,i) => o.classList.toggle('focused', i === dropFocIdx));
      opts[dropFocIdx]?.scrollIntoView({ block:'nearest' });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      dropFocIdx = Math.max(dropFocIdx - 1, 0);
      opts.forEach((o,i) => o.classList.toggle('focused', i === dropFocIdx));
      opts[dropFocIdx]?.scrollIntoView({ block:'nearest' });
    } else if (ev.key === 'Enter' && dropFocIdx >= 0) {
      ev.preventDefault();
      const sel = opts[dropFocIdx].textContent;
      entityInp.value = sel;
      sp.entity = sel;
      S.dirty = true; autoSave(); updateEntityDatalist();
      _closeDropdown();
      if (DP.open) {
        renderDedupSpaceList();
        if (DP.graphSpaceId === sp.id) renderDedupGraph(sp.id);
      }
    }
  };

  entityInp.onblur = () => setTimeout(_closeDropdown, 160);

  dedupRow.appendChild(entityLbl);
  dedupRow.appendChild(entityWrap);

  dedupBtn.onclick = (e) => {
    e.stopPropagation();
    const open = dedupRow.style.display !== 'none';
    if (open) {
      // Closing → clear the entity association
      sp.entity = '';
      entityInp.value = '';
      _closeDropdown();
      S.dirty = true; autoSave();
      if (DP.open) {
        renderDedupSpaceList();
        if (DP.graphSpaceId === sp.id) renderDedupGraph(sp.id);
      }
    }
    dedupRow.style.display = open ? 'none' : '';
    dedupBtn.classList.toggle('dedup-active', !open);
    if (!open) setTimeout(() => entityInp.focus(), 0);
  };

  hdr.appendChild(colBtn);
  hdr.appendChild(dragGrip);
  hdr.appendChild(nameInp);
  hdr.appendChild(ocrBtn);
  hdr.appendChild(dedupBtn);
  hdr.appendChild(delBtn);
  card.appendChild(hdr);
  card.appendChild(dedupRow);

  // Drop-target: accept drags from other cards to reparent them under this space
  card.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/space-id')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    card.classList.add('drag-target');
  });
  card.addEventListener('dragleave', (e) => {
    if (!card.contains(e.relatedTarget)) card.classList.remove('drag-target');
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    card.classList.remove('drag-target');
    // Multi-drag: bundle reparenting
    const multiData = e.dataTransfer.getData('text/space-ids');
    if (multiData) {
      let ids; try { ids = JSON.parse(multiData); } catch (err) { ids = []; }
      const validIds = ids.filter(id => id !== sp.id && !_isAncestorOf(id, sp.id));
      if (validIds.length) {
        snapshot();
        validIds.forEach(id => reparentSpace(id, sp.id));
        multiSelSpaces.clear();
        S.dirty = true; renderAnnotations(); renderSpacesPanel(); autoSave();
        notify(`${validIds.length} space${validIds.length > 1 ? 's' : ''} moved under "${sp.name}"`);
      }
      return;
    }
    const draggedId = e.dataTransfer.getData('text/space-id');
    if (!draggedId || draggedId === sp.id) return;
    if (_isAncestorOf(draggedId, sp.id)) { notify('Cannot drop onto own child'); return; }
    snapshot();
    reparentSpace(draggedId, sp.id);
    S.dirty = true; renderAnnotations(); renderSpacesPanel(); autoSave();
    notify(`“${S.spaces[draggedId]?.name || draggedId}” moved under “${sp.name}”`);
  });

  if (isCollapsed) return card;  // minimized — only show header + drop handlers

  // ── Body ──
  const body = document.createElement('div');
  body.className = 'sc-body';

  // ── SpaceType row ──
  const typeRow = document.createElement('div');
  typeRow.className = 'sc-row';
  const typeLbl = document.createElement('span');
  typeLbl.className = 'lbl'; typeLbl.textContent = 'SpaceType';
  typeLbl.style.cssText = 'width:auto;min-width:58px;';
  const typeSel = document.createElement('select');
  typeSel.className = 'sc-sel'; typeSel.style.flex = '1';
  ['DocumentSpace', 'VolumeSpace', 'LineSpace', 'PointSpace'].forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    if (t === (sp.type || 'DocumentSpace')) opt.selected = true;
    typeSel.appendChild(opt);
  });
  typeSel.onchange = (e) => {
    e.stopPropagation();
    snapshot();
    sp.type = typeSel.value;
    S.dirty = true;
    renderAnnotations(); renderSpacesPanel(); autoSave();
    if (DP.open) {
      renderDedupSpaceList();
      if (document.getElementById('dedup-sel-edit')?._sid === sp.id) _dedupUpdateSelEdit(sp.id);
      if (DP.graphSpaceId === sp.id) renderDedupGraph(sp.id);
    }
  };
  typeRow.appendChild(typeLbl);
  typeRow.appendChild(typeSel);
  body.appendChild(typeRow);

  if (!isPoint && !isVector) {
    const b = sp.bbox || {left:0,top:0,right:1,bottom:1};
    const isVol = sp.type === 'VolumeSpace';
    const r1 = document.createElement('div'); r1.className = 'sc-ltrb-row';
    const r2 = document.createElement('div'); r2.className = 'sc-ltrb-row';
    [
      [r1, 'x min', r5(b.left),   v=>{ sp.bbox.left   = c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
      [r1, 'y min', r5(b.top),    v=>{ sp.bbox.top     = c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
      [r2, 'x max', r5(b.right),  v=>{ sp.bbox.right   = c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
      [r2, 'y max', r5(b.bottom), v=>{ sp.bbox.bottom  = c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
    ].forEach(([row, lbl, val, cb]) => {
      const l = document.createElement('span'); l.className='sc-ltrb-lbl'; l.textContent=lbl;
      const inp = mkCoordInput(val, v=>{ cb(v); });
      row.appendChild(l); row.appendChild(inp);
    });
    if (isVol) {
      if (sp.z_min === undefined) sp.z_min = 0;
      if (sp.z_max === undefined) sp.z_max = 1;
      [[r1, 'z min', 'z_min'], [r2, 'z max', 'z_max']].forEach(([row, lbl, key]) => {
        const l = document.createElement('span'); l.className='sc-ltrb-lbl'; l.textContent=lbl;
        const inp = mkCoordInput(r5(sp[key]), v=>{ sp[key]=v; S.dirty=true; autoSave(); });
        row.appendChild(l); row.appendChild(inp);
      });
    }
    body.appendChild(r1);
    body.appendChild(r2);
  } else if (isVector) {
    // Start / End as min/max grid rows
    const ss = sp.start || {x:.2, y:.5, z:.5};
    const se = sp.end   || {x:.8, y:.5, z:.5};
    if (sp.start && sp.start.z === undefined) sp.start.z = 0.5;
    if (sp.end   && sp.end.z   === undefined) sp.end.z   = 0.5;
    const r1 = document.createElement('div'); r1.className = 'sc-ltrb-row';
    const r2 = document.createElement('div'); r2.className = 'sc-ltrb-row';
    [
      [r1, 'x min', ss.x, v=>{ sp.start.x=c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
      [r1, 'y min', ss.y, v=>{ sp.start.y=c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
      [r1, 'z min', ss.z !== undefined ? ss.z : 0.5, v=>{ sp.start.z=v; S.dirty=true; autoSave(); }],
      [r2, 'x max', se.x, v=>{ sp.end.x=c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
      [r2, 'y max', se.y, v=>{ sp.end.y=c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
      [r2, 'z max', se.z !== undefined ? se.z : 0.5, v=>{ sp.end.z=v; S.dirty=true; autoSave(); }],
    ].forEach(([row, lbl, val, cb]) => {
      const l = document.createElement('span'); l.className='sc-ltrb-lbl'; l.textContent=lbl;
      const inp = mkCoordInput(r5(val), v=>{ cb(v); });
      row.appendChild(l); row.appendChild(inp);
    });
    body.appendChild(r1);
    body.appendChild(r2);
    // Dashed toggle for LineSpace
    const dashRow = document.createElement('div'); dashRow.className='sc-row';
    const dashBtn = document.createElement('button');
    dashBtn.className = 'sc-dash-btn' + (sp.dashed ? ' dashed-on' : '');
    dashBtn.textContent = sp.dashed ? '╌ dashed' : '— solid';
    dashBtn.onclick = (e) => { e.stopPropagation(); sp.dashed=!sp.dashed; S.dirty=true;
      dashBtn.textContent = sp.dashed ? '╌ dashed' : '— solid';
      dashBtn.className = 'sc-dash-btn' + (sp.dashed ? ' dashed-on' : '');
      renderAnnotations(); autoSave(); };
    dashRow.appendChild(dashBtn);
    body.appendChild(dashRow);
  } else {
    // PointSpace — single coordinate row
    const pt = sp.point || {x:.5, y:.5};
    const coordRow = document.createElement('div');
    coordRow.className = 'sc-ltrb-row';
    [['x', pt.x, v=>{ sp.point.x=c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
     ['y', pt.y, v=>{ sp.point.y=c01(v); S.dirty=true; renderAnnotations(); autoSave(); }],
    ].forEach(([lbl, val, cb]) => {
      const l = document.createElement('span'); l.className='sc-ltrb-lbl'; l.textContent=lbl;
      const inp = mkCoordInput(r5(val), v=>{ cb(v); });
      coordRow.appendChild(l); coordRow.appendChild(inp);
    });
    body.appendChild(coordRow);
    // PointSpace has no origin row
  }

  if (!isPoint && !isVector) {
    const originRow = document.createElement('div');
    originRow.className = 'sc-row';
    const oSel = document.createElement('select'); oSel.className='sc-sel';
    ['top_left','top_right','bottom_left','bottom_right'].forEach(o=>{
      const opt=document.createElement('option'); opt.value=o; opt.textContent=o.replace('_',' ');
      if (sp.origin===o) opt.selected=true;
      oSel.appendChild(opt);
    });
    oSel.onchange=()=>{ sp.origin=oSel.value; S.dirty=true; renderAnnotations(); autoSave(); };
    const oBtn = document.createElement('button'); oBtn.className='sc-origin-btn'; oBtn.textContent='Set Origin';
    oBtn.onclick=(e)=>{e.stopPropagation(); setOriginInteractive(sp.id);};
    // Dashed toggle for DocumentSpace
    const dashBtn = document.createElement('button');
    dashBtn.className = 'sc-dash-btn' + (sp.dashed ? ' dashed-on' : '');
    dashBtn.textContent = sp.dashed ? '╌ dashed' : '— solid';
    dashBtn.onclick = (e) => { e.stopPropagation(); sp.dashed=!sp.dashed; S.dirty=true;
      dashBtn.textContent = sp.dashed ? '╌ dashed' : '— solid';
      dashBtn.className = 'sc-dash-btn' + (sp.dashed ? ' dashed-on' : '');
      renderAnnotations(); autoSave(); };
    originRow.innerHTML='<span class="lbl">origin</span><span class="arr">--&gt;</span>';
    originRow.appendChild(oSel); originRow.appendChild(oBtn); originRow.appendChild(dashBtn);
    body.appendChild(originRow);
  }

  // ensure axes array exists (migrate old data)
  if (!sp.axes) { sp.axes = [sp.x_axis||'x', sp.y_axis||'y']; }
  if (!sp.src_axes) sp.src_axes = sp.axes.map((_,i)=>['x','y','z'][i]||'x');
  if (!sp.asset_axes) sp.asset_axes = [];
  if (!sp.asset_src_axes) sp.asset_src_axes = [];
  if (!sp.axis_offsets)   sp.axis_offsets   = [];
  if (!sp.axis_offset_on) sp.axis_offset_on = [];
  syncLegacyAxes(sp);

  const parentSp   = sp.parent_id ? S.spaces[sp.parent_id] : null;
  const parentAxes = parentSp
    ? (parentSp.axes || [parentSp.x_axis||'x', parentSp.y_axis||'y'])
    : null;

  // ── Axis anchor — axis rows always inserted before this ──
  const axisAnchor = document.createElement('div');
  axisAnchor.className = 'axis-anchor';
  body.appendChild(axisAnchor);

  function rebuildAxesRows() {
    body.querySelectorAll('.axis-dyn-row').forEach(el => el.remove());

    // Sync src_axes length to axes length
    if (!sp.src_axes) sp.src_axes = [];
    while (sp.src_axes.length < sp.axes.length)
      sp.src_axes.push(['x','y','z'][sp.src_axes.length] || 'x');
    sp.src_axes = sp.src_axes.slice(0, sp.axes.length);

    // Ensure asset arrays exist (initialised on first TargetAsset toggle)
    if (!sp.asset_axes)     sp.asset_axes     = [];
    if (!sp.asset_src_axes) sp.asset_src_axes = [];

    // Ensure offset arrays exist and stay in sync with axes count
    if (!sp.axis_offsets)   sp.axis_offsets   = [];
    if (!sp.axis_offset_on) sp.axis_offset_on = [];
    while (sp.axis_offset_on.length < sp.axes.length) sp.axis_offset_on.push(false);
    while (sp.axis_offsets.length   < sp.axes.length) sp.axis_offsets.push(0);

    // VolumeSpace requires at least 3 axes — auto-fill when below minimum
    const minAxes = sp.type === 'VolumeSpace' ? 3 : (isPoint ? 0 : 1);
    while (sp.axes.length < minAxes) {
      const used = new Set(sp.axes);
      const defaults = ['x','y','z'];
      sp.axes.push(defaults.find(a => !used.has(a)) || 'x');
      sp.src_axes.push(['X','Y','Z'][sp.axes.length - 1] || 'X');
      syncLegacyAxes(sp);
    }

    const axes     = sp.axes;
    const canAdd    = axes.length < 3;
    const canRemove = axes.length > minAxes;

    // ── helper: source-axis dropdown (x / y / z) ──
    function makeSrcSel(current, onChange) {
      const sel = document.createElement('select');
      sel.className = 'sc-src-inp';
      sel.title = 'Source axis name';
      ['x','y','z'].forEach(v => {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        if (v === (current||'x').toLowerCase()) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = () => { onChange(sel.value); };
      sel.onclick  = e => e.stopPropagation();
      return sel;
    }

    // ── parent axis rows ──
    axes.forEach((axVal, idx) => {
      const row = document.createElement('div');
      row.className = 'sc-row axis-dyn-row';

      const srcSel = makeSrcSel(sp.src_axes[idx], val => {
        sp.src_axes[idx] = val;
        S.dirty = true; renderAnnotations(); autoSave();
      });

      const arr = document.createElement('span');
      arr.className = 'arr'; arr.textContent = '--> Parent';

      const tgtSel = document.createElement('select');
      tgtSel.className = 'sc-sel';
      // PointSpace can target any axis (x/y/z) regardless of what parent has defined
      const opts = (parentAxes && sp.type !== 'PointSpace')
        ? parentAxes.flatMap(pa => {
            const base = pa.replace('inv_','');
            return [[base, base], [`inv_${base}`, `inv ${base}`]];
          })
        : AXIS_OPTIONS;
      const seen = new Set();
      opts.forEach(([v,l]) => {
        if (seen.has(v)) return; seen.add(v);
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        if (v === axVal) o.selected = true;
        tgtSel.appendChild(o);
      });
      tgtSel.onchange = () => {
        sp.axes[idx] = tgtSel.value;
        syncLegacyAxes(sp);
        S.dirty = true; renderAnnotations(); autoSave();
      };

      row.appendChild(srcSel);
      row.appendChild(arr);
      row.appendChild(tgtSel);

      // ── Offset Alignment toggle ── (DISABLED — keep for future restore)
      if (false) { // eslint-disable-line no-constant-condition
      const oaOn = !!(sp.axis_offset_on && sp.axis_offset_on[idx]);
      const oaWrap = document.createElement('label');
      oaWrap.className = 'sc-oa-wrap' + (oaOn ? ' checked' : '');
      oaWrap.title = oaOn ? 'Offset Alignment ON — drag arrow tip in viewer' : 'Enable rotational offset — drag arrow tip in viewer';
      const oaCb = document.createElement('input');
      oaCb.type = 'checkbox'; oaCb.checked = oaOn;
      const oaTrack = document.createElement('span'); oaTrack.className = 'sc-oa-toggle';
      const oaLbl = document.createElement('span'); oaLbl.className = 'sc-oa-label'; oaLbl.textContent = '∠';
      oaWrap.appendChild(oaCb); oaWrap.appendChild(oaTrack); oaWrap.appendChild(oaLbl);
      oaWrap.onclick = e => {
        e.stopPropagation(); e.preventDefault();
        if (!sp.axis_offset_on) sp.axis_offset_on = [];
        sp.axis_offset_on[idx] = !sp.axis_offset_on[idx];
        if (!sp.axis_offsets) sp.axis_offsets = [];
        if (!sp.axis_offsets[idx]) sp.axis_offsets[idx] = 0;
        S.dirty = true; rebuildAxesRows(); renderAnnotations(); autoSave();
        notify(sp.axis_offset_on[idx] ? '∠ Offset ON — drag arrow tip' : '∠ Offset OFF');
      };
      row.appendChild(oaWrap);

      // Degree readout (visible when offset is on)
      if (oaOn) {
        const degLbl = document.createElement('span');
        degLbl.className = 'offset-deg-lbl';
        degLbl.dataset.sp  = sp.id;
        degLbl.dataset.idx = idx;
        const deg = Math.round((sp.axis_offsets && sp.axis_offsets[idx]) || 0);
        degLbl.textContent = `${deg}°`;
        row.appendChild(degLbl);
      }
      } // end if(false)

      // − / + always on last row
      if (idx === axes.length - 1) {
        const minusBtn = document.createElement('button');
        minusBtn.className = 'sc-origin-btn';
        minusBtn.style.cssText = 'padding:1px 6px;margin-left:3px;font-size:12px;line-height:1;';
        minusBtn.textContent = '\u2212';
        minusBtn.title = 'Remove last axis';
        if (!canRemove) { minusBtn.disabled = true; minusBtn.style.opacity = '.35'; }
        minusBtn.onclick = e => {
          e.stopPropagation();
          if (sp.axes.length <= minAxes) return;
          sp.axes.pop();
          sp.src_axes = (sp.src_axes||[]).slice(0, sp.axes.length);
          syncLegacyAxes(sp);
          S.dirty = true; rebuildAxesRows(); renderAnnotations(); autoSave();
        };
        row.appendChild(minusBtn);

        if (canAdd) {
          const plusBtn = document.createElement('button');
          plusBtn.className = 'sc-origin-btn';
          plusBtn.style.cssText = 'padding:1px 6px;margin-left:3px;font-size:12px;line-height:1;';
          plusBtn.textContent = '+';
          plusBtn.title = 'Add axis';
          plusBtn.onclick = e => {
            e.stopPropagation();
            const used = new Set(sp.axes);
            const defaults = ['x','y','z','inv_x','inv_y','inv_z'];
            sp.axes.push(defaults.find(a => !used.has(a)) || 'x');
            sp.src_axes.push(['x','y','z'][sp.axes.length-1] || 'x');
            syncLegacyAxes(sp);
            S.dirty = true; rebuildAxesRows(); renderAnnotations(); autoSave();
          };
          row.appendChild(plusBtn);
        }
      }

      body.insertBefore(row, axisAnchor);
    });

    // If axes is empty, render a standalone + row so user can add back
    if (axes.length === 0) {
      const row = document.createElement('div');
      row.className = 'sc-row axis-dyn-row';
      const plusBtn = document.createElement('button');
      plusBtn.className = 'sc-origin-btn';
      plusBtn.style.cssText = 'padding:1px 8px;font-size:12px;line-height:1;';
      plusBtn.textContent = '+';
      plusBtn.title = 'Add axis';
      plusBtn.onclick = e => {
        e.stopPropagation();
        sp.axes.push('x');
        sp.src_axes.push('x');
        syncLegacyAxes(sp);
        S.dirty = true; rebuildAxesRows(); renderAnnotations(); autoSave();
      };
      row.appendChild(plusBtn);
      body.insertBefore(row, axisAnchor);
    }

    // ── TargetAsset toggle row (non-LineSpace only) ──
    if (!isVector) {
      const taRow = document.createElement('div');
      taRow.className = 'sc-row axis-dyn-row';
      taRow.style.cssText = 'justify-content:flex-end;padding-top:3px;';

      const taWrap = document.createElement('label');
      taWrap.className = 'sc-ta-wrap' + (sp.target_asset ? ' checked' : '');
      taWrap.title = sp.target_asset
        ? 'Target AssetSpace ON \u2014 click to toggle off'
        : 'Map axes to AssetSpace \u2014 click to enable';

      const taCb     = document.createElement('input');
      taCb.type      = 'checkbox';
      taCb.checked   = !!sp.target_asset;
      const taTrack  = document.createElement('span');
      taTrack.className = 'sc-ta-toggle';
      const taLbl    = document.createElement('span');
      taLbl.className   = 'sc-ta-label';
      taLbl.textContent = 'TargetAsset';

      taWrap.appendChild(taCb);
      taWrap.appendChild(taTrack);
      taWrap.appendChild(taLbl);

      taWrap.onclick = e => {
        e.stopPropagation(); e.preventDefault();
        sp.target_asset = !sp.target_asset;
        // On first enable: mirror count from parent axes
        if (sp.target_asset) {
          const n = sp.axes.length;
          if (!sp.asset_axes || sp.asset_axes.length === 0) {
            sp.asset_axes     = sp.axes.slice();          // same count, same target values
            sp.asset_src_axes = sp.src_axes.slice();      // same source names
          }
        }
        syncLegacyAxes(sp);
        S.dirty = true;
        rebuildAxesRows(); renderAnnotations(); autoSave();
        notify(sp.target_asset ? 'TargetAsset ON' : 'TargetAsset OFF');
      };

      taRow.appendChild(taWrap);
      body.insertBefore(taRow, axisAnchor);

      // ── Asset axis rows (when target_asset ON) ──
      if (sp.target_asset) {
        // Sync lengths
        while (sp.asset_src_axes.length < sp.asset_axes.length)
          sp.asset_src_axes.push(['x','y','z'][sp.asset_src_axes.length] || 'x');
        sp.asset_src_axes = sp.asset_src_axes.slice(0, sp.asset_axes.length);

        // Sync asset offset arrays
        if (!sp.asset_axis_offsets)   sp.asset_axis_offsets   = [];
        if (!sp.asset_axis_offset_on) sp.asset_axis_offset_on = [];
        while (sp.asset_axis_offset_on.length < sp.asset_axes.length) sp.asset_axis_offset_on.push(false);
        while (sp.asset_axis_offsets.length   < sp.asset_axes.length) sp.asset_axis_offsets.push(0);

        const aAxes    = sp.asset_axes;
        const aCanAdd  = aAxes.length < 3;

        aAxes.forEach((axVal, idx) => {
          const row = document.createElement('div');
          row.className = 'sc-row axis-dyn-row';
          row.style.background = 'rgba(255,255,255,.05)';

          const srcSel = makeSrcSel(sp.asset_src_axes[idx], val => {
            sp.asset_src_axes[idx] = val;
            S.dirty = true; autoSave();
          });

          const arr = document.createElement('span');
          arr.className = 'arr'; arr.textContent = '-->  Asset';
        //   arr.style.marginLeft = 'auto';

          const sel = document.createElement('select');
          sel.className = 'sc-sel';
          AXIS_OPTIONS.forEach(([v,l]) => {
            const o = document.createElement('option');
            o.value = v; o.textContent = l;
            if (v === axVal) o.selected = true;
            sel.appendChild(o);
          });
          sel.onchange = () => { sp.asset_axes[idx] = sel.value; S.dirty = true; autoSave(); };

          row.appendChild(srcSel);
          row.appendChild(arr);
          row.appendChild(sel);

          // ── Asset Offset Alignment toggle ── (DISABLED — keep for future restore)
          if (false) { // eslint-disable-line no-constant-condition
          const aOaOn = !!(sp.asset_axis_offset_on && sp.asset_axis_offset_on[idx]);
          const aOaWrap = document.createElement('label');
          aOaWrap.className = 'sc-oa-wrap' + (aOaOn ? ' checked' : '');
          aOaWrap.title = aOaOn ? 'Asset Offset ON — drag arrow tip in viewer' : 'Enable rotational offset for asset axis';
          const aOaCb = document.createElement('input');
          aOaCb.type = 'checkbox'; aOaCb.checked = aOaOn;
          const aOaTrack = document.createElement('span'); aOaTrack.className = 'sc-oa-toggle';
          const aOaLbl   = document.createElement('span'); aOaLbl.className   = 'sc-oa-label'; aOaLbl.textContent = '∠';
          aOaWrap.appendChild(aOaCb); aOaWrap.appendChild(aOaTrack); aOaWrap.appendChild(aOaLbl);
          aOaWrap.onclick = e => {
            e.stopPropagation(); e.preventDefault();
            if (!sp.asset_axis_offset_on) sp.asset_axis_offset_on = [];
            sp.asset_axis_offset_on[idx] = !sp.asset_axis_offset_on[idx];
            if (!sp.asset_axis_offsets) sp.asset_axis_offsets = [];
            if (!sp.asset_axis_offsets[idx]) sp.asset_axis_offsets[idx] = 0;
            S.dirty = true; rebuildAxesRows(); renderAnnotations(); autoSave();
            notify(sp.asset_axis_offset_on[idx] ? '∠ Asset Offset ON — drag arrow tip' : '∠ Asset Offset OFF');
          };
          row.appendChild(aOaWrap);
          if (aOaOn) {
            const aDegLbl = document.createElement('span');
            aDegLbl.className = 'offset-deg-lbl';
            aDegLbl.dataset.sp      = sp.id;
            aDegLbl.dataset.idx     = idx;
            aDegLbl.dataset.isAsset = '1';
            const aDeg = Math.round((sp.asset_axis_offsets && sp.asset_axis_offsets[idx]) || 0);
            aDegLbl.textContent = `${aDeg}°`;
            row.appendChild(aDegLbl);
          }
          } // end if(false)

          // − / + on last asset row
          if (idx === aAxes.length - 1) {
            const minusBtn = document.createElement('button');
            minusBtn.className = 'sc-origin-btn';
            minusBtn.style.cssText = 'padding:1px 6px;margin-left:3px;font-size:12px;line-height:1;';
            minusBtn.textContent = '\u2212';
            minusBtn.title = 'Remove last asset axis';
            minusBtn.onclick = e => {
              e.stopPropagation();
              sp.asset_axes.pop();
              sp.asset_src_axes = (sp.asset_src_axes||[]).slice(0, sp.asset_axes.length);
              S.dirty = true; rebuildAxesRows(); autoSave();
            };
            row.appendChild(minusBtn);

            if (aCanAdd) {
              const plusBtn = document.createElement('button');
              plusBtn.className = 'sc-origin-btn';
              plusBtn.style.cssText = 'padding:1px 6px;margin-left:3px;font-size:12px;line-height:1;';
              plusBtn.textContent = '+';
              plusBtn.title = 'Add asset axis';
              plusBtn.onclick = e => {
                e.stopPropagation();
                const used = new Set(sp.asset_axes);
                const defs = ['x','y','z','inv_x','inv_y','inv_z'];
                sp.asset_axes.push(defs.find(a => !used.has(a)) || 'x');
                sp.asset_src_axes.push(['x','y','z'][sp.asset_axes.length-1] || 'x');
                S.dirty = true; rebuildAxesRows(); autoSave();
              };
              row.appendChild(plusBtn);
            }
          }

          body.insertBefore(row, axisAnchor);
        });

        // Empty asset axes: standalone + row
        if (aAxes.length === 0) {
          const row = document.createElement('div');
          row.className = 'sc-row axis-dyn-row';
          row.style.background = 'rgba(255,255,255,.05)';
          const plusBtn = document.createElement('button');
          plusBtn.className = 'sc-origin-btn';
          plusBtn.style.cssText = 'padding:1px 8px;font-size:12px;line-height:1;';
          plusBtn.textContent = '+';
          plusBtn.title = 'Add asset axis';
          plusBtn.onclick = e => {
            e.stopPropagation();
            sp.asset_axes.push('x');
            sp.asset_src_axes.push('x');
            S.dirty = true; rebuildAxesRows(); autoSave();
          };
          row.appendChild(plusBtn);
          body.insertBefore(row, axisAnchor);
        }

        // ── Set BPs in Asset button ──
        const bpBtnRow = document.createElement('div');
        bpBtnRow.className = 'sc-row axis-dyn-row';
        bpBtnRow.style.cssText = 'padding:4px 0 2px;gap:3px;';
        const bpBtn = document.createElement('button');
        bpBtn.className = 'sc-origin-btn';
        bpBtn.style.cssText = 'flex:1;min-width:0;font-size:9px;padding:3px 6px;letter-spacing:.04em;color:var(--text2);border-color:var(--border);background:rgba(255,255,255,.05);';
        const _bpRefId = sp.asset_bp?.ref_space_id;
        const _bpRefSp = _bpRefId
          ? (S.spaces[_bpRefId] ?? _bpProjCache[sp.asset_bp?.ref_proj_id]?.spaces?.[_bpRefId])
          : null;
        bpBtn.textContent = _bpRefSp
          ? `\u229f BPs set (\u2192 ${(_bpRefSp.name || _bpRefId).slice(0,20)})`
          : '\u229f Set BPs in Asset';
        bpBtn.title = 'Define bounding points of this space within a reference AssetSpace';
        bpBtn.onclick = e => { e.stopPropagation(); openBPPicker(sp.id); };
        bpBtnRow.appendChild(bpBtn);
        if (sp.asset_bp) {
          const bpDelBtn = document.createElement('button');
          bpDelBtn.className = 'sc-origin-btn';
          bpDelBtn.style.cssText = 'flex-shrink:0;padding:1px 7px;font-size:12px;line-height:1;color:var(--text3);';
          bpDelBtn.textContent = '\u00d7';
          bpDelBtn.title = 'Remove BP-in-Asset mapping';
          bpDelBtn.onclick = e => {
            e.stopPropagation();
            delete sp.asset_bp;
            S.dirty = true; rebuildAxesRows(); autoSave();
          };
          bpBtnRow.appendChild(bpDelBtn);
        }
        body.insertBefore(bpBtnRow, axisAnchor);
      }
    }
  }

  rebuildAxesRows();   // called BEFORE comment section is appended

  // ── Comment row — always AFTER axis rows ──
  const commentSection = document.createElement('div');
  commentSection.className = 'sc-row';
  commentSection.style.cssText = 'flex-direction:column;align-items:stretch;gap:3px;padding:4px 0 2px;';

  const commentHdr = document.createElement('div');
  commentHdr.style.cssText = 'display:flex;align-items:center;gap:4px;';

  const commentLbl = document.createElement('span');
  commentLbl.className   = 'lbl';
  commentLbl.textContent = 'comment';
  commentLbl.style.width = 'auto';

  const commentOcrBtn = document.createElement('button');
  commentOcrBtn.className     = 'sc-ocr-btn';
  commentOcrBtn.textContent   = 'OCR';
  commentOcrBtn.title         = 'Draw a box in the viewer to read text into comment';
  commentOcrBtn.style.marginLeft = 'auto';
  commentOcrBtn.onclick = (e) => { e.stopPropagation(); startOCR(sp.id, commentOcrBtn, 'comment'); };

  commentHdr.appendChild(commentLbl);
  commentHdr.appendChild(commentOcrBtn);

  const commentTA = document.createElement('textarea');
  commentTA.style.cssText = `width:100%;background:rgba(255,255,255,.06);border:1px solid var(--border);
    color:var(--text2);padding:3px 6px;border-radius:3px;font-size:9.5px;font-family:var(--mono);
    outline:none;resize:vertical;min-height:34px;margin-top:2px;`;
  commentTA.placeholder = 'comment about this space…';
  commentTA.value       = sp.comment || '';
  commentTA.oninput = () => { sp.comment = commentTA.value; S.dirty = true; autoSave(); };
  commentTA.onfocus = () => { S.panelFocus = true; };
  commentTA.onblur  = () => { S.panelFocus = false; };

  commentSection.appendChild(commentHdr);
  commentSection.appendChild(commentTA);
  body.appendChild(commentSection);   // appended last — always below axes

  card.appendChild(body);

  // ── Sub-space buttons ──
  const addRow = document.createElement('div'); addRow.className='sc-add-row';
  const addDoc = document.createElement('button'); addDoc.className='sc-add-btn';
  addDoc.textContent='+ Doc';
  addDoc.onclick=(e)=>{e.stopPropagation(); addChildSpace('DocumentSpace',sp.id);};
  const addVol = document.createElement('button'); addVol.className='sc-add-btn';
  addVol.textContent='+ Vol';
  addVol.onclick=(e)=>{e.stopPropagation(); addChildSpace('VolumeSpace',sp.id);};
  const addLine = document.createElement('button'); addLine.className='sc-add-btn';
  addLine.textContent='+ Line';
  addLine.onclick=(e)=>{e.stopPropagation(); addChildSpace('LineSpace',sp.id);};
  const addPt = document.createElement('button'); addPt.className='sc-add-btn';
  addPt.textContent='+ Point';
  addPt.onclick=(e)=>{e.stopPropagation(); addChildSpace('PointSpace',sp.id);};
  addRow.appendChild(addDoc); addRow.appendChild(addVol); addRow.appendChild(addLine); addRow.appendChild(addPt);
  card.appendChild(addRow);

  return card;
} // end buildCard

function mkCoordInput(val, onchange) {
  const inp = document.createElement('input');
  inp.type='number'; inp.step='0.001'; inp.min='0'; inp.max='1';
  inp.className='sc-coord'; inp.value=val;
  inp.oninput=()=>{ const v=parseFloat(inp.value); if(!isNaN(v)) onchange(r5(v)); };
  return inp;
}

function setOriginInteractive(id) {
  notify('Click a corner in the viewer to set origin', 3000);
  // One-shot click listener on canvas
  const canvasContainer = document.getElementById('canvas-container');
  const handler = (e) => {
    if (e.button!==0) return;
    const sp = S.spaces[id]; if (!sp?.bbox) return;
    const d = docXY(e.clientX, e.clientY);
    const rb = bboxRootNorm(sp.bbox, sp.parent_id);
    // Determine nearest corner
    const corners = [
      {name:'top_left',    x:rb.left,  y:rb.top},
      {name:'top_right',   x:rb.right, y:rb.top},
      {name:'bottom_left', x:rb.left,  y:rb.bottom},
      {name:'bottom_right',x:rb.right, y:rb.bottom},
    ];
    const nx=d.x/W(), ny=d.y/H();
    let best=corners[0], bestD=Infinity;
    corners.forEach(co=>{const dd=Math.hypot(co.x-nx,co.y-ny); if(dd<bestD){bestD=dd;best=co;}});
    sp.origin=best.name; S.dirty=true;
    renderAnnotations(); renderSpacesPanel(); autoSave();
    canvasContainer.removeEventListener('mousedown', handler, true);
  };
  canvasContainer.addEventListener('mousedown', handler, true);
}

function setOriginFromClick(id) {
  notify('Click in viewer to set point origin', 2500);
  const canvasContainer2 = document.getElementById('canvas-container');
  const handler = (e) => {
    if (e.button!==0) return;
    const sp = S.spaces[id]; if (!sp) return;
    const d = docXY(e.clientX, e.clientY);
    sp.point = ptToParentRel({x:d.x/W(), y:d.y/H()}, sp.parent_id);
    S.dirty=true; renderAnnotations(); renderSpacesPanel(); autoSave();
    canvasContainer2.removeEventListener('mousedown', handler, true);
  };
  canvasContainer2.addEventListener('mousedown', handler, true);
}

// ════════════════════════════════════════════════════════════════
// SIDEBAR RESIZE
// ════════════════════════════════════════════════════════════════
function setupDedupColResizers() {
  const root = document.documentElement;
  // Resizers are now inside each column header span; use parentElement as the column
  document.querySelectorAll('#dedup-list-header .dedup-col-resizer').forEach(handle => {
    const col = handle.parentElement;
    const colName = col?.dataset.col;
    if (!colName) return;
    const varName = `--dcol-${colName}`;
    let startX = 0, startW = 0, lastW = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      startX = e.clientX;
      startW = col.offsetWidth;
      lastW = startW;
      handle.classList.add('dragging');
      const onMove = (e) => {
        lastW = Math.max(30, startW + (e.clientX - startX));
        root.style.setProperty(varName, lastW + 'px');
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        localStorage.setItem(`dcol_${colName}`, lastW + 'px');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function setupResizers() {
  setupResizer('left-resizer',  'left-panel',  'left');
  setupResizer('right-resizer', 'right-panel', 'right');
}

function setupResizer(handleId, panelId, side) {
  const handle = document.getElementById(handleId);
  const panel  = document.getElementById(panelId);
  if (!handle || !panel) return;

  let startX = 0, startW = 0;

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add('dragging');

    const onMove = (e) => {
      const delta = e.clientX - startX;
      // Left panel: drag right edge → positive delta = wider
      // Right panel: drag left edge → negative delta = wider
      const newW = side === 'left' ? startW + delta : startW - delta;
      const minW = parseInt(getComputedStyle(panel).minWidth) || 100;
      const maxW = parseInt(getComputedStyle(panel).maxWidth) || 600;
      panel.style.width = Math.max(minW, Math.min(maxW, newW)) + 'px';
      // Sync header counterparts with panel
      if (panelId === 'right-panel') {
        const hw = document.getElementById('header-export-wrap');
        if (hw) hw.style.width = panel.style.width;
      }
      if (panelId === 'left-panel') {
        const lw = document.getElementById('logo-wrap');
        if (lw) lw.style.width = panel.style.width;
      }
      // Trigger label rerender since canvas width changed
      renderLabels();
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem(`panel_${side}`, panel.style.width);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function restoreLayout() {
  const root = document.documentElement;
  // Restore graph editor column widths
  ['type', 'state', 'bp', 'addtype'].forEach(col => {
    const saved = localStorage.getItem(`dcol_${col}`);
    if (saved) root.style.setProperty(`--dcol-${col}`, saved);
  });
  // Restore panel widths
  ['left', 'right'].forEach(side => {
    const saved = localStorage.getItem(`panel_${side}`);
    const panel = document.getElementById(side + '-panel');
    if (saved && panel) {
      panel.style.width = saved;
      if (side === 'right') {
        const hw = document.getElementById('header-export-wrap');
        if (hw) hw.style.width = saved;
      }
      if (side === 'left') {
        const lw = document.getElementById('logo-wrap');
        if (lw) lw.style.width = saved;
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════
// OCR
// ════════════════════════════════════════════════════════════════
let ocrState = { active: false, spaceId: null, btn: null, field: 'name', draw: {on:false,sx:0,sy:0} };

// Cached Tesseract worker — created once, reused for all OCR calls
let _ocrWorker = null;
let _ocrWorkerReady = false;
let _ocrWorkerLoading = null;   // Promise while loading

async function getOCRWorker() {
  if (_ocrWorker && _ocrWorkerReady) return _ocrWorker;
  if (_ocrWorkerLoading) return _ocrWorkerLoading;   // already booting

  _ocrWorkerLoading = (async () => {
    setStatus('Loading OCR engine…');
    if (typeof Tesseract === 'undefined' || typeof Tesseract.createWorker !== 'function') {
      throw new Error('Tesseract not loaded — check browser console for network errors');
    }
    const w = await Tesseract.createWorker('deu', 1, {
      logger: m => { if (m.status === 'recognizing text') setStatus(`OCR ${Math.round(m.progress*100)}%`); },
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    });
    await w.setParameters({
      tessedit_char_whitelist: '',
      preserve_interword_spaces: '1',
    });
    _ocrWorker = w;
    _ocrWorkerReady = true;
    _ocrWorkerLoading = null;
    return w;
  })();
  return _ocrWorkerLoading;
}

// In startOCR(), add the cursor class:
function startOCR(spaceId, btn, field='name') {
  if (ocrState.active && ocrState.spaceId === spaceId && ocrState.field === field) {
    cancelOCR(); return;
  }
  cancelOCR();
  ocrState.active  = true;
  ocrState.spaceId = spaceId;
  ocrState.btn     = btn;
  ocrState.field   = field;
  btn.classList.add('ocr-active');
  setMode('select');
  document.getElementById('canvas-container').classList.add('ocr-drawing');  // ← ADD
  notify(`Draw a box around text — will fill ${field}`, 3500);
  const c = document.getElementById('canvas-container');
  c.addEventListener('mousedown', ocrMD, true);
}

// In cancelOCR(), remove the cursor class:
function cancelOCR() {
  if (!ocrState.active) return;
  const c = document.getElementById('canvas-container');
  c.removeEventListener('mousedown', ocrMD, true);
  document.removeEventListener('mousemove', ocrMM);
  document.removeEventListener('mouseup',   ocrMU);
  document.getElementById('ocr-rect').style.display = 'none';
  document.getElementById('canvas-container').classList.remove('ocr-drawing');  // ← ADD
  if (ocrState.btn) ocrState.btn.classList.remove('ocr-active');
  ocrState = { active:false, spaceId:null, btn:null, field:'name', draw:{on:false,sx:0,sy:0} };
}

function ocrMD(e) {
  if (e.button !== 0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  const d = docXY(e.clientX, e.clientY);
  ocrState.draw = { on:true, sx:d.x, sy:d.y };
  const r = document.getElementById('ocr-rect');
  r.style.display = 'block';
  updOCRRect(d.x, d.y, d.x, d.y);
  document.addEventListener('mousemove', ocrMM);
  document.addEventListener('mouseup',   ocrMU);
}

function ocrMM(e) {
  if (!ocrState.draw.on) return;
  const d = docXY(e.clientX, e.clientY);
  updOCRRect(ocrState.draw.sx, ocrState.draw.sy, d.x, d.y);
}

function updOCRRect(x1,y1,x2,y2) {
  const r = document.getElementById('ocr-rect');
  r.style.left   = (Math.min(x1,x2)*S.zoom + S.panX) + 'px';
  r.style.top    = (Math.min(y1,y2)*S.zoom + S.panY) + 'px';
  r.style.width  = Math.abs(x2-x1)*S.zoom + 'px';
  r.style.height = Math.abs(y2-y1)*S.zoom + 'px';
}

async function ocrMU(e) {
  if (!ocrState.draw.on) return;
  ocrState.draw.on = false;
  document.removeEventListener('mousemove', ocrMM);
  document.removeEventListener('mouseup',   ocrMU);
  document.getElementById('ocr-rect').style.display = 'none';

  const d = docXY(e.clientX, e.clientY);
  const x1 = Math.min(ocrState.draw.sx, d.x), y1 = Math.min(ocrState.draw.sy, d.y);
  const x2 = Math.max(ocrState.draw.sx, d.x), y2 = Math.max(ocrState.draw.sy, d.y);
  if ((x2-x1) < 5 || (y2-y1) < 5) { cancelOCR(); return; }

  const spaceId = ocrState.spaceId;
  const field   = ocrState.field;   // 'name' or 'comment'
  cancelOCR();

  setStatus('Running OCR…');
  try {
    const img = document.getElementById('doc-canvas');
    // Temporarily clear CSS filter so drawImage captures raw pixels unaffected by
    // flatten / dark-mode invert — CSS filters are display-only but we clear
    // explicitly to be safe in all browsers.
    const savedFilter = img.style.filter;
    img.style.filter = 'none';
    const offscreen = document.createElement('canvas');
    offscreen.width  = Math.round(x2 - x1);
    offscreen.height = Math.round(y2 - y1);
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(img,
      Math.round(x1), Math.round(y1), offscreen.width, offscreen.height,
      0, 0, offscreen.width, offscreen.height
    );
    img.style.filter = savedFilter;  // restore flatten / dark-mode filter immediately

    const blob = await new Promise(res => offscreen.toBlob(res, 'image/png'));

    // Preprocess: increase contrast for better umlaut recognition
    const procCanvas = document.createElement('canvas');
    procCanvas.width  = offscreen.width  * 2;   // upscale 2×
    procCanvas.height = offscreen.height * 2;
    const pctx = procCanvas.getContext('2d');
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(offscreen, 0, 0, procCanvas.width, procCanvas.height);

    // Boost contrast via pixel manipulation
    const imgData = pctx.getImageData(0, 0, procCanvas.width, procCanvas.height);
    const px = imgData.data;
    for (let i = 0; i < px.length; i += 4) {
      // greyscale
      const g = 0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2];
      // contrast stretch: push towards black or white
      const c = g < 128 ? Math.max(0, g - 40) : Math.min(255, g + 40);
      px[i] = px[i+1] = px[i+2] = c;
    }
    pctx.putImageData(imgData, 0, 0);

    const procBlob = await new Promise(res => procCanvas.toBlob(res, 'image/png'));

    // Use cached worker (language data downloaded only on first call)
    const worker = await getOCRWorker();
    const result = await worker.recognize(procBlob);

    const text = result.data.text.trim().replace(/\s+/g, ' ');
    if (text && S.spaces[spaceId]) {
      if (field === 'comment') {
        // Append to existing comment rather than overwrite
        const existing = S.spaces[spaceId].comment || '';
        S.spaces[spaceId].comment = existing ? existing + ' ' + text : text;
      } else {
        S.spaces[spaceId].name = text;
      }
      S.dirty = true;
      renderAnnotations(); renderSpacesPanel(); autoSave();
      notify(`OCR → ${field}: ` + text.substring(0, 50));
    } else {
      notify('OCR: no text found');
    }
  } catch(err) {
    notify('OCR error: ' + err.message);
    console.error(err);
  }
  setStatus('ready');
}

// ════════════════════════════════════════════════════════════════
// KEYBOARD
// ════════════════════════════════════════════════════════════════
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (!e.ctrlKey && !e.metaKey && (e.key==='s'||e.key==='S')) setMode('select');
    if (!e.shiftKey && (e.key==='d'||e.key==='D')) setMode('bbox');
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key==='d'||e.key==='D')) { e.preventDefault(); toggleViewerDarkMode(); }
    if (!e.ctrlKey && !e.metaKey && (e.key==='v'||e.key==='V')) setMode('volume');
    if (!e.ctrlKey && !e.metaKey && (e.key==='o'||e.key==='O')) { e.preventDefault(); DP.open ? closeDedupPanel() : openDedupPanel(); }
    if (!e.ctrlKey && !e.metaKey && (e.key==='p'||e.key==='P')) setMode('point');
    if ((e.ctrlKey||e.metaKey) && (e.key==='p'||e.key==='P')) { e.preventDefault(); togglePropertyPanelMode(); }
    if (e.key==='l'||e.key==='L') setMode('vector');
    if (e.key==='q'||e.key==='Q') { e.preventDefault(); SQ.open ? closeSparqlPanel() : openSparqlPanel(); }
    if (!e.shiftKey && (e.key==='h'||e.key==='H')) { e.preventDefault(); toggleHideAnnotations(); }
    if (e.shiftKey  && (e.key==='h'||e.key==='H')) { e.preventDefault(); toggleHideLabels(); }
    if (e.key==='f'||e.key==='F') toggleFlattenImage();
    if (e.key==='2') zoomFit();
    if (e.key==='1') zoom100();
    if (e.key==='Delete'||e.key==='Backspace') { if(S.selId) deleteSpaceById(S.selId); }
    if (e.key==='+'||e.key==='=') zoomIn();
    if (e.key==='-') zoomOut();
    if ((e.ctrlKey||e.metaKey)&&e.key==='s') { e.preventDefault(); saveSpaces(S.cur?.id); }
    if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z') { e.preventDefault(); undo(); }
    if ((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='z')  { e.preventDefault(); redo(); }
    if ((e.ctrlKey||e.metaKey)&&e.key==='y')               { e.preventDefault(); redo(); }
    if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='c') { if (isAlignCopyTarget()) { e.preventDefault(); copyAlignments(); } }
    if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='v') { if (isAlignCopyTarget()) { e.preventDefault(); pasteAlignments(); } }
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key==='a'||e.key==='A')) { e.preventDefault(); toggleAllCollapsed(); }
    if (e.ctrlKey && !e.altKey  && !e.shiftKey && (e.key==='b'||e.key==='B')) { e.preventDefault(); document.getElementById('left-panel').classList.toggle('panel-hidden'); _resetSparqlTtlFlex(); }
    if (e.ctrlKey && e.altKey   && !e.shiftKey && (e.key==='b'||e.key==='B')) { e.preventDefault(); document.getElementById('right-panel').classList.toggle('panel-hidden'); _resetSparqlTtlFlex(); }
  });
}

function togglePropertyPanelMode() {
  S.propertyPanelMode = !S.propertyPanelMode;
  renderAnnotations();
  const msg = S.propertyPanelMode ? 'Property Panel Mode: ON (only selected space editable)' : 'Property Panel Mode: OFF';
  notify(msg, 2500);
}

// ════════════════════════════════════════════════════════════════
// ALIGNMENT COPY / PASTE
// ════════════════════════════════════════════════════════════════
let _alignClipboard = null;
let _globalEntityNames = [];    // entity names pooled across all projects
let _globalEntityClasses = {}; // entity class associations — global, cross-file
let _globalOntologies   = []; // ontologies — global, cross-file

// Persist latest _globalOntologies to the backend.
function _saveGlobalOntologies() {
  fetch('/api/ontologies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(_globalOntologies),
  }).catch(() => {});
}

// Returns the merged entity class associations for an entity name.
// Reads from the global in-memory store (populated via /api/entity_classes).
function _getEntityClasses(entityName) {
  const ek = _jsSafe(entityName || '');
  return _globalEntityClasses[ek] || [];
}

function _assocKind(assoc) {
  return ((assoc?.kind || 'class') + '').toLowerCase() === 'instance' ? 'instance' : 'class';
}

// Returns true when Ctrl+C/V should trigger alignment copy/paste.
// Only fires when a space is selected AND focus is NOT inside the property panel
// (right-panel) or file browser (left-panel), so normal text copy still works there.
function isAlignCopyTarget() {
  if (!S.selId) return false;
  const active = document.activeElement;
  const rp = document.getElementById('right-panel');
  const lp = document.getElementById('left-panel');
  if (rp && rp.contains(active)) return false;
  if (lp && lp.contains(active)) return false;
  return true;
}

async function refreshGlobalEntities() {
  try {
    const [namesResp, classesResp, ontosResp] = await Promise.all([
      fetch('/api/entities'),
      fetch('/api/entity_classes'),
      fetch('/api/ontologies'),
    ]);
    _globalEntityNames   = await namesResp.json();
    _globalEntityClasses = await classesResp.json();
    const ontos = await ontosResp.json();
    _globalOntologies = Array.isArray(ontos) ? ontos : [];
    DP.ontologies = _globalOntologies;
    _renderOntologyList();
  } catch(e) { /* non-critical */ }
}

function copyAlignments() {
  const sp = S.selId && S.spaces[S.selId];
  if (!sp) { notify('Select a space first (Ctrl+C)', 2500); return; }
  _alignClipboard = {
    type:           sp.type,
    axes:           sp.axes           ? [...sp.axes]           : null,
    src_axes:       sp.src_axes       ? [...sp.src_axes]       : null,
    target_asset:   sp.target_asset   || false,
    asset_axes:     sp.asset_axes     ? [...sp.asset_axes]     : null,
    asset_src_axes: sp.asset_src_axes ? [...sp.asset_src_axes] : null,
  };
  notify(`Alignments copied from "${sp.name}"  —  Ctrl+V to paste`, 3000);
}

function pasteAlignments() {
  const sp = S.selId && S.spaces[S.selId];
  if (!sp) { notify('Select a target space first (Ctrl+V)', 2500); return; }
  if (!_alignClipboard) { notify('Nothing copied yet  —  Ctrl+C to copy', 2500); return; }
  if (_alignClipboard.type !== sp.type) {
    notify(`Type mismatch: copied from ${_alignClipboard.type}, target is ${sp.type}`, 3000);
    return;
  }
  snapshot();
  if (_alignClipboard.axes)           sp.axes           = [..._alignClipboard.axes];
  if (_alignClipboard.src_axes)       sp.src_axes       = [..._alignClipboard.src_axes];
  sp.target_asset = _alignClipboard.target_asset;
  if (_alignClipboard.asset_axes)     sp.asset_axes     = [..._alignClipboard.asset_axes];
  if (_alignClipboard.asset_src_axes) sp.asset_src_axes = [..._alignClipboard.asset_src_axes];
  syncLegacyAxes(sp);
  renderAnnotations(); renderSpacesPanel(); autoSave();
  // scroll pasted card into view
  const card = document.querySelector(`.space-card[data-space-id="${sp.id}"]`);
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  notify(`Alignments pasted onto "${sp.name}"`, 3000);
}

// ════════════════════════════════════════════════════════════════
// SAVE / EXPORT
// ════════════════════════════════════════════════════════════════
let saveTimer=null;
let ttlTimer=null;
// Schedule a TTL viewer refresh 2s after the last edit (debounced).
// Fired from autoSave so TTL always updates at least 1.3s after the data save.
function scheduleTtlRefresh() {
  if (!document.getElementById('sparql-ttl-wrap')?.classList.contains('open')) return;
  clearTimeout(ttlTimer);
  ttlTimer = setTimeout(loadTtlContent, 2000);
}
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{ if(S.cur) saveSpaces(S.cur.id); }, 700);
  scheduleTtlRefresh();
  if (DP.open) renderDedupSpaceList();  // keep dedup list in sync with all space mutations
}
async function saveSpaces(pid) {
  if (!pid) return;
  try {
    await fetch(`/api/project/${pid}/spaces`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ spaces:S.spaces, meta:S.cur?.meta||{}, ontologies:DP.ontologies })
    });
    S.dirty=false; setStatus('saved ✓'); setTimeout(()=>setStatus('ready'),2000);
    // Keep dedup cache fresh so env/all modes reflect latest annotations without re-fetch.
    if (_dedupFullCache.has(pid)) {
      const c = _dedupFullCache.get(pid);
      _dedupFullCache.set(pid, { ...c, spaces: { ...S.spaces }, meta: S.cur?.meta || {} });
    }
    refreshGlobalEntities();  // keep cross-project entity pool fresh
    // TTL viewer is refreshed via scheduleTtlRefresh() (2s debounce from autoSave)
  } catch(e) { setStatus('save error'); }
}
async function exportRDF()  { if(!S.cur) return; await saveSpaces(S.cur.id); window.open(`/api/project/${S.cur.id}/export/rdf`,'_blank'); }
function exportJSON() {
  if (!S.cur) return;

  const spaces = Object.values(S.spaces).map(sp => {
    const axes = sp.axes || [sp.x_axis||'x', sp.y_axis||'y'];
    const base = {
      id:           sp.id,
      type:         sp.type,
      name:         sp.name,
      parent_id:    sp.parent_id || null,
      axes:         axes,
      comment:      sp.comment || '',
      target_asset: sp.target_asset || false,
    };

    // If target_asset, add resolved semantic directions
    if (sp.target_asset) {
      base.asset_alignment = axes.map((code, i) => ({
        local_axis:   ['x','y','z'][i] || `axis_${i}`,
        maps_to:      code,
        asset_direction: axisToAssetLabel(code),
        asset_axis:   code.replace('inv_',''),
        inverted:     code.startsWith('inv_'),
      }));
      base.asset_space = {
        x: 'Rear',
        y: 'Left',
        z: 'Rear',
      };
    }

    if (sp.type === 'PointSpace') {
      base.point = { x: sp.point.x, y: sp.point.y };
    } else if (sp.type === 'LineSpace') {
      base.start  = { x: sp.start.x, y: sp.start.y, z: sp.start.z ?? 0.5 };
      base.end    = { x: sp.end.x,   y: sp.end.y,   z: sp.end.z   ?? 0.5 };
      base.dashed = sp.dashed || false;
    } else {
      base.bbox   = sp.bbox;
      base.origin = sp.origin || 'top_left';
      base.dashed = sp.dashed || false;
    }

    return base;
  });

  const out = {
    id:            S.cur.id,
    original_name: S.cur.original_name,
    meta:          S.cur.meta || {},
    asset_space:   { x:'Rear', y:'Left', z:'Rear' },
    spaces,
  };

  const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = (S.cur.original_name||'export').replace(/\.[^.]+$/,'') + '_spaces.json';
  a.click();
  notify('JSON exported');
}

async function exportAllJSON() {
  const resp = await fetch('/api/export/all-json');
  const blob = await resp.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'all_spaces.json';
  a.click();
  notify('All projects exported');
}

async function exportAllRDF() {
  const resp = await fetch('/api/export/all-rdf');
  const blob = await resp.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'all_spaces.ttl';
  a.click();
  notify('All projects RDF exported');
}


// ════════════════════════════════════════════════════════════════
// IMAGE FILTERS
// ════════════════════════════════════════════════════════════════
let isFlattened        = false;
let isLabelsHidden     = false;
let isAnnotationsHidden = false;

// ── Canvas filter: combines dark-mode invert + flatten ──────────────
function getDocFilter() {
    const dark = document.getElementById('canvas-container')?.classList.contains('viewer-dark') ?? false;
    const parts = [];
    if (dark) parts.push('invert(1) brightness(.8)');
    if (isFlattened) {
        // Light mode: grayscale + high contrast + bright
        // Dark mode: grayscale + moderate contrast + normal brightness
        const flattenFilter = dark
            ? 'grayscale(100%) contrast(60%) brightness(20%)'
            : 'grayscale(100%) contrast(10%) brightness(180%)';
        parts.push(flattenFilter);
    }
    return parts.join(' ') || 'none';
}
function applyDocFilter() {
  const canvas = document.getElementById('doc-canvas');
  if (canvas) canvas.style.filter = getDocFilter();
}

function toggleFlattenImage() {
  isFlattened = !isFlattened;
  const btn = document.getElementById('btn-flatten');
  if (isFlattened) {
    btn.classList.add('active');
    notify('Flatten ON');
  } else {
    btn.classList.remove('active');
    notify('Flatten OFF');
  }
  applyDocFilter();
}

function toggleHideLabels() {
  isLabelsHidden = !isLabelsHidden;
  const btn     = document.getElementById('btn-hide-labels');
  const overlay = document.getElementById('label-overlay');
  if (isLabelsHidden) {
    if (overlay) overlay.style.display = 'none';
    btn.classList.add('active');
    notify('Labels hidden');
  } else {
    if (overlay) overlay.style.display = '';
    btn.classList.remove('active');
    notify('Labels visible');
  }
}

function toggleHideAnnotations() {
  isAnnotationsHidden = !isAnnotationsHidden;
  const btn         = document.getElementById('btn-hide-annotations');
  const annoLayer   = document.getElementById('anno-layer');
  const pointOver   = document.getElementById('point-overlay');
  const labelOver   = document.getElementById('label-overlay');
  if (isAnnotationsHidden) {
    if (annoLayer)  annoLayer.style.display  = 'none';
    if (pointOver)  pointOver.style.display  = 'none';
    if (labelOver)  labelOver.style.display  = 'none';
    btn.classList.add('active');
    notify('Annotations hidden');
  } else {
    if (annoLayer)  annoLayer.style.display  = '';
    if (pointOver)  pointOver.style.display  = '';
    // only restore label-overlay if Hide Labels is not active
    if (labelOver)  labelOver.style.display  = isLabelsHidden ? 'none' : '';
    btn.classList.remove('active');
    notify('Annotations visible');
  }
}

function applyImageFilter() {
    const brightness = document.getElementById('sl-brightness').value;
    const hue        = document.getElementById('sl-hue').value;
    const saturation = document.getElementById('sl-saturation').value;
    const contrast   = document.getElementById('sl-contrast').value;

    document.getElementById('val-brightness').textContent = brightness + '%';
    document.getElementById('val-hue').textContent        = hue + '°';
    document.getElementById('val-saturation').textContent = saturation + '%';
    document.getElementById('val-contrast').textContent   = contrast + '%';

    const f = [
        `brightness(${brightness}%)`,
        `hue-rotate(${hue}deg)`,
        `saturate(${saturation}%)`,
        `contrast(${contrast}%)`,
    ].join(' ');

    // Apply filter to annotation frames only — doc-canvas is unaffected
    const annoLayer     = document.getElementById('anno-layer');
    const pointOverlay  = document.getElementById('point-overlay');
    if (annoLayer)    annoLayer.style.filter    = f;
    if (pointOverlay) pointOverlay.style.filter = f;

    // Restore doc-canvas filter (dark mode + flatten) — do not hard-code 'none'
    const canvas = document.getElementById('doc-canvas');
    if (canvas) applyDocFilter();
}

function resetImageFilter() {
  document.getElementById('sl-brightness').value = 100;
  document.getElementById('sl-hue').value        = 0;
  document.getElementById('sl-saturation').value = 100;
  document.getElementById('sl-contrast').value   = 100;
  applyImageFilter();
}


// ════════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════════
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setStatus(t) { document.getElementById('status-text').textContent=t; }
function notify(msg,d=2500) {
  const el=document.getElementById('notif');
  el.textContent=msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),d);
}

// ════════════════════════════════════════════════════════════════
// SPARQL PANEL
// ════════════════════════════════════════════════════════════════
function toggleFileMeta() {
  const body = document.getElementById('fm-body');
  const btn  = document.getElementById('fm-toggle-btn');
  const section = document.getElementById('file-meta-section');
  if (!body || !btn || !section) return;
  const isNowCollapsed = body.style.display !== 'none';
  body.style.display = isNowCollapsed ? 'none' : '';
  btn.textContent = isNowCollapsed ? '▶' : '▼';
  btn.classList.toggle('collapsed', isNowCollapsed);
  section.classList.toggle('fm-collapsed', isNowCollapsed);
}
window.toggleFileMeta = toggleFileMeta;

function toggleViewerDarkMode() {
  document.getElementById('canvas-container')?.classList.toggle('viewer-dark');
  applyDocFilter();
  renderAnnotations();
}
window.toggleViewerDarkMode = toggleViewerDarkMode;

// ── Panel open / close ──
function openAIPanel() {
  AI.open = true;
  const panel = document.getElementById('ai-panel');
  const viewerH = document.getElementById('viewer-area')?.offsetHeight || 400;
  panel.style.height = viewerH + 'px';
  panel.classList.add('open');
  document.getElementById('btn-chat')?.classList.add('active');
  loadAIKey();
  updateAIContextBadge();
  syncGGUFModelSelector();
  document.getElementById('ai-input').focus();
}

function closeAIPanel() {
  AI.open = false;
  document.getElementById('ai-panel').classList.remove('open');
  document.getElementById('btn-chat')?.classList.remove('active');
}

// ── Resize: drag top edge of panel ──
(function () {
  let rszOn = false, startY = 0, startH = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const rszr = document.getElementById('ai-panel-resizer');
    const panel = document.getElementById('ai-panel');
    if (!rszr || !panel) return;
    rszr.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      rszOn = true; startY = e.clientY; startH = panel.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!rszOn) return;
      const delta = startY - e.clientY;   // drag up → taller
      const viewerH = document.getElementById('viewer-area').offsetHeight;
      const newH = Math.max(60, Math.min(viewerH, startH + delta));
      panel.style.height = newH + 'px';
    });
    document.addEventListener('mouseup', () => { rszOn = false; });
  });
})();

// ════════════════════════════════════════════════════════════════
// SPARQL PANEL
// ════════════════════════════════════════════════════════════════

function openSparqlPanel() {
  SQ.open = true;
  const panel = document.getElementById('sparql-panel');
  const viewerH = document.getElementById('viewer-area')?.offsetHeight || 400;
  panel.style.height = viewerH + 'px';
  panel.classList.add('open');
  document.getElementById('btn-sparql').classList.add('active');
  if (SQ.presets.length === 0) loadSparqlPresets();
  document.getElementById('sparql-editor').focus();
}

function closeSparqlPanel() {
  SQ.open = false;
  document.getElementById('sparql-panel').classList.remove('open');
  document.getElementById('btn-sparql').classList.remove('active');
}

// ── Drag top edge to resize panel height ──
(function () {
  let rszOn = false, startY = 0, startH = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const rszr  = document.getElementById('sparql-panel-resizer');
    const panel = document.getElementById('sparql-panel');
    if (!rszr || !panel) return;
    rszr.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      rszOn = true; startY = e.clientY; startH = panel.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    let _rH = 0, _rRaf = false;
    document.addEventListener('mousemove', e => {
      if (!rszOn) return;
      const delta = startY - e.clientY;
      const viewerH = document.getElementById('viewer-area').offsetHeight;
      _rH = Math.max(80, Math.min(viewerH, startH + delta));
      if (!_rRaf) { _rRaf = true; requestAnimationFrame(() => { panel.style.height = _rH + 'px'; _rRaf = false; }); }
    });
    document.addEventListener('mouseup', () => { rszOn = false; });
  });
})();

// ── Drag internal divider between editor and results ──
(function () {
  let divOn = false, startY = 0, startEH = 0, startRH = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const divider  = document.getElementById('sparql-divider');
    const edWrap   = document.getElementById('sparql-editor-wrap');
    const resWrap  = document.getElementById('sparql-results-wrap');
    if (!divider || !edWrap || !resWrap) return;
    divider.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      divOn   = true;
      startY  = e.clientY;
      startEH = edWrap.offsetHeight;
      startRH = resWrap.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    let _dEH = 0, _dRH = 0, _dRaf = false;
    document.addEventListener('mousemove', e => {
      if (!divOn) return;
      const delta = e.clientY - startY;
      _dEH = Math.max(40, startEH + delta);
      _dRH = Math.max(40, startRH - delta);
      edWrap.style.flex = 'none'; resWrap.style.flex = 'none';
      if (!_dRaf) { _dRaf = true; requestAnimationFrame(() => { edWrap.style.height = _dEH + 'px'; resWrap.style.height = _dRH + 'px'; _dRaf = false; }); }
    });
    document.addEventListener('mouseup', () => { divOn = false; });
  });
})();

// ── Drag vertical divider between left-column and TTL viewer ──
(function () {
  let vOn = false, startX = 0, startLW = 0, startRW = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const vdiv  = document.getElementById('sparql-vert-divider');
    const left  = document.getElementById('sparql-left');
    const right = document.getElementById('sparql-ttl-wrap');
    if (!vdiv || !left || !right) return;
    vdiv.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      vOn = true; startX = e.clientX;
      startLW = left.offsetWidth; startRW = right.offsetWidth;
      e.preventDefault(); e.stopPropagation();
    });
    let _vLW = 0, _vRaf = false;
    document.addEventListener('mousemove', e => {
      if (!vOn) return;
      const delta = e.clientX - startX;
      _vLW = Math.max(80, startLW + delta);
      // Only fix left width; right always fills remaining space via flex:1
      left.style.flex = 'none';
      right.style.flex = '1 1 0';
      right.style.width = '';
      if (!_vRaf) { _vRaf = true; requestAnimationFrame(() => { left.style.width = _vLW + 'px'; _vRaf = false; }); }
    });
    document.addEventListener('mouseup', () => { vOn = false; });
  });
})();

// ── Load presets from backend ──
async function loadSparqlPresets() {
  try {
    const resp = await fetch('/api/sparql/queries');
    SQ.presets = await resp.json();
    _renderPresetDropdown();
  } catch (err) {
    console.error('Failed to load SPARQL presets:', err);
  }
}

function _renderPresetDropdown() {
  const btn  = document.getElementById('sparql-preset-btn');
  const list = document.getElementById('sparql-preset-list');
  if (!list || !btn) return;
  list.innerHTML = '';
  SQ.presets.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'preset-item';
    const name = document.createElement('span');
    name.className = 'preset-item-name';
    name.textContent = p.name;
    name.title = p.name;
    name.onclick = () => { sparqlPresetChange(i); _closePresetDropdown(); };
    const del = document.createElement('button');
    del.className = 'preset-item-del';
    del.textContent = '\u00d7';
    del.title = 'Delete preset';
    del.onclick = (e) => { e.stopPropagation(); deleteSparqlPreset(p.filename); };
    row.appendChild(name);
    row.appendChild(del);
    list.appendChild(row);
  });
  // Toggle open on button click
  btn.onclick = (e) => {
    e.stopPropagation();
    const hidden = list.hidden;
    _closePresetDropdown();
    if (hidden) { list.hidden = false; btn.classList.add('open'); }
  };
  // Close on outside click
  if (!document._presetDismiss) {
    document._presetDismiss = (e) => {
      if (!e.target.closest('#sparql-preset-wrap')) _closePresetDropdown();
    };
    document.addEventListener('click', document._presetDismiss);
  }
}

function _closePresetDropdown() {
  const list = document.getElementById('sparql-preset-list');
  const btn  = document.getElementById('sparql-preset-btn');
  if (list) list.hidden = true;
  if (btn)  btn.classList.remove('open');
}

function sparqlPresetChange(idx) {
  if (idx === '' || idx === null || idx === undefined) return;
  const preset = SQ.presets[parseInt(idx)];
  if (preset) {
    document.getElementById('sparql-editor').value = preset.content;
    document.getElementById('sparql-status').textContent = 'Preset loaded: ' + preset.name + '. Click Run to execute.';
    document.getElementById('sparql-results-table').innerHTML = '';
    const btn = document.getElementById('sparql-preset-btn');
    if (btn) btn.textContent = preset.name;
    // Pre-fill save name with preset's name
    const nameEl = document.getElementById('sparql-save-name');
    if (nameEl) nameEl.value = preset.name;
  }
}

async function deleteSparqlPreset(filename) {
  const preset = SQ.presets.find(p => p.filename === filename);
  if (!preset) return;
  if (!confirm('Delete preset "' + preset.name + '"?')) return;
  try {
    const resp = await fetch('/api/sparql/queries/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    const data = await resp.json();
    if (data.error) { alert('Delete failed: ' + data.error); return; }
    // If the deleted preset was shown in the button, reset it
    const btn = document.getElementById('sparql-preset-btn');
    if (btn && btn.textContent === preset.name) btn.textContent = '\u2014 select query \u2014';
    await loadSparqlPresets();
  } catch (err) {
    alert('Delete error: ' + err.message);
  }
}

async function saveSparqlPreset() {
  const nameEl  = document.getElementById('sparql-save-name');
  const name    = (nameEl?.value || '').trim();
  if (!name) { alert('Enter a preset name first.'); nameEl?.focus(); return; }
  const content = (document.getElementById('sparql-editor').value || '').trim();
  if (!content) { alert('Editor is empty — nothing to save.'); return; }
  const existing = SQ.presets.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing && !confirm('Overwrite preset "' + existing.name + '"?')) return;
  try {
    const resp = await fetch('/api/sparql/queries/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    const data = await resp.json();
    if (data.error) { alert('Save failed: ' + data.error); return; }
    document.getElementById('sparql-status').textContent =
      (data.status === 'updated' ? 'Updated' : 'Saved') + ': ' + data.filename;
    await loadSparqlPresets();
    // Update button label to the saved preset's name
    const idx = SQ.presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) {
      const btn = document.getElementById('sparql-preset-btn');
      if (btn) btn.textContent = SQ.presets[idx].name;
    }
  } catch (err) {
    alert('Save error: ' + err.message);
  }
}

/** Reset sparql-left / sparql-ttl-wrap back to flex after viewport width changes. */
function _resetSparqlTtlFlex() {
  const left  = document.getElementById('sparql-left');
  const right = document.getElementById('sparql-ttl-wrap');
  if (left)  { left.style.flex = ''; left.style.width = ''; }
  if (right) { right.style.flex = ''; right.style.width = ''; }
}

function toggleTtlViewer() {
  const wrap = document.getElementById('sparql-ttl-wrap');
  const vdiv = document.getElementById('sparql-vert-divider');
  const btn  = document.getElementById('sparql-ttl-btn');
  if (!wrap) return;
  const opening = !wrap.classList.contains('open');
  wrap.classList.toggle('open', opening);
  vdiv?.classList.toggle('open', opening);
  btn?.classList.toggle('active', opening);
  if (opening) {
    loadTtlContent();
  }
}

let _ttlRaw = '';
// _ttlEditMode removed — TTL is now always read-only, generated live from annotations

async function loadTtlContent() {
  const statusEl     = document.getElementById('sparql-ttl-status');
  const statusTextEl = document.getElementById('sparql-ttl-status-text');
  const viewer       = document.getElementById('sparql-ttl-viewer');
  if (!viewer) return;
  const _setStatus = msg => { if (statusTextEl) statusTextEl.textContent = msg; else if (statusEl) statusEl.textContent = msg; };

  // Save current spaces first so TTL reflects the latest annotations.
  if (S.cur && S.dirty) await saveSpaces(S.cur.id);

  const { projectIds, envId, allProjects } = _sparqlGetContext();
  // Nothing to load yet — no project open and no env selected
  if (!allProjects && !projectIds.length && !envId) {
    const hint = SQ.contextMode === 'all' ? '# No files loaded yet' : '# Open a file to generate TTL';
    viewer.innerHTML = `<span class="ttl-cmt">${hint}</span>`;
    _setStatus('');
    return;
  }

  _setStatus('Loading…');
  // Single-project, file-context mode → generate TTL from current annotations
  const singlePid = (!allProjects && projectIds.length === 1 && !envId) ? projectIds[0] : null;

  try {
    let ttl;
    if (singlePid) {
      const resp = await fetch(`/api/project/${singlePid}/ttl`);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      ttl = await resp.text();
    } else {
      const resp = await fetch('/api/sparql/ttl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_ids: projectIds, env_id: envId, all_projects: allProjects || false }),
      });
      const data = await resp.json();
      if (data.error) {
        _ttlRaw = '';
        viewer.innerHTML = '<span class="ttl-cmt"># Error: ' + _ttlEsc(data.error) + '</span>';
        _setStatus('Error loading TTL');
        return;
      }
      ttl = data.ttl;
    }
    _ttlRaw = ttl;
    _applyTtlDisplay(viewer, statusTextEl || statusEl);
  } catch (err) {
    _ttlRaw = '';
    viewer.innerHTML = '<span class="ttl-cmt"># Network error: ' + _ttlEsc(err.message) + '</span>';
    _setStatus('Error');
  }
}

let _ttlRenderGen = 0;

// ── Virtual-scrolling TTL viewer ─────────────────────────────────────────
// All highlighted lines are kept in a JS string array (_ttlLines).
// Only the lines currently visible in the viewport are ever put into the DOM.
// This keeps the DOM tiny (~60 nodes) regardless of file size.

const _TTL_LH  = 15.75; // 10.5px font × 1.5 line-height  (must match CSS)
const _TTL_CW  = 6.45;  // estimated char width for monospace 10.5px
const _TTL_BUF = 60;    // lines pre-rendered above + below the visible area

let _ttlLines  = []; // per-line highlighted HTML (pure JS, zero DOM nodes)
let _ttlColMax = 0;  // max line char count → used to set horizontal spacer width

function _buildTtlLines() {
  if (!_ttlRaw) { _ttlLines = []; _ttlColMax = 0; return; }
  const cb     = document.getElementById('sparql-ttl-style-cb');
  const styled = cb ? cb.checked : true;
  const raw    = _ttlRaw.split('\n');
  _ttlColMax   = raw.reduce((m, l) => Math.max(m, l.length), 0);
  _ttlLines    = styled ? raw.map(_highlightTtlLine) : raw.map(_ttlEsc);
}

function _renderTtlViewport(viewer) {
  const c = viewer._vContent;
  if (!c || !_ttlLines.length) return;
  const total = _ttlLines.length;
  const first = Math.max(0, Math.floor(viewer.scrollTop / _TTL_LH) - _TTL_BUF);
  const last  = Math.min(total - 1, Math.ceil((viewer.scrollTop + viewer.clientHeight) / _TTL_LH) + _TTL_BUF);
  c.style.top = (first * _TTL_LH) + 'px';
  // Each line in a span with data-line so ctrl+click can target it precisely
  c.innerHTML = _ttlLines.slice(first, last + 1)
    .map((html, i) => `<span class="ttl-line" data-line="${first + i}">${html}</span>`)
    .join('\n');
  viewer._vFirst = first;
  viewer._vLast  = last;
  // Re-apply jump highlight if the active line is in the current window
  if (_ttlActiveLine >= first && _ttlActiveLine <= last && _ttlActiveTok) {
    const el = c.querySelector(`.ttl-line[data-line="${_ttlActiveLine}"] .ttl-tok[data-tok="${_ttlActiveTok}"]`);
    if (el) { el.classList.add('ttl-jump-active'); _ttlActiveEl = el; }
  }
}

function _mountTtlVScroll(viewer) {
  if (viewer._vScrollH)  viewer.removeEventListener('scroll', viewer._vScrollH);
  if (viewer._ttlClickH) viewer.removeEventListener('click',  viewer._ttlClickH);
  viewer._ttlKD && document.removeEventListener('keydown', viewer._ttlKD);
  viewer._ttlKU && document.removeEventListener('keyup',   viewer._ttlKU);

  const totalH = Math.ceil(_ttlLines.length * _TTL_LH);
  const totalW = Math.ceil(_ttlColMax * _TTL_CW) + 32;
  viewer.innerHTML  = '';
  viewer.scrollTop  = 0;
  viewer.scrollLeft = 0;

  // Transparent full-size spacer — gives scrollbars their correct range
  const spacer = document.createElement('div');
  spacer.style.cssText = `position:absolute;top:0;left:0;height:${totalH}px;width:${totalW}px;pointer-events:none;`;
  viewer.appendChild(spacer);

  // Content div — repositioned on every scroll tick, only holds visible lines
  const content = document.createElement('code');
  content.className = 'ttl-vscroll-content';
  viewer.appendChild(content);
  viewer._vContent = content;

  const onScroll = () => _renderTtlViewport(viewer);
  viewer._vScrollH = onScroll;
  viewer.addEventListener('scroll', onScroll, { passive: true });

  _renderTtlViewport(viewer);
}

async function _applyTtlDisplay(viewer, statusTextEl) {
  if (!viewer || !_ttlRaw) return;
  if (_ttlActiveEl) { _ttlActiveEl.classList.remove('ttl-jump-active'); _ttlActiveEl = null; }
  _ttlActiveLine = -1; _ttlActiveTok = ''; _ttlJumpIdx = {};
  const gen = ++_ttlRenderGen;
  if (statusTextEl) statusTextEl.textContent = 'Rendering\u2026';

  // Yield one frame so "Rendering…" paints before CPU work
  await new Promise(r => requestAnimationFrame(r));
  if (_ttlRenderGen !== gen) return;

  _buildTtlLines();         // pure JS string work — zero DOM touches
  _mountTtlVScroll(viewer); // install virtual scroller, paint visible window

  if (statusTextEl) {
    const cb   = document.getElementById('sparql-ttl-style-cb');
    const hint = cb?.checked ? '  \u00b7  Ctrl+click token to jump to next' : '';
    statusTextEl.textContent = _ttlLines.length + ' lines' + hint;
  }
  if (document.getElementById('sparql-ttl-style-cb')?.checked) {
    _initTtlCtrlClick(viewer, statusTextEl);
  }
}

function toggleTtlStyle() {
  const viewer       = document.getElementById('sparql-ttl-viewer');
  const statusTextEl = document.getElementById('sparql-ttl-status-text');
  const statusEl     = document.getElementById('sparql-ttl-status');
  _applyTtlDisplay(viewer, statusTextEl || statusEl);
}

/* TTL edit mode disabled — TTL is read-only, generated live from annotations
// ── TTL editor: edit mode, search/replace, save ────────────────────────────

function toggleTtlEdit() {
  _ttlEditMode = !_ttlEditMode;
  _syncTtlEditMode();
}

function _syncTtlEditMode() {
  const viewer      = document.getElementById('sparql-ttl-viewer');
  const editor      = document.getElementById('sparql-ttl-editor');
  const editBtn     = document.getElementById('ttl-edit-btn');
  const savBtn      = document.getElementById('ttl-save-btn');
  const regenBtn    = document.getElementById('ttl-regen-btn');
  const styleToggle = document.getElementById('sparql-ttl-style-toggle');
  const findBar     = document.getElementById('ttl-find-bar');
  const statusTextEl = document.getElementById('sparql-ttl-status-text');

  const editorWrap = document.getElementById('ttl-editor-wrap');

  if (_ttlEditMode) {
    // Switch to edit mode: hide highlighted <pre>, show editor wrapper
    if (viewer) viewer.style.display = 'none';
    if (editorWrap) editorWrap.style.display = 'block';
    if (editor) editor.value = _ttlRaw;
    _updateHighlightBackdrop('');
    if (editBtn)  { editBtn.textContent = '✓ View'; editBtn.classList.add('active'); }
    if (savBtn)   savBtn.style.display  = '';
    if (regenBtn) regenBtn.style.display = '';
    if (styleToggle) styleToggle.style.display = 'none';
    if (findBar)     findBar.style.display      = 'flex';
    const lines = (_ttlRaw.match(/\n/g) || []).length + 1;
    if (statusTextEl) statusTextEl.textContent = lines + ' lines  ·  edit mode — use Search & Replace below';
  } else {
    // Switch back to view mode: sync raw text from textarea then re-highlight
    if (editor) _ttlRaw = editor.value;
    if (editorWrap) editorWrap.style.display = 'none';
    _updateHighlightBackdrop('');
    if (viewer) viewer.style.removeProperty('display');
    if (editBtn)  { editBtn.textContent = '✎ Edit'; editBtn.classList.remove('active'); }
    if (savBtn)   savBtn.style.display  = 'none';
    if (regenBtn) regenBtn.style.display = 'none';
    if (styleToggle) styleToggle.style.display = '';
    if (findBar)     findBar.style.display      = 'none';
    _applyTtlDisplay(viewer, statusTextEl || document.getElementById('sparql-ttl-status'));
  }
}

async function saveTtlContent() {
  const editor = document.getElementById('sparql-ttl-editor');
  if (!editor) return;
  const { projectIds, envId } = _sparqlGetContext();
  const pid = (!envId && projectIds.length === 1) ? projectIds[0] : (S.cur?.id || null);
  if (!pid) { notify('No single project selected — cannot save TTL'); return; }
  _ttlRaw = editor.value;
  const statusTextEl = document.getElementById('sparql-ttl-status-text');
  try {
    const resp = await fetch(`/api/project/${pid}/ttl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: _ttlRaw }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      // Syntax or parse error — show in status bar and notify, do not apply
      const msg = data.error || ('HTTP ' + resp.status);
      if (statusTextEl) statusTextEl.textContent = '⚠ ' + msg;
      notify('TTL error: ' + msg);
      return;
    }
    // Success — reload project so annotations and property panel reflect the changes
    notify('TTL saved' + (data.spaces_updated ? ` · ${data.spaces_updated} space(s) updated` : ''));
    S.dirty = false; // prevent saveSpaces from overwriting the just-imported data
    await openProject(pid);
    // Reload TTL content in viewer/editor to reflect any normalisation by rdflib
    await loadTtlContent();
    const lines = (_ttlRaw.match(/\n/g) || []).length + 1;
    if (statusTextEl) statusTextEl.textContent = lines + ' lines  ·  saved  ·  edit mode';
  } catch (err) {
    notify('Save failed: ' + err.message);
  }
}

async function regenerateTtl() {
  const { projectIds, envId } = _sparqlGetContext();
  const pid = (!envId && projectIds.length === 1) ? projectIds[0] : (S.cur?.id || null);
  if (!pid) { notify('No single project selected'); return; }
  try {
    const resp = await fetch(`/api/project/${pid}/ttl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    notify('TTL override cleared — regenerating…');
    // Exit edit mode so regenerated content is shown as highlighted view
    if (_ttlEditMode) { _ttlEditMode = false; _syncTtlEditMode(); }
    await loadTtlContent();
  } catch (err) {
    notify('Regenerate failed: ' + err.message);
  }
}

function ttlFindHighlight() {
  const editor     = document.getElementById('sparql-ttl-editor');
  const findInput  = document.getElementById('ttl-find-input');
  const findStatus = document.getElementById('ttl-find-status');
  if (!editor || !findInput) return;
  const needle = findInput.value;
  if (!needle) { if (findStatus) findStatus.textContent = ''; _updateHighlightBackdrop(''); return; }
  const count = editor.value.split(needle).length - 1;
  if (findStatus) findStatus.textContent = count > 0 ? `${count} found` : 'No matches';
  _updateHighlightBackdrop(needle);
}

function _updateHighlightBackdrop(needle) {
  const content = document.getElementById('ttl-highlight-content');
  const editor  = document.getElementById('sparql-ttl-editor');
  if (!content || !editor) return;
  const text = editor.value;
  if (!needle) {
    content.textContent = text; // plain — keeps correct sizing for scroll sync
  } else {
    const mark = '<mark>' + _ttlEsc(needle) + '</mark>';
    content.innerHTML = text.split(needle).map(p => _ttlEsc(p)).join(mark);
  }
  // Sync translate so backdrop stays aligned with textarea scroll
  content.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
}

// end of disabled TTL edit mode block */

function _ttlEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Per-line highlighter — extracted so chunked rendering can call it per line
const _TTL_LINE_RE = /"(?:\\.|[^"\\])*"(?:\^\^[^\s,;.([\]<>"^@#]*)?|(@\w+)|(\ba\b)|(<[^>]*>)|([a-zA-Z][\w-]*)?:([\.\w\u00C0-\uFFFF][\-\.\w\u00C0-\uFFFF]*)?|[;.,\[\]()]|[-+]?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?/g;
function _highlightTtlLine(line) {
  const esc = _ttlEsc;
  if (/^\s*#/.test(line)) return `<span class="ttl-cmt">${esc(line)}</span>`;
  let out = '', last = 0, m;
  _TTL_LINE_RE.lastIndex = 0;
  while ((m = _TTL_LINE_RE.exec(line)) !== null) {
    out += esc(line.slice(last, m.index));
    const tok = m[0]; last = m.index + tok.length;
    if (tok.startsWith('"')) {
      out += `<span class="ttl-str">${esc(tok)}</span>`;
    } else if (m[1]) { // @keyword
      out += `<span class="ttl-kw">${esc(tok)}</span>`;
    } else if (m[2]) { // standalone 'a'
      out += `<span class="ttl-kw">a</span>`;
    } else if (m[3]) { // <IRI>
      out += `<span class="ttl-uri">${esc(tok)}</span>`;
    } else if (tok.includes(':')) {
      const ci = tok.indexOf(':');
      const pfx = tok.slice(0, ci + 1);
      const loc = tok.slice(ci + 1);
      out += `<span class="ttl-tok" data-tok="${esc(tok)}">` +
             `<span class="ttl-pfx">${esc(pfx)}</span>` +
             (loc ? `<span class="ttl-loc">${esc(loc)}</span>` : '') +
             `</span>`;
    } else if (';.,[]()'.includes(tok)) {
      out += `<span class="ttl-punc">${esc(tok)}</span>`;
    } else {
      out += `<span class="ttl-num">${esc(tok)}</span>`;
    }
  }
  out += esc(line.slice(last));
  return out;
}
function _highlightTtl(raw) { return raw.split('\n').map(_highlightTtlLine).join('\n'); }

let _ttlJumpIdx   = {};
let _ttlActiveEl  = null;
let _ttlActiveLine = -1;   // line index of the jump-highlighted token
let _ttlActiveTok  = '';   // HTML-escaped data-tok value of the highlighted token
function _initTtlCtrlClick(viewer, statusTextEl) {
  const _onKeyDown = e => { if (e.key === 'Control' || e.key === 'Meta') viewer.classList.add('ttl-ctrl-held'); };
  const _onKeyUp   = e => { if (e.key === 'Control' || e.key === 'Meta') viewer.classList.remove('ttl-ctrl-held'); };
  viewer._ttlKD && document.removeEventListener('keydown', viewer._ttlKD);
  viewer._ttlKU && document.removeEventListener('keyup',   viewer._ttlKU);
  viewer._ttlKD = _onKeyDown; viewer._ttlKU = _onKeyUp;
  document.addEventListener('keydown', _onKeyDown);
  document.addEventListener('keyup',   _onKeyUp);

  const handler = (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    const tok = ev.target.closest('.ttl-tok');
    if (!tok) return;
    ev.preventDefault();
    const key  = tok.dataset.tok;
    const esc  = _ttlEsc(key);
    const attr = `data-tok="${esc}"`;

    // Search the in-memory line array — no full-DOM scan needed
    const matchLines = [];
    for (let i = 0; i < _ttlLines.length; i++) {
      if (_ttlLines[i].includes(attr)) matchLines.push(i);
    }
    if (matchLines.length === 0) return;
    if (matchLines.length === 1) {
      if (statusTextEl) statusTextEl.textContent = `"${key}" — 1 occurrence`;
      return;
    }

    const curIdx  = _ttlJumpIdx[key] ?? -1;
    const nextIdx = (curIdx + 1) % matchLines.length;
    _ttlJumpIdx[key] = nextIdx;
    const targetLine = matchLines[nextIdx];

    // Scroll so the target line is centred in the viewport
    viewer.scrollTop = Math.max(0, targetLine * _TTL_LH - viewer.clientHeight / 2);
    _renderTtlViewport(viewer); // synchronous: target line is now in the DOM

    // Track by value so _renderTtlViewport can restore the class after any future scroll
    _ttlActiveLine = targetLine;
    _ttlActiveTok  = esc;
    if (_ttlActiveEl) { _ttlActiveEl.classList.remove('ttl-jump-active'); _ttlActiveEl = null; }
    // data-line attribute lets us find exactly the right line without ambiguity
    _ttlActiveEl =
      viewer._vContent.querySelector(`.ttl-line[data-line="${targetLine}"] .ttl-tok[data-tok="${esc}"]`) ??
      viewer._vContent.querySelector(`.ttl-tok[data-tok="${esc}"]`);
    if (_ttlActiveEl) _ttlActiveEl.classList.add('ttl-jump-active');
    if (statusTextEl) statusTextEl.textContent = `"${key}" — ${nextIdx + 1} / ${matchLines.length}`;
  };
  viewer._ttlClickH = handler;
  viewer.addEventListener('click', handler);
}

// ── Determine project context for SPARQL ──
function _sparqlGetContext() {
  const projectIds = [];
  let   envId      = null;

  // Multi-select (Ctrl+click of extra files) always overrides non-'all' modes
  const multiSel = [...(selectedFileIds || [])].filter(id => id !== S.cur?.id);
  if (multiSel.length > 0 && SQ.contextMode !== 'all') {
    if (S.cur) projectIds.push(S.cur.id);
    multiSel.forEach(id => projectIds.push(id));
    return { projectIds, envId };
  }

  if (SQ.contextMode === 'all') {
    // All mode: let the server enumerate all project IDs from its own database;
    // client-side S.projects may be stale (e.g. files added in another session).
    // We signal this with all_projects: true instead of passing IDs.
    return { projectIds: [], envId: null, allProjects: true };
  } else if (SQ.contextMode === 'environment') {
    // Env mode: highlighted folder, or fall back to the open file's own env
    if (selectedEnvId && ENVS[selectedEnvId]) {
      envId = selectedEnvId;
    } else if (S.cur?.env_id) {
      envId = S.cur.env_id;
    } else if (S.cur) {
      projectIds.push(S.cur.id); // standalone file, no env
    }
  } else {
    // File mode: only the currently open file
    if (S.cur) projectIds.push(S.cur.id);
  }

  return { projectIds, envId };
}

// ── Run SPARQL query ──
async function runSparqlQuery() {
  const statusEl = document.getElementById('sparql-status');
  const runBtn   = document.getElementById('sparql-run-btn');
  try {
    const query = (document.getElementById('sparql-editor').value || '').trim();
    if (!query) {
      statusEl.textContent = 'Enter a SPARQL query first.';
      return;
    }
    // Save current spaces first so the backend sees up-to-date data.
    if (S.cur && S.dirty) await saveSpaces(S.cur.id);

    const { projectIds, envId, allProjects } = _sparqlGetContext();
    if (!allProjects && !envId && projectIds.length === 0) {
      statusEl.textContent = SQ.contextMode === 'all'
        ? 'No files loaded yet.'
        : 'Open a file or select a folder first.';
      return;
    }

    runBtn.disabled = true;
    statusEl.textContent = 'Running…';
    document.getElementById('sparql-results-table').innerHTML = '';

    const resp = await fetch('/api/sparql/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, project_ids: projectIds, env_id: envId, all_projects: allProjects || false }),
    });
    const data = await resp.json();
    if (data.error) {
      statusEl.textContent = 'Error: ' + data.error;
    } else {
      _renderSparqlResults(data.vars, data.rows);
    }
  } catch (err) {
    statusEl.textContent = 'Request failed: ' + err;
  } finally {
    runBtn.disabled = false;
  }
}

function sparqlExportCSV() {
  const last = _renderSparqlResults._last;
  if (!last || !last.rows || last.rows.length === 0) {
    notify('No results to export', 2000); return;
  }
  const { vars, rows } = last;
  const esc = v => {
    const s = (v == null ? '' : String(v));
    return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [
    vars.map(esc).join(','),
    ...rows.map(row => vars.map((_, i) => esc(row[i] ?? '')).join(','))
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'sparql_results.csv'; a.click();
  URL.revokeObjectURL(url);
}

function _renderSparqlResults(vars, rows) {
  // Persist last result set so the Hide-URI toggle can re-render without a new query
  _renderSparqlResults._last = { vars, rows };

  const status  = document.getElementById('sparql-status');
  const tbl     = document.getElementById('sparql-results-table');
  tbl.innerHTML = '';

  if (!rows || rows.length === 0) {
    status.textContent = 'Query returned 0 rows.';
    return;
  }
  status.textContent = rows.length + ' row' + (rows.length !== 1 ? 's' : '');

  // ── URI-prefix stripping ──────────────────────────────────────────────────
  const hideUri = !!(document.getElementById('sparql-hide-uri-cb') || {}).checked;
  const _isUri  = v => typeof v === 'string' && /^https?:\/\//.test(v);
  const _strip  = v => _isUri(v) ? v.replace(/.*[#\/]/, '') : v;

  // Determine which columns contain at least one URI (used for alignment + stripping)
  const isUriCol = vars.map((_, ci) => rows.some(row => _isUri(row[ci] || '')));

  // ── Column-width measurement ──────────────────────────────────────────────
  const _ctx = (_renderSparqlResults._ctx ||= (() => {
    const c = document.createElement('canvas').getContext('2d');
    c.font = '600 10.5px monospace'; return c;
  })());
  // Canvas measureText uses the generic monospace fallback which is narrower than
  // IBM Plex Mono rendered in the table. Scale factor compensates for ~3-char shortfall.
  const FONT_SCALE = 1.13;
  const PAD_CELL = 32; // comfortable breathing room around longest cell content
  const PAD_HDR  = 40; // header text + resize handle; also word-level minimum
  const colWidths = vars.map((v, ci) => {
    // Header sets the minimum: measure full header AND each individual word
    _ctx.font = '600 10.5px monospace';
    let maxW = Math.ceil(_ctx.measureText(v).width * FONT_SCALE) + PAD_HDR;
    v.split(/\s+/).forEach(word => {
      const ww = Math.ceil(_ctx.measureText(word).width * FONT_SCALE) + PAD_HDR;
      if (ww > maxW) maxW = ww;
    });
    _ctx.font = '10.5px monospace';
    rows.forEach(row => {
      let raw = row[ci] || '';
      let txt = (hideUri && isUriCol[ci]) ? _strip(raw) : raw;
      try { txt = decodeURIComponent(txt); } catch(e) {}
      const w = Math.ceil(_ctx.measureText(txt).width * FONT_SCALE) + PAD_CELL;
      if (w > maxW) maxW = w;
    });
    return maxW;
  });

  // Inject colgroup so table-layout:fixed honours exact widths
  const cg = document.createElement('colgroup');
  colWidths.forEach(w => {
    const col = document.createElement('col');
    col.style.width = w + 'px';
    cg.appendChild(col);
  });
  tbl.appendChild(cg);
  // Set table width to the sum so it doesn't stretch beyond content
  tbl.style.width = colWidths.reduce((s, w) => s + w, 0) + 'px';

  // ── Header ───────────────────────────────────────────────────────────────
  const thead = tbl.createTHead();
  const hrow  = thead.insertRow();
  vars.forEach((v, ci) => {
    const th = document.createElement('th');
    th.textContent = v;
    if (hideUri && isUriCol[ci]) th.style.textAlign = 'right';
    hrow.appendChild(th);
  });

  // ── Body ─────────────────────────────────────────────────────────────────
  const tbody = tbl.createTBody();
  rows.forEach(row => {
    const tr = tbody.insertRow();
    row.forEach((cell, ci) => {
      const td = tr.insertCell();
      const stripped = (hideUri && isUriCol[ci]) ? _strip(cell) : cell;
      // Decode percent-encoded chars (e.g. %C3%A4 → ä) for display
      let display = stripped;
      try { display = decodeURIComponent(stripped); } catch(e) { /* keep raw */ }
      td.textContent = display;
      td.title = cell;   // always show raw full URI on hover
      if (hideUri && isUriCol[ci]) td.style.textAlign = 'right';
      // Navigate: click cell jumps viewer to the matching space (when toggle on)
      td.addEventListener('click', async () => {
        const cb = document.getElementById('sparql-nav-cb');
        if (!cb || !cb.checked) return;
        // Extract local name after last # or / (use raw cell, not stripped)
        const localName = cell.replace(/.*[#\/]/, '');
        if (!localName) return;
        await _navigateToLocalName(localName);
      });
    });
  });

  // ── Sync pointer cursor with navigate toggle ──────────────────────────────
  const navCb = document.getElementById('sparql-nav-cb');
  const wrap  = document.getElementById('sparql-results-wrap');
  if (navCb && wrap) {
    const _syncCursor = () => wrap.classList.toggle('nav-on', navCb.checked);
    navCb.removeEventListener('change', navCb._navSync || null);
    navCb._navSync = _syncCursor;
    navCb.addEventListener('change', _syncCursor);
    _syncCursor();
  }

  // ── Re-render on Hide-URI toggle ─────────────────────────────────────────
  const hideUriCb = document.getElementById('sparql-hide-uri-cb');
  if (hideUriCb) {
    hideUriCb.removeEventListener('change', hideUriCb._rerender || null);
    hideUriCb._rerender = () => {
      const last = _renderSparqlResults._last;
      if (last) _renderSparqlResults(last.vars, last.rows);
    };
    hideUriCb.addEventListener('change', hideUriCb._rerender);
  }

  _addColResizers(tbl);
}

function _addColResizers(tbl) {
  const cols = Array.from(tbl.querySelectorAll('col'));
  tbl.querySelectorAll('th').forEach((th, ci) => {
    const col = cols[ci];
    const rsz = document.createElement('div');
    rsz.className = 'sparql-col-resizer';
    th.appendChild(rsz);
    let startX = 0, startW = 0;
    rsz.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      startX = e.clientX;
      startW = th.getBoundingClientRect().width;
      rsz.classList.add('active');
      e.preventDefault(); e.stopPropagation();
      const onMove = ev => {
        const w = Math.max(24, startW + (ev.clientX - startX));
        if (col) col.style.width = w + 'px';
        // also update table total width
        const allCols = Array.from(tbl.querySelectorAll('col'));
        tbl.style.width = allCols.reduce((s, c) => s + parseInt(c.style.width || 0), 0) + 'px';
      };
      const onUp = () => {
        rsz.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function updateAIContextBadge() {
  const badge = document.getElementById('ai-context-badge');
  if (!badge) return;
  if (AI.contextMode === 'all') {
    const count = (S.projects || []).length;
    badge.textContent = `All Files (${count})`;
    badge.title = 'All files across all folders';
    return;
  }
  if (AI.contextMode === 'environment') {
    if (selectedEnvId && ENVS[selectedEnvId]) {
      const label = '&#128193; ' + ENVS[selectedEnvId].name;
      badge.innerHTML = label;
      badge.title = 'Environment: ' + ENVS[selectedEnvId].name;
    } else {
      badge.textContent = 'no env selected';
      badge.title = 'Select a folder in the left panel';
    }
    return;
  }
  if (!S.cur) { badge.textContent = 'no project'; return; }
  let label = S.cur.original_name;
  if (AI.focusSpaceId && S.spaces[AI.focusSpaceId]) {
    label = '▶ ' + S.spaces[AI.focusSpaceId].name;
  }
  badge.textContent = label;
  badge.title = label;
}

const _AI_PRESETS = {
  spaces_relations:
    'List all spaces and return their spatial relation relative to their parent ' +
    '(containedInVerticalCenter / containedInLeft / etc.). ' +
    'Add normalized coordinates of boundaries as well.',
  spaces_comments:
    'List all spaces and return their full comments ' +
    '(return comments up to 100 words per comment).',
  list_filenames:
    'List all file names and number of spaces per SpaceType inside each.',
  list_docspaces:
    'List all DocumentSpaces and return their parents, as well as their comments.',
  list_linespaces:
    'List all LineSpaces and return their parents, as well as their comments.',
  list_pointspaces:
    'List all PointSpaces and return their parents, as well as their comments.',
  spatial_reasoning:
    'The following spaces should be analyzed for implicitly given spatial relations, ' +
    'such as directional relation (A is left of B / A is on top of B / etc.) ' +
    'as well as topological relations (A is part of B / A meets B / A intersects B / etc.):\n',
};

function aiPresetChange(key) {
  if (!key) return;
  const text = _AI_PRESETS[key];
  if (!text) return;
  const inp = document.getElementById('ai-input');
  if (inp) {
    inp.value = text;
    inp.focus();
    // Place cursor at end so user can append to spatial_reasoning prompt
    inp.selectionStart = inp.selectionEnd = text.length;
  }
  // Reset dropdown so it can be selected again
  const sel = document.getElementById('ai-preset-select');
  if (sel) sel.value = '';
}

function clearChat() {
  AI.messages = [];
  const box = document.getElementById('ai-messages');
  box.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'ai-msg sys';
  div.textContent = 'Conversation cleared. Token limit reset.';
  box.appendChild(div);
}

function aiAppendMessage(role, content) {
  AI.messages.push({ role, content });
  const box = document.getElementById('ai-messages');
  const div = document.createElement('div');
  div.className = 'ai-msg ' + role;
  if (role === 'assistant' && typeof marked !== 'undefined') {
    div.innerHTML = marked.parse(content);
  } else {
    div.textContent = content;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function aiAppendSys(content) {
  const box = document.getElementById('ai-messages');
  const div = document.createElement('div');
  div.className = 'ai-msg sys';
  div.textContent = content;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function aiAppendError(content) {
  const box = document.getElementById('ai-messages');
  const div = document.createElement('div');
  div.className = 'ai-msg error';
  div.textContent = '⚠ ' + content;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// Called when user clicks a space in Talk mode — focuses chat on that space
function aiTalkAboutSpace(spaceId) {
  AI.focusSpaceId = spaceId;
  openAIPanel();
  updateAIContextBadge();
  const sp = S.spaces[spaceId];
  if (!sp) return;
  aiAppendSys(`Focused on: "${sp.name}" (${sp.type})`);
}

// ── Chat input history (ArrowUp/Down cycling, like VS Code / terminal) ──
const _inputHistory = [];   // most-recent first
let   _inputHistoryIdx = -1; // -1 = not browsing history

async function sendChat() {
  if (AI.sending) return;
  if (!S.cur) { notify('Open a project first'); return; }
  const inp = document.getElementById('ai-input');
  const text = inp.value.trim();
  if (!text) return;

  inp.value = '';
  _inputHistory.unshift(text);          // save to history (newest first)
  if (_inputHistory.length > 100) _inputHistory.pop(); // cap at 100 entries
  _inputHistoryIdx = -1;                // reset cursor
  aiAppendMessage('user', text);

  const btn = document.getElementById('ai-send-btn');
  AI.sending = true;
  btn.disabled = true;
  btn.textContent = '⋯';

  // Save first so the backend sees fresh data
  await saveSpaces(S.cur.id);

  const apiKey = (localStorage.getItem('openrouter_api_key') || '').trim();

  // In env mode: use highlighted folder; fall back to the open file's own env_id
  const _aiEnvId = AI.contextMode === 'environment'
    ? (selectedEnvId || S.cur?.env_id || null)
    : null;

  try {
    const resp = await fetch(`/api/project/${S.cur.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: AI.messages,
        focus_space_id: AI.focusSpaceId || null,
        api_key: apiKey || undefined,
        context_mode:          AI.contextMode || 'file',
        chat_mode:             AI.chatMode    || 'local',
        gguf_model:            AI.ggufModel   || '',  // Always send string (not undefined) so backend receives the field
        env_id:                _aiEnvId,
        selected_project_ids:  selectedFileIds.size > 1 ? [...selectedFileIds].filter(id => id !== S.cur?.id) : [],
        resource_ids:          RESOURCES.map(r => r.id),
        max_tokens: parseInt(document.getElementById('ai-max-tokens')?.value || '800', 10),
      }),
    });
    const data = await resp.json();
    if (data.error) {
      aiAppendError(data.error);
    } else {
      aiAppendMessage('assistant', data.reply);
      if (data.model && data.model !== 'openai/gpt-4o-mini') {
        // Show which model answered — especially useful for WebOfData (Sonar)
        aiAppendSys(`Answered by ${data.model}`);
      }
    }
  } catch(err) {
    aiAppendError('Network error: ' + err.message);
  } finally {
    AI.sending = false;
    btn.disabled = false;
    btn.textContent = '▶';
  }
}

// Expose functions used by inline handlers and generated markup when loaded as a module
Object.assign(window, {
  onEnvDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDropOnEnv,
  onFileDragStart,
  onFileClick,
  removeFile,
  selectEnvironment,
  promptRenameEnv,
  createEnvironment,
  deleteEnvironment,
  toggleEnvCollapse,
  moveProjectToEnv,
  moveEnvToParent,
  spaceMD,
  ptMD,
  vecHandleMD,
  vecBodyMD,
  setOriginInteractive,
  setOriginFromClick,
  clearChat,
}
);

// ════════════════════════════════════════════════════════════════
// DEDUP / ONTOLOGY PANEL
// ════════════════════════════════════════════════════════════════

const DP = {
  open:          false,
  selIds:        new Set(),           // selected space ids in space list
  ontologies:    [],                  // {name, classes:[], predicates:[]}
  graphSpaceId:  null,                // space id currently shown in graph (null in entity mode)
  entityName:    null,                // entity name when in entity-graph mode (null = regular space mode)
  entityAppearanceSids: [],           // sids of all appearances for DP.entityName
  graphTransform:{ x:0, y:0, scale:1 },
  graphNodes:    [],                  // [{id,x,y,type,label,kind}]  kind: space|class
  graphEdges:    [],                  // [{from,to,label}]
  activeNodeId:  null,                // node clicked for predicate popup
};

// Cache of full project objects (with spaces) for dedup "All Files" / "Environment" modes.
// Populated lazily on context switch and kept fresh by openProject + saveSpaces.
const _dedupFullCache = new Map(); // pid → full project data

// ── Open / Close ──────────────────────────────────────────────
function openDedupPanel() {
  DP.open = true;
  const _dedupPanel = document.getElementById('dedup-panel');
  const _dedupViewerH = document.getElementById('viewer-area')?.offsetHeight || 400;
  _dedupPanel.style.height = _dedupViewerH + 'px';
  _dedupPanel.classList.add('open');
  document.getElementById('btn-dedup').classList.add('active');
  _setupDedupResizers();
  _setupDedupOntologyInput();
  _setupDedupContextChange();
  // Defer so browser can compute flex layout after display:flex is applied.
  // If context is env/all, seed the cache first so spaces are visible immediately.
  setTimeout(async () => {
    const ctx = document.getElementById('dedup-context-select')?.value || 'file';
    if (ctx === 'all' || ctx === 'environment') {
      const envFilter = ctx === 'environment' ? selectedEnvId : null;
      const pids = (S.projects || []).filter(p => !envFilter || p.env_id === envFilter).map(p => p.id);
      await _dedupLoadProjects(pids);
    }
    renderDedupSpaceList();
  }, 0);
}

function closeDedupPanel() {
  DP.open = false;
  document.getElementById('dedup-panel').classList.remove('open');
  const btn = document.getElementById('btn-dedup');
  if (btn) btn.classList.remove('active');
}

// ── Collect all spaces for current context ────────────────────
function _dedupGetSpaces() {
  const ctx = document.getElementById('dedup-context-select')?.value || 'file';
  const spaces = [];

  if (ctx === 'file') {
    // Only current open file
    if (!S.cur) return spaces;
    for (const [sid, sp] of Object.entries(S.spaces)) {
      spaces.push({ sid, sp, fileName: S.cur.meta?.display_name || S.cur.original_name });
    }
  } else {
    // 'environment': filter to selected folder; 'all': no filter
    const envFilter = ctx === 'environment' ? selectedEnvId : null;
    for (const proj of (S.projects || [])) {
      if (envFilter && proj.env_id !== envFilter) continue;
      // Use full cached project data (has spaces); fall back to lean obj (spaces={}).
      // The currently open file always uses S.spaces (freshest version, even before autosave).
      const pSpaces = proj.id === S.cur?.id
        ? S.spaces
        : (_dedupFullCache.get(proj.id)?.spaces || {});
      const fName = proj.name || proj.id;  // lean project object uses 'name'
      for (const [sid, sp] of Object.entries(pSpaces)) {
        spaces.push({ sid, sp, fileName: fName, projId: proj.id });
      }
    }
  }
  return spaces;
}

// ── BP axes helper: derives plane label from asset_axes ─────
function _getBPAxes(sp) {
  const axes = sp.asset_axes;
  if (!axes || axes.length < 2) return '';
  const bases = axes.slice(0, 2).map(a => a.replace(/^inv_/, '')[0].toUpperCase());
  bases.sort();
  return bases.join('');
}
// Walk ancestor chain (using byId map) and return nearest ancestor with asset_bp, or null
function _findBPAncestor(sp, byId) {
  let cur = sp.parent_id ? byId.get(sp.parent_id) : null;
  while (cur) {
    if (cur.sp.asset_bp) return cur.sp;
    cur = cur.sp.parent_id ? byId.get(cur.sp.parent_id) : null;
  }
  return null;
}

// ── Render space list ─────────────────────────────────────────
function renderDedupSpaceList() {
  const list = document.getElementById('dedup-space-list');
  if (!list) return;
  const filter = (document.getElementById('dedup-filter-input')?.value || '').toLowerCase();
  const allSpaces = _dedupGetSpaces();
  list.innerHTML = '';

  let rowCount = 0;
  const MAX = 300;

  // Build byId lookup early — needed for both sections
  const byId = new Map(allSpaces.map(e => [e.sid, e]));

  // ── SECTION 1: Deduplicated entity groups at top ───────────────
  // Group spaces that have an entity value by that entity name
  const entityMap = new Map(); // entity name → [entries]
  for (const entry of allSpaces) {
    const entity = (entry.sp.entity || '').trim();
    if (entity) {
      if (!entityMap.has(entity)) entityMap.set(entity, []);
      entityMap.get(entity).push(entry);
    }
  }

  const sortedEntities = [...entityMap.keys()].sort();
  for (const entity of sortedEntities) {
    if (rowCount >= MAX) break;
    const appearances = entityMap.get(entity);
    const stateStr = `Space (${appearances.length})`;
    // Deduplicated entity groups are always typed EntitySpace
    const entityType = 'EntitySpace';
    const entityMatchesFilter = !filter ||
      entity.toLowerCase().includes(filter) ||
      entityType.toLowerCase().includes(filter) ||
      stateStr.toLowerCase().includes(filter);
    if (!entityMatchesFilter) continue;
    // Validation: flag if any appearance is a DocumentSpace (DocSpaces shouldn't be appearances)
    const hasDocAppearance = appearances.some(e => (e.sp.type || 'DocumentSpace') === 'DocumentSpace');
    // Union of additional class types: entity-level classes (stored in meta) + any appearance-level classes
    const entitySafeKey = _jsSafe(entity);
    const entityLevelTypes = _getEntityClasses(entity).map(c => c.cls);
    const appearanceLevelTypes = appearances.flatMap(e => (e.sp.classes || []).map(c => c.cls));
    const entityAddedTypes = [...new Set([...entityLevelTypes, ...appearanceLevelTypes])];
    // ── Entity BP: collect unique planes from all appearances ──
    const bpPlanesSet = new Set();
    for (const { sp: asp } of appearances) {
      let plane = '';
      if (asp.asset_bp) {
        plane = _getBPAxes(asp);
      } else {
        const anc = _findBPAncestor(asp, byId);
        if (anc) plane = _getBPAxes(anc);
      }
      if (plane) bpPlanesSet.add(plane);
    }
    const entityBpText  = [...bpPlanesSet].sort().join(', ');
    const entityBpColor = entityBpText ? '#e8c96a' : 'var(--text3)';
    const headerRow = _dedupMakeRow(
      entity, entityType, stateStr,
      appearances.map(e => e.sid), hasDocAppearance ? '' : 'appearance', 0, false, hasDocAppearance, false, entityAddedTypes, entity, entityBpText, entityBpColor
    );
    headerRow.style.background = 'rgba(106,204,136,0.07)';
    list.appendChild(headerRow);
    rowCount++;
  }

  // Separator if both sections have content
  if (sortedEntities.length > 0 && allSpaces.length > 0) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid var(--border);margin:3px 0 2px;flex-shrink:0;';
    list.appendChild(sep);
  }

  // ── SECTION 2: Full space hierarchy ───────────────────────────
  // (byId is already built above)

  // Detect duplicate names (same display name, no entity) for "Non-Deduplicated Entity" warning
  const nameCount = new Map();
  for (const { sp } of allSpaces) {
    if (!(sp.entity || '').trim()) {
      const n = (sp.name || '').trim().toLowerCase();
      if (n) nameCount.set(n, (nameCount.get(n) || 0) + 1);
    }
  }

  const roots = allSpaces.filter(({ sp }) => !sp.parent_id || !byId.has(sp.parent_id));
  roots.sort((a, b) => (a.sp.name || a.sid).localeCompare(b.sp.name || b.sid));

  // Pre-compute yellow type warning: DocumentSpaces that share a hierarchy level with a non-DocumentSpace
  const yellowTypeWarning = new Set();
  const byParent = new Map();
  for (const { sid, sp } of allSpaces) {
    const pid = sp.parent_id || '__root__';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push({ sid, sp });
  }
  for (const siblings of byParent.values()) {
    const hasNonDoc = siblings.some(({ sp }) => (sp.type || 'DocumentSpace') !== 'DocumentSpace');
    if (hasNonDoc) {
      for (const { sid, sp } of siblings) {
        if ((sp.type || 'DocumentSpace') === 'DocumentSpace' && !(sp.entity || '').trim()) {
          yellowTypeWarning.add(sid);
        }
      }
    }
  }

  function addRow({ sid, sp }, indent) {
    if (rowCount >= MAX) return;
    const label      = sp.name || sid;
    const typeStr    = sp.type || 'DocumentSpace';
    const hasEntity  = !!(sp.entity || '').trim();
    const state      = hasEntity ? 'Appearance' : 'Space';

    // Validation rules — color state cell red when:
    // 1. DocumentSpace + Appearance (DocSpaces shouldn't be appearances)
    const stateErr = typeStr === 'DocumentSpace' && hasEntity;
    // 2. Non-deduplicated duplicate: same name appears multiple times but no entity → should be linked
    const isDuplName = !hasEntity && (nameCount.get((sp.name || '').trim().toLowerCase()) || 0) > 1;
    const typeErr = isDuplName; // flag type cell red to indicate it needs deduplication
    // 3. DocumentSpace among non-DocumentSpace siblings and state is Space → yellow warning
    const typeWarn = !typeErr && yellowTypeWarning.has(sid);

    const matchesFilter = !filter ||
      label.toLowerCase().includes(filter) ||
      typeStr.toLowerCase().includes(filter) ||
      state.toLowerCase().includes(filter);

    if (matchesFilter) {
      const addedTypes = (sp.classes || []).map(c => c.cls);
      // ── BP column ──
      let bpText = '', bpColor = '';
      if (sp.asset_bp) {
        bpText  = _getBPAxes(sp);
        bpColor = '#6acc8a'; // green — own direct BP mapping
      } else {
        const ancBP = _findBPAncestor(sp, byId);
        if (ancBP) {
          bpText  = _getBPAxes(ancBP); // show inherited axes in yellow
          bpColor = '#e8c96a';
        } else {
          bpText  = 'none'; // no ancestor BP (red)
          bpColor = 'var(--err,#ff6b6b)';
        }
      }
      const row = _dedupMakeRow(
        label, typeStr, state, [sid],
        hasEntity ? 'appearance' : '', indent, typeErr, stateErr, typeWarn, addedTypes, null, bpText, bpColor
      );
      list.appendChild(row);
      rowCount++;
    }
    // Children sorted A-Z
    const children = allSpaces
      .filter(({ sp: c }) => c.parent_id === sid)
      .sort((a, b) => (a.sp.name || a.sid).localeCompare(b.sp.name || b.sid));
    children.forEach(child => addRow(child, indent + 1));
  }

  roots.forEach(r => addRow(r, 0));

  if (rowCount === 0) {
    list.innerHTML = '<div style="color:var(--text3);font-size:9px;font-family:var(--mono);padding:10px;text-align:center">No spaces found</div>';
  }
}

function _dedupUpdateSelEdit(sid) {
  const panel = document.getElementById('dedup-sel-edit');
  const nameInp = document.getElementById('dedup-sel-name');
  const typeEl  = document.getElementById('dedup-sel-type');
  if (!panel || !nameInp || !typeEl) return;

  const sp = S.spaces[sid];
  if (!sp || !sid) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  panel._sid = sid;
  nameInp.value = sp.name || '';
  typeEl.value  = sp.type || 'DocumentSpace';

  // Bind only once per render pass
  nameInp.oninput = () => {
    const s = S.spaces[panel._sid]; if (!s) return;
    s.name = nameInp.value;
    S.dirty = true; renderAnnotations(); renderSpacesPanel(); autoSave();
    renderDedupSpaceList();
  };
  typeEl.onchange = () => {
    const s = S.spaces[panel._sid]; if (!s) return;
    s.type = typeEl.value;
    S.dirty = true; renderAnnotations(); renderSpacesPanel(); autoSave();
    renderDedupSpaceList();
  };
}

function _dedupMakeRow(label, type, state, sids, stateClass, indent = 0, typeErr = false, stateErr = false, typeWarn = false, addedTypes = [], entityName = null, bpText = '', bpColor = '') {
  const row = document.createElement('div');
  row.className = 'dedup-row';
  row.dataset.sids = JSON.stringify(sids);
  if (sids.length === 1 && DP.selIds.has(sids[0])) row.classList.add('selected');
  if (sids.length > 1 && sids.every(id => DP.selIds.has(id))) row.classList.add('selected');

  const indentPx = indent * 12;
  const typeStyle = typeErr ? ' style="color:var(--err,#ff6b6b)"' : typeWarn ? ' style="color:#e8c96a"' : '';
  const stateStyle = stateErr ? ' style="color:var(--err,#ff6b6b)"' : '';
  const bpStyleAttr = bpColor ? ` style="color:${bpColor}"` : '';
  const addedTypesText = addedTypes.join(' · ');
  row.innerHTML = `
    <span class="dedup-row-label" title="${label}" style="padding-left:${indentPx}px">${label}</span>
    <span class="dedup-row-type"${typeStyle}>${type}</span>
    <span class="dedup-row-state ${stateClass}"${stateStyle}>${state}</span>
    <span class="dedup-row-bp"${bpStyleAttr}>${bpText}</span>
    <span class="dedup-row-addtype" title="${addedTypesText}">${addedTypesText}</span>`;

  row.addEventListener('click', (e) => {
    // Close any open node-action popup
    document.getElementById('dedup-pred-popup').style.display = 'none';
    if (e.ctrlKey || e.metaKey) {
      sids.forEach(id => DP.selIds.has(id) ? DP.selIds.delete(id) : DP.selIds.add(id));
    } else if (e.shiftKey && DP.selIds.size > 0) {
      sids.forEach(id => DP.selIds.add(id));
    } else {
      DP.selIds.clear();
      sids.forEach(id => DP.selIds.add(id));
    }
    // Highlight row states
    document.querySelectorAll('.dedup-row').forEach(r => r.classList.remove('selected','multi-sel'));
    row.classList.add(DP.selIds.size === 1 ? 'selected' : 'multi-sel');

    if (entityName) {
      // Entity group row: render entity as center node with all appearances linked via appearsIn
      DP.entityName = entityName;
      DP.entityAppearanceSids = [...sids];
      DP.graphSpaceId = null;
      DP.activeNodeId = 'entity:' + _jsSafe(entityName);
      _dedupUpdateSelEdit(null);
      renderEntityGraph(entityName, sids, true);
    } else {
      // Regular space row
      DP.entityName = null;
      DP.entityAppearanceSids = [];
      const primaryId = sids[0];
      if (primaryId) {
        DP.graphSpaceId = primaryId;
        DP.activeNodeId = primaryId;
        _dedupUpdateSelEdit(primaryId);
        renderDedupGraph(primaryId, true);
        if (S.spaces[primaryId]) {
          S.selId = primaryId;
          selectSpace(primaryId, false);
          renderSpacesPanel();
        }
      }
    }
  });

  return row;
}


// ── SVG Graph ─────────────────────────────────────────────────
const MAX_GRAPH_NODES = 50;

// Re-render the graph viewer after a file switch, using new-file's spaces.
// - Entity mode: look up appearances in new file, re-render or clear.
// - Space mode: re-render if space still exists, clear otherwise.
function _refreshDedupGraph() {
  const g    = document.getElementById('dedup-graph-g');
  const info = document.getElementById('dedup-graph-info');
  if (!g) return;

  if (DP.entityName) {
    // Find appearances of this entity in the newly-loaded file
    const newSids = Object.entries(S.spaces)
      .filter(([, sp]) => (sp.entity || '').trim() === DP.entityName)
      .map(([sid]) => sid);
    if (newSids.length) {
      DP.entityAppearanceSids = newSids;
      renderEntityGraph(DP.entityName, newSids, true);
    } else {
      // Entity has no appearances in this file — clear graph, keep entity mode label
      g.innerHTML = '';
      DP.entityAppearanceSids = [];
      if (info) info.textContent = `${DP.entityName}  ·  Entity  ·  0 appearances in this file`;
      renderDedupClassList();
    }
  } else if (DP.graphSpaceId) {
    if (S.spaces[DP.graphSpaceId]) {
      renderDedupGraph(DP.graphSpaceId, true);
    } else {
      g.innerHTML = '';
      DP.graphSpaceId = null;
      DP.activeNodeId = null;
      if (info) info.textContent = 'Select a space in the list';
      renderDedupClassList();
    }
  }
}

function renderDedupGraph(spaceId, fitView = false) {
  const svg  = document.getElementById('dedup-graph-svg');
  const g    = document.getElementById('dedup-graph-g');
  const info = document.getElementById('dedup-graph-info');
  const fitBtn = document.getElementById('dedup-graph-fit-btn');
  if (!svg || !g) return;

  const sp = S.spaces[spaceId];
  if (!sp) { g.innerHTML = ''; if (info) info.textContent = 'Space not found in current file'; return; }

  // Build node/edge list
  const nodes = [];
  const edges = [];
  const addedIds = new Set();

  const addNode = (id, label, kind, cls, extra = {}) => {
    if (addedIds.has(id) || nodes.length >= MAX_GRAPH_NODES) return false;
    addedIds.add(id);
    nodes.push({ id, label, kind, cls, ...extra });
    return true;
  };

  // Central node = selected space
  addNode(spaceId, sp.name || spaceId, 'center', sp.type);

  // If this space is an appearance of an entity, show the entity node with the correct predicate
  const _spEntityName = (sp.entity || '').trim();
  if (_spEntityName) {
    const _entNodeId = 'entity:' + _jsSafe(_spEntityName);
    addNode(_entNodeId, _spEntityName, 'entity', 'EntitySpace');
    // Edge: deduplication space --spot:appearsIn--> appearance space
    edges.push({ from: _entNodeId, to: spaceId, label: 'spot:appearsIn' });
  }

  // Helper: all containment/appearance connections go child→parent (spot:appearsIn)
  const _isAp = (containerType) => (containerType || 'DocumentSpace') === 'DocumentSpace';
  const _edgeAp   = (childId, parentId) => ({ from: childId,  to: parentId, label: 'spot:appearsIn' });
  const _edgeCont = (childId, parentId) => ({ from: childId,  to: parentId, label: 'spot:appearsIn' });

  // Parent chain (up to 3 levels) — each level gets a parentDepth for per-row layout
  let cur = sp, curId = spaceId; let depth = 0;
  while (cur.parent_id && depth < 3) {
    const parId = cur.parent_id;
    const par = S.spaces[parId];
    if (!par) break;
    depth++;
    if (addNode(parId, par.name || parId, 'parent', par.type, { parentDepth: depth })) {
      edges.push(_isAp(par.type) ? _edgeAp(curId, parId) : _edgeCont(curId, parId));
    }
    cur = par; curId = parId;
  }
  // Also show root ancestor if it lies beyond the depth-3 window
  if (cur.parent_id) {
    let rCur = cur, rCurId = curId;
    while (rCur.parent_id && S.spaces[rCur.parent_id]) {
      rCurId = rCur.parent_id;
      rCur = S.spaces[rCurId];
    }
    if (!addedIds.has(rCurId) && addNode(rCurId, rCur.name || rCurId, 'parent', rCur.type, { parentDepth: depth + 1 })) {
      edges.push(_isAp(rCur.type) ? _edgeAp(curId, rCurId) : _edgeCont(curId, rCurId));
    }
  }

  // Children (up to 20)
  let childCount = 0;
  for (const [sid, s] of Object.entries(S.spaces)) {
    if (s.parent_id === spaceId && childCount < 20) {
      if (addNode(sid, s.name || sid, 'child', s.type)) {
        edges.push(_isAp(sp.type) ? _edgeAp(sid, spaceId) : _edgeCont(sid, spaceId));
        childCount++;
      }
    }
  }

  DP.graphNodes = nodes;
  DP.graphEdges = edges;

  // Layout: parents stacked above by depth level, center + entity on same middle row, children below.
  // Each row uses cumulative-width spreading so labels never overlap.
  const cx = 0, cy = 0;
  const nodePositions = {};

  const parents   = nodes.filter(n => n.kind === 'parent');
  const children  = nodes.filter(n => n.kind === 'child');
  const entityNds = nodes.filter(n => n.kind === 'entity');
  const centerNd  = nodes.find(n => n.kind === 'center');

  const _nCharW = 6.5;
  const _nHW = (nd) => Math.max(nd.kind === 'center' ? 22 : 18, Math.ceil(nd.label.length * _nCharW / 2) + 4);
  const _nGap = 20;

  // Spread a list of nodes in a horizontal row centred on cx at the given y
  function _spreadRow(nds, rowY) {
    if (!nds.length) return;
    const hws = nds.map(_nHW);
    const total = hws.reduce((s, hw) => s + hw * 2 + _nGap, 0) - _nGap;
    let x = cx - total / 2;
    nds.forEach((n, i) => {
      nodePositions[n.id] = { x: x + hws[i], y: rowY };
      x += hws[i] * 2 + _nGap;
    });
  }

  // Vertical layout (top → bottom):
  //   Children (top) → Center → Direct parent (depth 1) → … → Root ancestor (bottom)
  //   Entity node(s) are placed horizontally to the left of the center node (same row).
  const ROW_H = 130;
  const maxParentDepth = Math.max(0, ...parents.map(n => n.parentDepth || 1));

  const rows = [];
  if (children.length)  rows.push(children);              // children above center
  if (centerNd)         rows.push([centerNd]);            // selected space in the middle
  for (let d = 1; d <= maxParentDepth; d++) {             // direct parent first, root last
    const levelNodes = parents.filter(n => (n.parentDepth || 1) === d);
    if (levelNodes.length) rows.push(levelNodes);
  }

  const totalRows = rows.length;
  rows.forEach((rowNds, i) => {
    const rowY = cy + (i - (totalRows - 1) / 2) * ROW_H;
    _spreadRow(rowNds, rowY);
  });

  // Place entity nodes to the left of center on the same Y row
  if (centerNd && entityNds.length) {
    const centerPos = nodePositions[centerNd.id] || { x: cx, y: cy };
    const centerHW = _nHW(centerNd);
    let entityX = centerPos.x - centerHW - _nGap;
    for (let i = entityNds.length - 1; i >= 0; i--) {
      const nd = entityNds[i];
      const hw = _nHW(nd);
      entityX -= hw;
      nodePositions[nd.id] = { x: entityX, y: centerPos.y };
      entityX -= hw + _nGap;
    }
  }
  // Render SVG
  const NS = 'http://www.w3.org/2000/svg';
  g.innerHTML = '';

  // Helper: point on node boundary so arrowhead is visible (not buried inside shape)
  function _boundaryPt(fromPos, toPos, node) {
    const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: toPos.x, y: toPos.y };
    const ux = dx / dist, uy = dy / dist;
    const margin = node.kind === 'center' ? 25 : 21;
    return { x: toPos.x - ux * margin, y: toPos.y - uy * margin };
  }
  function _srcPt(fromPos, toPos, node) {
    const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: fromPos.x, y: fromPos.y };
    const ux = dx / dist, uy = dy / dist;
    const margin = node.kind === 'center' ? 25 : 21;
    return { x: fromPos.x + ux * margin, y: fromPos.y + uy * margin };
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Edges first
  for (const e of edges) {
    const from = nodePositions[e.from];
    const to   = nodePositions[e.to];
    if (!from || !to) continue;
    const fromNode = nodeById.get(e.from);
    const toNode   = nodeById.get(e.to);
    const p1 = fromNode ? _srcPt(from, to, fromNode) : from;
    const p2 = toNode   ? _boundaryPt(from, to, toNode) : to;
    const isClass = e.from.startsWith('cls:') || e.to.startsWith('cls:');
    const edgeLine = document.createElementNS(NS, 'line');
    edgeLine.setAttribute('x1', p1.x); edgeLine.setAttribute('y1', p1.y);
    edgeLine.setAttribute('x2', p2.x); edgeLine.setAttribute('y2', p2.y);
    edgeLine.setAttribute('stroke', isClass ? '#88aa88' : '#666');
    edgeLine.setAttribute('stroke-width', '1.5');
    edgeLine.setAttribute('marker-end', isClass ? 'url(#dg-arrow-class)' : 'url(#dg-arrow)');
    g.appendChild(edgeLine);
    // Edge label at midpoint
    const tx = (from.x + to.x) / 2, ty = (from.y + to.y) / 2;
    const tl = document.createElementNS(NS, 'text');
    tl.setAttribute('x', tx); tl.setAttribute('y', ty - 5);
    tl.setAttribute('text-anchor', 'middle'); tl.setAttribute('font-size', '8');
    tl.setAttribute('fill', '#888'); tl.setAttribute('font-family', 'var(--mono)');
    tl.textContent = e.label;
    g.appendChild(tl);
  }

  // Nodes
  for (const n of nodes) {
    const pos = nodePositions[n.id];
    if (!pos) continue;

    const grp = document.createElementNS(NS, 'g');
    grp.classList.add('dg-node');
    grp.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    grp.dataset.nodeId = n.id;
    if (DP.activeNodeId === n.id) grp.classList.add('selected');

    const fill   = n.kind === 'center' ? '#2a4a7a' : '#3a3a5a';
    const stroke = n.kind === 'center' ? '#6aafff' : '#888';

    // Entity virtual node → grey (it's the abstract deduplicated thing);
    // all real spaces (center appearance, parents, children) → CARD palette
    let nodeFill = fill, nodeStroke = stroke;
    if (n.kind === 'entity') {
      nodeFill   = '#3a3a3a';
      nodeStroke = '#888';
    } else if (S.spaces[n.id]) {
      const ci = colIdx(n.id);
      nodeFill   = CARD_BG[ci] || CARD_BG[0];
      nodeStroke = CARD_BD[ci] || CARD_BD[0];
    }

    const isSelected = DP.selIds.has(n.id) || DP.activeNodeId === n.id || n.id === spaceId;
    const selSW = isSelected ? '3' : '1.5';
    const r = n.kind === 'center' ? 22 : 18;
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', r); circle.setAttribute('fill', nodeFill);
    circle.setAttribute('stroke', nodeStroke); circle.setAttribute('stroke-width', selSW);
    grp.appendChild(circle);

    // Label — full text, no truncation
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dy', n.kind === 'class' ? '4' : '3');
    text.setAttribute('font-size', n.kind === 'center' ? '9' : '8');
    text.setAttribute('fill', '#ddd'); text.setAttribute('font-family', 'var(--mono)');
    text.textContent = n.label;
    grp.appendChild(text);

    // Inline space type + class tags below label for space nodes
    {
      const sp2 = S.spaces[n.id];
      const spType = n.cls || sp2?.type || '';
      // Only the virtual entity node shows EntitySpace; appearance/parent spaces show actual type
      const dispType = n.kind === 'entity' ? 'EntitySpace' : spType;
      const spCls = (sp2?.classes || []);
      let dyOff = n.kind === 'center' ? 15 : 13;
      if (spType) {
        const typeT = document.createElementNS(NS, 'text');
        typeT.setAttribute('text-anchor', 'middle');
        typeT.setAttribute('dy', String(dyOff));
        typeT.setAttribute('font-size', '6');
        typeT.setAttribute('fill', '#ffffff');
        typeT.setAttribute('font-family', 'var(--mono)');
        typeT.textContent = spType;
        grp.appendChild(typeT);
        dyOff += 9;
      }
      if (spCls.length > 0) {
        const clsT = document.createElementNS(NS, 'text');
        clsT.setAttribute('text-anchor', 'middle');
        clsT.setAttribute('dy', String(dyOff));
        clsT.setAttribute('font-size', '6.5');
        clsT.setAttribute('fill', '#ffffff');
        clsT.setAttribute('font-family', 'var(--mono)');
        clsT.textContent = spCls.map(c => c.cls).join(' · ');
        grp.appendChild(clsT);
      }
    }

    grp.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('dedup-pred-popup').style.display = 'none';
      DP.activeNodeId = n.id;
      // Entity node: switch viewer to entity-graph mode for that entity
      if (n.kind === 'entity') {
        const eName = n.label;
        const sids = Object.entries(S.spaces)
          .filter(([, s]) => (s.entity || '').trim() === eName)
          .map(([sid]) => sid);
        DP.entityName = eName;
        DP.entityAppearanceSids = sids;
        DP.graphSpaceId = null;
        renderEntityGraph(eName, sids, true);
        return;
      }
      // Left-click: re-centre graph on this node (like clicking its list row)
      if (n.id !== DP.graphSpaceId) {
        DP.graphSpaceId = n.id;
        DP.selIds.clear(); DP.selIds.add(n.id);
        _dedupUpdateSelEdit(n.id);
        // Highlight matching list row
        document.querySelectorAll('.dedup-row').forEach(r => r.classList.remove('selected','multi-sel'));
        document.querySelectorAll(`.dedup-row[data-sids]`).forEach(r => {
          try { const ids = JSON.parse(r.dataset.sids || '[]'); if (ids.includes(n.id)) r.classList.add('selected'); } catch (err) {}
        });
      }
      // Navigate annotation viewer
      const ctx = document.getElementById('dedup-context-select')?.value || 'file';
      if (ctx === 'file' && S.spaces[n.id]) {
        S.selId = n.id;
        selectSpace(n.id, false);
        renderSpacesPanel();
        document.querySelector(`.space-card[data-space-id="${n.id}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      renderDedupGraph(n.id, false);
    });

    grp.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      DP.activeNodeId = n.id;
      _openDedupPredPopup(n.id, grp); // position below this node's circle
    });

    g.appendChild(grp);
  }

  // Fit graph to view
  if (fitBtn) fitBtn.style.display = '';
  if (fitView) _dedupFitGraph();
  if (info) info.textContent = `${sp.name || spaceId}  ·  ${sp.type}  ·  ${nodes.length} node(s)`;
}

// ── Entity Graph: deduplicated entity as center, all appearances linked via appearsIn ──
function renderEntityGraph(entityName, appearanceSids, fitView = false) {
  const svg  = document.getElementById('dedup-graph-svg');
  const g    = document.getElementById('dedup-graph-g');
  const info = document.getElementById('dedup-graph-info');
  const fitBtn = document.getElementById('dedup-graph-fit-btn');
  if (!svg || !g) return;

  DP.entityName = entityName;
  DP.entityAppearanceSids = [...appearanceSids];
  DP.graphSpaceId = null;

  const entitySafeId = 'entity:' + _jsSafe(entityName);
  // Entity-level classes (from global entity_classes store)
  const entityClasses = _getEntityClasses(entityName);

  const nodes = [];
  const edges = [];
  const addedIds = new Set();
  const addNode = (id, label, kind, cls) => {
    if (addedIds.has(id) || nodes.length >= MAX_GRAPH_NODES) return false;
    addedIds.add(id); nodes.push({ id, label, kind, cls }); return true;
  };

  // Entity as center node (synthetic – not a real space)
  // Use the color of the first appearance space so the entity matches its appearances
  const _firstSid = appearanceSids.find(sid => S.spaces[sid]);
  const _entColIdx = _firstSid != null ? colIdx(_firstSid) : 0;
  const _entFill   = CARD_BG[_entColIdx] || CARD_BG[0];
  const _entStroke = CARD_BD[_entColIdx] || CARD_BD[0];
  addNode(entitySafeId, entityName, 'center', null);

  // Each appearance space as child, linked via spot:appearsIn
  for (const sid of appearanceSids) {
    const sp = S.spaces[sid];
    if (!sp) continue;
    if (addNode(sid, sp.name || sid, 'child', sp.type || 'PointSpace')) {
      edges.push({ from: entitySafeId, to: sid, label: 'spot:appearsIn' });
    }
  }

  DP.graphNodes = nodes;
  DP.graphEdges = edges;

  // Layout: entity center at (0,0), appearances spread below
  const nodePositions = {};
  nodePositions[entitySafeId] = { x: 0, y: 0 };
  const _nCharW = 6.5;
  const _nHW = (nd) => Math.max(nd.kind === 'center' ? 22 : 18, Math.ceil(nd.label.length * _nCharW / 2) + 4);
  const _nGap = 20;
  const appNodes = nodes.filter(n => n.kind === 'child');
  if (appNodes.length) {
    const cHWs = appNodes.map(_nHW);
    const totalCW = cHWs.reduce((s, hw) => s + hw * 2 + _nGap, 0) - _nGap;
    let cx2 = -totalCW / 2;
    appNodes.forEach((n, i) => {
      nodePositions[n.id] = { x: cx2 + cHWs[i], y: 130 };
      cx2 += cHWs[i] * 2 + _nGap;
    });
  }

  const NS = 'http://www.w3.org/2000/svg';
  g.innerHTML = '';

  function _boundaryPt(fromPos, toPos, node) {
    const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: toPos.x, y: toPos.y };
    const ux = dx / dist, uy = dy / dist;
    const margin = node.kind === 'center' ? 25 : 21;
    return { x: toPos.x - ux * margin, y: toPos.y - uy * margin };
  }
  function _srcPt(fromPos, toPos, node) {
    const dx = toPos.x - fromPos.x, dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return { x: fromPos.x, y: fromPos.y };
    const ux = dx / dist, uy = dy / dist;
    const margin = node.kind === 'center' ? 25 : 21;
    return { x: fromPos.x + ux * margin, y: fromPos.y + uy * margin };
  }
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Draw edges
  for (const e of edges) {
    const from = nodePositions[e.from], to = nodePositions[e.to];
    if (!from || !to) continue;
    const fromNode = nodeById.get(e.from), toNode = nodeById.get(e.to);
    const p1 = fromNode ? _srcPt(from, to, fromNode) : from;
    const p2 = toNode   ? _boundaryPt(from, to, toNode) : to;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
    line.setAttribute('stroke', '#666'); line.setAttribute('stroke-width', '1.5');
    line.setAttribute('marker-end', 'url(#dg-arrow)');
    g.appendChild(line);
    const tx = (from.x + to.x) / 2, ty = (from.y + to.y) / 2;
    const tl = document.createElementNS(NS, 'text');
    tl.setAttribute('x', tx); tl.setAttribute('y', ty - 5);
    tl.setAttribute('text-anchor', 'middle'); tl.setAttribute('font-size', '8');
    tl.setAttribute('fill', '#888'); tl.setAttribute('font-family', 'var(--mono)');
    tl.textContent = e.label;
    g.appendChild(tl);
  }

  // Draw nodes
  for (const n of nodes) {
    const pos = nodePositions[n.id];
    if (!pos) continue;
    const grp = document.createElementNS(NS, 'g');
    grp.classList.add('dg-node');
    grp.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    grp.dataset.nodeId = n.id;
    if (DP.activeNodeId === n.id) grp.classList.add('selected');

    // Entity center → grey (abstract/deduplicated); appearance children → CARD palette by panel
    let nodeFill   = '#3a3a3a';
    let nodeStroke = '#888';
    if (n.kind !== 'center') {
      const ci = colIdx(n.id);
      nodeFill   = CARD_BG[ci] || CARD_BG[0];
      nodeStroke = CARD_BD[ci] || CARD_BD[0];
    }
    const isSelected = DP.activeNodeId === n.id;
    const r = n.kind === 'center' ? 22 : 18;
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', r); circle.setAttribute('fill', nodeFill);
    circle.setAttribute('stroke', nodeStroke); circle.setAttribute('stroke-width', isSelected ? '3' : '1.5');
    grp.appendChild(circle);

    const text = document.createElementNS(NS, 'text');
    text.setAttribute('text-anchor', 'middle'); text.setAttribute('dy', '3');
    text.setAttribute('font-size', n.kind === 'center' ? '9' : '8');
    text.setAttribute('fill', '#ddd'); text.setAttribute('font-family', 'var(--mono)');
    text.textContent = n.label;
    grp.appendChild(text);

    // Type + class labels below node
    {
      const sp2 = S.spaces[n.id];
      const spType = n.cls || sp2?.type || '';
      // Center (entity) node shows EntitySpace; appearance children show their actual type
      const dispType = n.kind === 'center' ? 'EntitySpace' : spType;
      const spCls  = n.kind === 'center' ? entityClasses : (sp2?.classes || []);
      let dyOff = n.kind === 'center' ? 15 : 13;
      if (dispType) {
        const typeT = document.createElementNS(NS, 'text');
        typeT.setAttribute('text-anchor', 'middle'); typeT.setAttribute('dy', String(dyOff));
        typeT.setAttribute('font-size', '6'); typeT.setAttribute('fill', '#ffffff');
        typeT.setAttribute('font-family', 'var(--mono)');
        typeT.textContent = dispType;
        grp.appendChild(typeT); dyOff += 9;
      }
      if (spCls.length > 0) {
        const clsT = document.createElementNS(NS, 'text');
        clsT.setAttribute('text-anchor', 'middle'); clsT.setAttribute('dy', String(dyOff));
        clsT.setAttribute('font-size', '6.5'); clsT.setAttribute('fill', '#ffffff');
        clsT.setAttribute('font-family', 'var(--mono)');
        clsT.textContent = spCls.map(c => c.cls).join(' · ');
        grp.appendChild(clsT);
      }
    }

    grp.addEventListener('click', (e2) => {
      e2.stopPropagation();
      document.getElementById('dedup-pred-popup').style.display = 'none';
      DP.activeNodeId = n.id;
      if (n.kind === 'center') {
        // Re-render entity graph (re-select center node)
        renderEntityGraph(entityName, appearanceSids, false);
      } else {
        // Appearance node clicked: drill into that space, exit entity mode
        DP.entityName = null;
        DP.entityAppearanceSids = [];
        DP.graphSpaceId = n.id;
        DP.selIds.clear(); DP.selIds.add(n.id);
        _dedupUpdateSelEdit(n.id);
        document.querySelectorAll('.dedup-row').forEach(r => r.classList.remove('selected','multi-sel'));
        document.querySelectorAll('.dedup-row[data-sids]').forEach(r => {
          try { const ids = JSON.parse(r.dataset.sids || '[]'); if (ids.includes(n.id)) r.classList.add('selected'); } catch (err) {}
        });
        if (S.spaces[n.id]) { S.selId = n.id; selectSpace(n.id, false); renderSpacesPanel(); }
        renderDedupGraph(n.id, false);
      }
    });

    grp.addEventListener('contextmenu', (e2) => {
      e2.preventDefault(); e2.stopPropagation();
      DP.activeNodeId = n.id;
      _openDedupPredPopup(n.id, grp);
    });

    g.appendChild(grp);
  }

  if (fitBtn) fitBtn.style.display = '';
  if (fitView) _dedupFitGraph();
  if (info) info.textContent = `${entityName}  ·  Entity  ·  ${appNodes.length} appearance(s)`;
  renderDedupClassList();
}

function _dedupFitGraph() {
  const svg = document.getElementById('dedup-graph-svg');
  const g   = document.getElementById('dedup-graph-g');
  if (!svg || !g || !DP.graphNodes.length) return;
  const pad = 40;
  const bb  = g.getBBox();
  if (!bb.width || !bb.height) return;
  const vw = svg.clientWidth  || 400;
  const vh = svg.clientHeight || 300;
  const sc = Math.min((vw - pad*2) / bb.width, (vh - pad*2) / bb.height, 3);
  const tx = vw/2 - (bb.x + bb.width/2)  * sc;
  const ty = vh/2 - (bb.y + bb.height/2) * sc;
  DP.graphTransform = { x: tx, y: ty, scale: sc };
  g.setAttribute('transform', `translate(${tx},${ty}) scale(${sc})`);
}

// ── Graph pan/zoom ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const svg = document.getElementById('dedup-graph-svg');
  if (!svg) return;

  let panning = false, startX = 0, startY = 0, startTx = 0, startTy = 0;
  const g = document.getElementById('dedup-graph-g');

  svg.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      // Middle-mouse always pans, regardless of target
      panning = true; startX = e.clientX; startY = e.clientY;
      startTx = DP.graphTransform.x; startTy = DP.graphTransform.y;
      svg.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (e.target.closest('.dg-node')) return;
    panning = true; startX = e.clientX; startY = e.clientY;
    startTx = DP.graphTransform.x; startTy = DP.graphTransform.y;
    svg.style.cursor = 'grabbing';
    e.preventDefault();
  });
  svg.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    DP.graphTransform.x = startTx + e.clientX - startX;
    DP.graphTransform.y = startTy + e.clientY - startY;
    g.setAttribute('transform',
      `translate(${DP.graphTransform.x},${DP.graphTransform.y}) scale(${DP.graphTransform.scale})`);
  });
  window.addEventListener('mouseup', () => { panning = false; svg.style.cursor = 'grab'; });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.max(0.15, Math.min(8, DP.graphTransform.scale * delta));
    DP.graphTransform.x = mx - (mx - DP.graphTransform.x) * (newScale / DP.graphTransform.scale);
    DP.graphTransform.y = my - (my - DP.graphTransform.y) * (newScale / DP.graphTransform.scale);
    DP.graphTransform.scale = newScale;
    g.setAttribute('transform',
      `translate(${DP.graphTransform.x},${DP.graphTransform.y}) scale(${DP.graphTransform.scale})`);
  }, { passive: false });

  // Fit button
  document.getElementById('dedup-graph-fit-btn')?.addEventListener('click', _dedupFitGraph);

  // Click SVG background → close popup / deselect node
  svg.addEventListener('click', (e) => {
    if (e.target === svg || e.target === g) {
      DP.activeNodeId = null;
      document.getElementById('dedup-pred-popup').style.display = 'none';
    }
  });

  // ── Popup: mode-selection ──
  document.getElementById('dpop-btn-close')?.addEventListener('click', () => {
    document.getElementById('dedup-pred-popup').style.display = 'none';
    DP.activeNodeId = null;
    if (DP.entityName) renderEntityGraph(DP.entityName, DP.entityAppearanceSids, false);
    else if (DP.graphSpaceId) renderDedupGraph(DP.graphSpaceId);
  });
  document.getElementById('dpop-btn-class')?.addEventListener('click', () => {
    document.getElementById('dpop-mode').style.display = 'none';
    document.getElementById('dpop-class').style.display = 'block';
    document.getElementById('dedup-pred-input').value = 'rdf:type';
    document.getElementById('dedup-class-input').value = '';
    const { predicates, classes } = _allOntologyTerms();
    _rebindAC('dedup-pred-input',  'dedup-pred-ac',  predicates);
    _rebindAC('dedup-class-input', 'dedup-class-ac', classes);
    // Class assoc always applies to single active node — hide multi note
    const note = document.getElementById('dedup-popup-multi-note');
    if (note) note.style.display = 'none';
    document.getElementById('dedup-class-input').focus();
  });
  document.getElementById('dpop-btn-instance')?.addEventListener('click', () => {
    document.getElementById('dpop-mode').style.display = 'none';
    document.getElementById('dpop-instance').style.display = 'block';
    document.getElementById('dedup-inst-pred-input').value = 'owl:sameAs';
    document.getElementById('dedup-inst-input').value = '';
    const instanceTerms = [];
    const seenTerms = new Set();
    const addTerm = (label, value) => {
      const cleanLabel = (label || '').trim();
      const cleanValue = (value || '').trim();
      if (!cleanLabel || !cleanValue) return;
      const key = `${cleanLabel}\u0000${cleanValue}`;
      if (seenTerms.has(key)) return;
      seenTerms.add(key);
      instanceTerms.push({ label: cleanLabel, value: cleanValue });
    };

    for (const sp of Object.values(S.spaces)) {
      const name = (sp.name || '').trim();
      if (!name) continue;
      addTerm(sp.entity ? `Appearance: ${name}` : `Space: ${name}`, name);
    }
    for (const entityName of _globalEntityNames || []) {
      addTerm(`Entity: ${entityName}`, entityName);
    }

    // Predicates from ontology; instance suggestions now include spaces, appearances, and entities.
    const { predicates } = _allOntologyTerms();
    _rebindAC('dedup-inst-pred-input', 'dedup-inst-pred-ac', predicates);
    _rebindAC('dedup-inst-input', 'dedup-inst-ac', instanceTerms);
    document.getElementById('dedup-inst-input').focus();
  });
  document.getElementById('dpop-btn-delete')?.addEventListener('click', () => {
    document.getElementById('dpop-mode').style.display = 'none';
    document.getElementById('dpop-delete').style.display = 'block';
    _renderDedupDeletePanel();
  });
  document.getElementById('dpop-delete-cancel')?.addEventListener('click', () => {
    document.getElementById('dpop-delete').style.display = 'none';
    document.getElementById('dpop-mode').style.display = '';
  });

  // ── Popup: class link confirm / back ──
  document.getElementById('dedup-pred-confirm')?.addEventListener('click', () => {
    _dedupConfirmClassAssoc();
  });
  document.getElementById('dedup-pred-cancel')?.addEventListener('click', () => {
    document.getElementById('dpop-class').style.display = 'none';
    document.getElementById('dpop-mode').style.display = '';
  });

  // ── Popup: instance link confirm / back ──
  document.getElementById('dedup-inst-confirm')?.addEventListener('click', () => {
    _dedupConfirmInstanceAssoc();
  });
  document.getElementById('dedup-inst-cancel')?.addEventListener('click', () => {
    document.getElementById('dpop-instance').style.display = 'none';
    document.getElementById('dpop-mode').style.display = '';
  });

  // Filter input
  document.getElementById('dedup-filter-input')?.addEventListener('input', () => renderDedupSpaceList());

  // Close popup on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const popup = document.getElementById('dedup-pred-popup');
      if (popup && popup.style.display !== 'none') {
        popup.style.display = 'none';
        e.stopPropagation();
      }
    }
  });
});

function _openDedupPredPopup(spaceId, anchor) {
  const popup = document.getElementById('dedup-pred-popup');
  if (!popup) return;
  document.getElementById('dpop-mode').style.display     = 'block';
  document.getElementById('dpop-class').style.display    = 'none';
  document.getElementById('dpop-instance').style.display = 'none';
  document.getElementById('dpop-delete').style.display   = 'none';
  popup.style.display = 'block';

  if (anchor instanceof Element) {
    // Position centered just below the node circle
    const wrap = document.getElementById('dedup-graph-wrap');
    const wr   = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 400 };
    const nb   = anchor.getBoundingClientRect();
    const pw   = popup.offsetWidth  || 120;
    const ph   = popup.offsetHeight || 60;
    let lx = (nb.left + nb.right) / 2 - wr.left - pw / 2;  // centered on node
    let ly = nb.top - wr.top - ph - 6;                       // just above node
    lx = Math.max(0, Math.min(lx, (wrap?.offsetWidth  || 600) - pw));
    ly = Math.max(0, Math.min(ly, (wrap?.offsetHeight || 400) - ph));
    popup.style.left  = lx + 'px';
    popup.style.top   = ly + 'px';
    popup.style.right = 'auto';
  }
}

function _renderDedupDeletePanel() {
  const listEl = document.getElementById('dpop-delete-list');
  if (!listEl) return;

  const isEntityMode = DP.entityName && DP.activeNodeId === 'entity:' + _jsSafe(DP.entityName);
  let classes = [];
  let ek = null;
  if (isEntityMode) {
    ek = _jsSafe(DP.entityName);
    classes = _getEntityClasses(DP.entityName);
  } else {
    const sid = DP.activeNodeId || DP.graphSpaceId;
    const sp = sid ? S.spaces[sid] : null;
    classes = sp?.classes || [];
  }

  listEl.innerHTML = '';
  if (!classes.length) {
    listEl.innerHTML = '<div class="dpop-del-empty">No linked classes or instances</div>';
    return;
  }
  classes.forEach((assoc, idx) => {
    const item = document.createElement('div');
    item.className = 'dpop-del-item';
    const label = document.createElement('span');
    label.className = 'dpop-del-item-label';
    const kind = _assocKind(assoc);
    label.title = `${kind} link: ${assoc.pred} → ${assoc.cls}`;
    const pred = document.createElement('span');
    pred.className = 'dpop-del-item-pred';
    pred.textContent = assoc.pred + '  ';
    label.appendChild(pred);
    const kindTag = document.createElement('span');
    kindTag.style.cssText = 'margin-right:4px;font-size:8px;opacity:.75;text-transform:uppercase';
    kindTag.textContent = kind;
    label.appendChild(kindTag);
    label.appendChild(document.createTextNode(assoc.cls));
    const xBtn = document.createElement('button');
    xBtn.className = 'dpop-del-item-x';
    xBtn.textContent = '✕';
    xBtn.title = 'Remove this link';
    xBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      snapshot();
      if (isEntityMode) {
        const arr = _globalEntityClasses[ek] ? [..._globalEntityClasses[ek]] : [];
        arr.splice(idx, 1);
        _globalEntityClasses[ek] = arr;
        fetch('/api/entity_classes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(_globalEntityClasses) }).catch(() => {});
        renderEntityGraph(DP.entityName, DP.entityAppearanceSids, false);
      } else {
        const sid = DP.activeNodeId || DP.graphSpaceId;
        const sp = S.spaces[sid];
        if (sp?.classes) sp.classes.splice(idx, 1);
        S.dirty = true; autoSave();
        if (DP.graphSpaceId) renderDedupGraph(DP.graphSpaceId);
      }
      renderDedupSpaceList();
      renderDedupClassList();
      _renderDedupDeletePanel(); // refresh list
    });
    item.appendChild(label);
    item.appendChild(xBtn);
    listEl.appendChild(item);
  });
}

function _dedupConfirmClassAssoc() {
  const pred = document.getElementById('dedup-pred-input').value.trim();
  const cls  = document.getElementById('dedup-class-input').value.trim();
  if (!pred || !cls) { notify('Enter both predicate and class', 2000); return; }

  const isEntityMode = DP.entityName && DP.activeNodeId === 'entity:' + _jsSafe(DP.entityName);

  snapshot();
  if (isEntityMode) {
    // Store class on the entity in the global cross-file store
    const ek = _jsSafe(DP.entityName);
    if (!_globalEntityClasses[ek]) _globalEntityClasses[ek] = [];
    if (!_globalEntityClasses[ek].some(a => a.pred === pred && a.cls === cls && _assocKind(a) === 'class')) {
      _globalEntityClasses[ek].push({ pred, cls, kind: 'class' });
    }
    fetch('/api/entity_classes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_globalEntityClasses) }).catch(() => {});
    document.getElementById('dedup-pred-popup').style.display = 'none';
    renderEntityGraph(DP.entityName, DP.entityAppearanceSids, false);
    notify(`Class association added to entity "${DP.entityName}"`, 2500);
  } else {
    // Apply to the single active (right-clicked) space node
    const target = DP.activeNodeId || DP.graphSpaceId;
    const targets = target ? [target] : [];
    if (!targets.length) { notify('Select a space first', 2000); return; }
    for (const sid of targets) {
      const sp = S.spaces[sid];
      if (!sp) continue;
      if (!sp.classes) sp.classes = [];
      if (!sp.classes.some(a => a.pred === pred && a.cls === cls && _assocKind(a) === 'class')) {
        sp.classes.push({ pred, cls, kind: 'class' });
      }
    }
    S.dirty = true; autoSave();
    document.getElementById('dedup-pred-popup').style.display = 'none';
    if (DP.graphSpaceId) renderDedupGraph(DP.graphSpaceId);
    notify(`Class association added to ${targets.length} space(s)`, 2500);
  }
  renderDedupClassList();
  renderDedupSpaceList();
}

function _dedupConfirmInstanceAssoc() {
  const pred = document.getElementById('dedup-inst-pred-input').value.trim();
  const inst = document.getElementById('dedup-inst-input').value.trim();
  if (!pred || !inst) { notify('Enter both predicate and instance name', 2000); return; }
  snapshot();
  const isEntityMode = DP.entityName && DP.activeNodeId === 'entity:' + _jsSafe(DP.entityName);
  if (isEntityMode) {
    const ek = _jsSafe(DP.entityName);
    if (!_globalEntityClasses[ek]) _globalEntityClasses[ek] = [];
    if (!_globalEntityClasses[ek].some(a => a.pred === pred && a.cls === inst && _assocKind(a) === 'instance')) {
      _globalEntityClasses[ek].push({ pred, cls: inst, kind: 'instance' });
    }
    fetch('/api/entity_classes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_globalEntityClasses) }).catch(() => {});
    document.getElementById('dedup-pred-popup').style.display = 'none';
    renderEntityGraph(DP.entityName, DP.entityAppearanceSids, false);
    notify(`Instance link added to entity "${DP.entityName}"`, 2500);
  } else {
    const targets = DP.selIds.size > 0 ? [...DP.selIds] : (DP.graphSpaceId ? [DP.graphSpaceId] : []);
    if (!targets.length) { notify('Select a space first', 2000); return; }
    for (const sid of targets) {
      const sp = S.spaces[sid];
      if (!sp) continue;
      if (!sp.classes) sp.classes = [];
      if (!sp.classes.some(a => a.pred === pred && a.cls === inst && _assocKind(a) === 'instance')) {
        sp.classes.push({ pred, cls: inst, kind: 'instance' });
      }
    }
    S.dirty = true; autoSave();
    document.getElementById('dedup-pred-popup').style.display = 'none';
    const _instRenderTarget = targets[0] || DP.graphSpaceId;
    if (_instRenderTarget) { DP.graphSpaceId = _instRenderTarget; renderDedupGraph(_instRenderTarget); }
    notify(`Instance link added to ${targets.length} space(s)`, 2500);
  }
  renderDedupClassList();
  renderDedupSpaceList();
}

// ── Class list (below graph) ──────────────────────────────────
function renderDedupClassList() {
  const listEl = document.getElementById('dedup-class-list');
  if (!listEl) return;

  // In entity mode, show entity-level classes (from global cross-file store)
  let classes = [];
  let sp = null;
  if (DP.entityName) {
    classes = _getEntityClasses(DP.entityName);
  } else {
    const sid = DP.graphSpaceId || (DP.selIds.size === 1 ? [...DP.selIds][0] : null);
    sp = sid ? S.spaces[sid] : null;
    classes = sp?.classes || [];
  }

  if (!classes.length) {
    listEl.innerHTML = '<span style="color:var(--text3);font-size:9px;font-family:var(--mono)">None</span>';
    return;
  }
  listEl.innerHTML = '';
  classes.forEach((assoc, i) => {
    const item = document.createElement('div');
    item.className = 'dedup-class-item';
    const kind = _assocKind(assoc);
    item.innerHTML = `
      <span class="dedup-class-kind" style="font-size:8px;opacity:.75;text-transform:uppercase;margin-right:4px">${kind}</span>
      <span class="dedup-class-pred">${assoc.pred}</span>
      <span class="dedup-class-val" title="${assoc.cls}">${assoc.cls}</span>
      <button class="dedup-class-del" title="Remove" data-idx="${i}">✕</button>`;
    item.querySelector('.dedup-class-del').addEventListener('click', () => {
      snapshot();
      if (DP.entityName) {
        const ek = _jsSafe(DP.entityName);
        const arr = _globalEntityClasses[ek] ? [..._globalEntityClasses[ek]] : [];
        arr.splice(i, 1);
        _globalEntityClasses[ek] = arr;
        fetch('/api/entity_classes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(_globalEntityClasses) }).catch(() => {});
        renderEntityGraph(DP.entityName, DP.entityAppearanceSids, false);
      } else {
        if (sp?.classes) sp.classes.splice(i, 1);
        S.dirty = true; autoSave();
        if (DP.graphSpaceId) renderDedupGraph(DP.graphSpaceId);
      }
      renderDedupSpaceList();
      renderDedupClassList();
    });
    listEl.appendChild(item);
  });
}

// ── Ontology loading ──────────────────────────────────────────
function _setupDedupOntologyInput() {
  const inp = document.getElementById('onto-input');
  const btn = document.getElementById('btn-load-onto');
  if (!inp || !btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener('click', () => inp.click());
  inp.addEventListener('change', (e) => _loadOntologyFiles(e.target.files));
  const urlInp = document.getElementById('onto-url-input');
  const urlBtn = document.getElementById('btn-load-onto-url');
  urlBtn?.addEventListener('click', () => _loadOntologyFromUrl(urlInp?.value.trim()));
  urlInp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') _loadOntologyFromUrl(urlInp.value.trim()); });
}

async function _loadOntologyFiles(files) {
  for (const file of Array.from(files)) {
    const text = await file.text();
    const onto = _parseMinimalTtl(text, file.name);
    _globalOntologies = _globalOntologies.filter(o => o.name !== onto.name);
    _globalOntologies.push(onto);
  }
  DP.ontologies = _globalOntologies;
  _saveGlobalOntologies();
  _renderOntologyList();
  notify(`${files.length} ontolog${files.length===1?'y':'ies'} loaded`, 2000);
  autoSave();
}

async function _loadOntologyFromUrl(url) {
  if (!url) return;
  try {
    notify('Fetching ontology…', 2000);
    const resp = await fetch('/api/sparql/ontology/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const onto = await resp.json();
    // onto = { name, mainPrefix, classes[], predicates[], prefixes{}, url }
    // Store the original URL as the .name so the anchor link opens it correctly
    onto.name = url;
    onto.content = '';   // full TTL not needed client-side
    _globalOntologies = _globalOntologies.filter(o => o.name !== onto.name);
    _globalOntologies.push(onto);
    DP.ontologies = _globalOntologies;
    _saveGlobalOntologies();
    _renderOntologyList();
    _setupDedupAutocomplete();
    notify(`Loaded: ${onto.classes.length}C / ${onto.predicates.length}P`, 2800);
    autoSave();
  } catch (err) {
    notify(`Failed to load ontology: ${err.message}`, 4000);
  }
}

function _parseMinimalTtl(text, filename) {
  const classes    = [];
  const predicates = [];
  const prefixes   = {};
  const content    = text;

  // Strip line comments (not inside string literals — good enough approximation)
  const stripped = text.replace(/#[^\n]*/g, '');

  // Extract @prefix / PREFIX declarations (handle both Turtle and SPARQL-style)
  const prefixRe = /(?:@prefix|PREFIX)\s+(\w*):\s*<([^>]+)>\s*\.?/gi;
  let m;
  while ((m = prefixRe.exec(stripped)) !== null) {
    if (m[1] !== undefined) prefixes[m[1]] = m[2];
  }

  const prefixKeys = Object.keys(prefixes).sort((a, b) => b.length - a.length);
  function abbrev(uri) {
    for (const pf of prefixKeys) {
      if (uri.startsWith(prefixes[pf])) return pf + ':' + uri.slice(prefixes[pf].length);
    }
    return '<' + uri + '>';
  }
  function resolveSubject(s) {
    s = s.trim();
    if (s.startsWith('<') && s.endsWith('>')) return abbrev(s.slice(1, -1));
    return s;
  }

  // Split into statement blocks at '.' that ends a statement.
  // We split on '.' followed by whitespace or end-of-string, avoiding splits inside <URIs> or "strings".
  // Simple heuristic: split on /\.\s*(?=\n|$)/ – a bit loose but handles the vast majority of real TTL.
  const blocks = stripped.split(/\.(?=[\s]|$)/);

  const CLASS_TYPES  = new Set(['owl:Class', 'rdfs:Class']);
  const PROP_TYPES   = new Set(['owl:ObjectProperty', 'owl:DatatypeProperty',
                                 'owl:AnnotationProperty', 'rdf:Property']);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith('@') || /^(?:@?prefix|PREFIX|BASE|@base)\b/i.test(trimmed)) continue;

    // Extract subject: first curie or full URI
    const subjMatch = trimmed.match(/^([\w][\w.-]*:[\w][\w.-]*|<[^>]+>)/);
    if (!subjMatch) continue;
    const subject = resolveSubject(subjMatch[1]);
    if (!subject || subject.startsWith('_:') || subject.startsWith('<')) continue;

    // Split block into individual predicate-object triples by ';'
    // (the first segment contains the subject, subsequent ones do not)
    const segments = trimmed.split(';');

    // Gather all tokens that appear as objects with `a` or `rdf:type` as predicate
    const typeTerms = new Set();
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].trim();
      // First segment: "SUBJECT a TYPE1, TYPE2" or "SUBJECT rdf:type TYPE"
      // Later segments:  "a TYPE" or "rdf:type TYPE"
      const predObjMatch = seg.match(/(?:^[\w:]+\s+|^<[^>]+>\s+)?\b(a|rdf:type)\s+([\w:,\s<>]+)/);
      if (!predObjMatch) continue;
      const objPart = predObjMatch[2];
      // Split comma-separated types
      for (const tok of objPart.split(',')) {
        let t = tok.trim();
        if (t.startsWith('<') && t.endsWith('>')) t = abbrev(t.slice(1, -1));
        if (t) typeTerms.add(t);
      }
    }

    const isClass = [...typeTerms].some(t => CLASS_TYPES.has(t));
    const isProp  = [...typeTerms].some(t => PROP_TYPES.has(t));
    if (isClass && !classes.includes(subject))    classes.push(subject);
    if (isProp  && !predicates.includes(subject)) predicates.push(subject);
  }

  // Derive the primary prefix used by classes/predicates (for display)
  const usedPrefixes = new Map(); // prefix → count
  for (const term of [...classes, ...predicates]) {
    const colon = term.indexOf(':');
    if (colon > 0) {
      const pf = term.slice(0, colon);
      usedPrefixes.set(pf, (usedPrefixes.get(pf) || 0) + 1);
    }
  }
  let mainPrefix = '';
  if (usedPrefixes.size > 0) {
    mainPrefix = [...usedPrefixes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  return {
    name: filename,
    mainPrefix,
    classes:    classes.sort(),
    predicates: predicates.sort(),
    prefixes,
    content,
  };
}

function _renderOntologyList() {
  const listEl = document.getElementById('dedup-onto-list');
  if (!listEl) return;
  if (!DP.ontologies.length) {
    listEl.innerHTML = '<div style="color:var(--text3);font-size:9px;font-family:var(--mono);padding:6px 8px;text-align:center">No ontologies loaded</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const onto of DP.ontologies) {
    const item = document.createElement('div');
    item.className = 'dedup-onto-item';

    const displayName = onto.mainPrefix ? onto.mainPrefix + ':' : onto.name;
    const header = document.createElement('div');
    header.className = 'dedup-onto-header';
    header.innerHTML = `
      <button class="dedup-onto-toggle" title="Expand/Collapse">▶</button>
      <span class="dedup-onto-prefix" title="${onto.name}">${displayName}</span>
      <a class="dedup-onto-filename" href="${onto.name}" target="_blank" title="Open ontology" onclick="event.stopPropagation()">${onto.name}</a>
      <span class="dedup-onto-count">${onto.classes.length}C / ${onto.predicates.length}P</span>
      <button class="dedup-onto-del" title="Remove">✕</button>`;

    const details = document.createElement('div');
    details.className = 'dedup-onto-details';
    details.style.display = 'none';

    if (onto.classes.length) {
      const sec = document.createElement('div');
      sec.className = 'dedup-onto-section';
      sec.innerHTML = '<span class="dedup-onto-sec-lbl">Classes</span>';
      const tags = document.createElement('div');
      tags.className = 'dedup-onto-tags';
      onto.classes.forEach(c => {
        const t = document.createElement('span');
        t.className = 'dedup-onto-tag cls-tag'; t.textContent = c;
        tags.appendChild(t);
      });
      sec.appendChild(tags); details.appendChild(sec);
    }
    if (onto.predicates.length) {
      const sec = document.createElement('div');
      sec.className = 'dedup-onto-section';
      sec.innerHTML = '<span class="dedup-onto-sec-lbl">Properties</span>';
      const tags = document.createElement('div');
      tags.className = 'dedup-onto-tags';
      onto.predicates.forEach(p => {
        const t = document.createElement('span');
        t.className = 'dedup-onto-tag pred-tag'; t.textContent = p;
        tags.appendChild(t);
      });
      sec.appendChild(tags); details.appendChild(sec);
    }
    if (!onto.classes.length && !onto.predicates.length) {
      details.innerHTML = '<div style="color:var(--text3);font-size:9px;font-family:var(--mono);padding:4px 8px">No classes or properties detected — check TTL format</div>';
    }

    const toggleBtn = header.querySelector('.dedup-onto-toggle');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = details.style.display !== 'none';
      details.style.display = open ? 'none' : 'block';
      toggleBtn.textContent = open ? '▶' : '▼';
    });

    header.querySelector('.dedup-onto-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Remove ontology "${onto.name}".\nAssociated class links will also be deleted.`)) return;
      const ontoClassSet = new Set(onto.classes);
      let assocCount = 0;
      for (const sp of Object.values(S.spaces || {})) {
        assocCount += (sp.classes || []).filter(a => ontoClassSet.has(a.cls)).length;
      }
      const msg = assocCount > 0
        ? `This will permanently delete ${assocCount} class association${assocCount!==1?'s':''} across all spaces that use classes from "${onto.name}".\n\nConfirm deletion?`
        : `No class associations reference "${onto.name}". Confirm removal?`;
      if (!confirm(msg)) return;
      let changed = false;
      for (const sp of Object.values(S.spaces || {})) {
        if (sp.classes?.length) {
          const before = sp.classes.length;
          sp.classes = sp.classes.filter(a => !ontoClassSet.has(a.cls));
          if (sp.classes.length !== before) changed = true;
        }
      }
      _globalOntologies = _globalOntologies.filter(o => o.name !== onto.name);
      DP.ontologies = _globalOntologies;
      _saveGlobalOntologies();
      _renderOntologyList();
      if (changed) { S.dirty = true; renderSpacesPanel(); if (DP.graphSpaceId) renderDedupGraph(DP.graphSpaceId); }
      autoSave();
    });

    item.appendChild(header);
    item.appendChild(details);
    listEl.appendChild(item);
  }
  // Re-setup autocomplete after ontologies change
  _setupDedupAutocomplete();
}

// ── Autocomplete for predicate + class inputs ─────────────────
function _allOntologyTerms() {
  const preds = new Set();
  const cls   = new Set();
  for (const onto of DP.ontologies) {
    onto.predicates.forEach(p => preds.add(p));
    onto.classes.forEach(c => cls.add(c));
  }
  // Built-in fallback only shown when no ontology defines anything
  if (!preds.size) {
    ['rdf:type','rdfs:label','rdfs:comment','rdfs:subClassOf','owl:sameAs',
     'owl:equivalentClass','spot:hasXAxis','spot:hasYAxis','spot:hasZAxis'].forEach(p => preds.add(p));
  }
  if (!cls.size) {
    ['owl:Class','rdfs:Class','bot:Zone','bot:Space','bot:Element',
     'bot:Interface','spot:DocumentSpace','spot:PointSpace','spot:LineSpace','spot:AssetSpace'].forEach(c => cls.add(c));
  }
  return { predicates: [...preds].sort(), classes: [...cls].sort() };
}

// Terms are stored on the element (_acTerms) and read live — call _bindAC/rebindAC to update.
function _rebindAC(inputId, acId, terms) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp._acTerms = Array.isArray(terms) ? terms : [];
  _bindAC(inputId, acId); // attach listeners if not yet done
}

function _setupDedupAutocomplete() {
  const { predicates, classes } = _allOntologyTerms();
  _rebindAC('dedup-pred-input',  'dedup-pred-ac',  predicates);
  _rebindAC('dedup-class-input', 'dedup-class-ac', classes);
}

function _bindAC(inputId, acId) {
  const inp = document.getElementById(inputId);
  const ac  = document.getElementById(acId);
  if (!inp || !ac) return;
  if (!inp._acTerms) inp._acTerms = [];
  if (inp._acBound) return;   // listeners already attached
  inp._acBound = true;
  let focIdx = -1;

  function show(filter) {
    const terms = inp._acTerms || [];
    const q = (filter||'').toLowerCase();
    const matches = q ? terms.filter(t => {
      const label = typeof t === 'string' ? t : (t?.label || t?.value || '');
      const value = typeof t === 'string' ? t : (t?.value || label);
      return label.toLowerCase().includes(q) || value.toLowerCase().includes(q);
    }) : terms;
    if (!matches.length) { ac.style.display = 'none'; return; }
    ac.innerHTML = '';
    matches.slice(0, 30).forEach(t => {
      const label = typeof t === 'string' ? t : (t?.label || t?.value || '');
      const value = typeof t === 'string' ? t : (t?.value || label);
      const item = document.createElement('div');
      item.className = 'dedup-ac-item';
      item.textContent = label;
      item.dataset.acValue = value;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        inp.value = value;
        ac.style.display = 'none';
      });
      ac.appendChild(item);
    });
    ac.style.display = 'block';
    focIdx = -1;
  }

  inp.addEventListener('input',  () => show(inp.value));
  inp.addEventListener('focus',  () => show(inp.value));
  inp.addEventListener('blur',   () => setTimeout(() => { ac.style.display = 'none'; }, 160));
  inp.addEventListener('keydown', (e) => {
    const items = ac.querySelectorAll('.dedup-ac-item');
    if (!items.length || ac.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focIdx = Math.min(focIdx+1, items.length-1); items.forEach((it,i) => it.classList.toggle('focused', i===focIdx)); items[focIdx]?.scrollIntoView({block:'nearest'}); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); focIdx = Math.max(focIdx-1, 0);              items.forEach((it,i) => it.classList.toggle('focused', i===focIdx)); items[focIdx]?.scrollIntoView({block:'nearest'}); }
    if (e.key === 'Enter' && focIdx >= 0) { e.preventDefault(); inp.value = items[focIdx].dataset.acValue || items[focIdx].textContent; ac.style.display = 'none'; }
    if (e.key === 'Escape') ac.style.display = 'none';
  });
}

// ── Context change ────────────────────────────────────────────
// Batch-fetch full project data for projects not yet in _dedupFullCache.
async function _dedupLoadProjects(pids) {
  const missing = pids.filter(pid => !_dedupFullCache.has(pid));
  if (!missing.length) return;
  await Promise.all(missing.map(async pid => {
    try {
      const r = await fetch(`/api/project/${pid}`);
      if (r.ok) _dedupFullCache.set(pid, await r.json());
    } catch (err) {}
  }));
}

function _setupDedupContextChange() {
  const sel = document.getElementById('dedup-context-select');
  if (!sel || sel._bound) return;
  sel._bound = true;
  sel.addEventListener('change', async () => {
    DP.selIds.clear();
    renderDedupSpaceList(); // show immediately (empties while loading)
    const g = document.getElementById('dedup-graph-g');
    if (g) g.innerHTML = '';
    const info = document.getElementById('dedup-graph-info');
    if (info) info.textContent = 'Select a space from the list to view its graph';
    const fitBtn = document.getElementById('dedup-graph-fit-btn');
    if (fitBtn) fitBtn.style.display = 'none';

    const ctx = sel.value;
    if (ctx === 'all' || ctx === 'environment') {
      // Async-load full project data for projects not yet cached.
      const envFilter = ctx === 'environment' ? selectedEnvId : null;
      const pids = (S.projects || [])
        .filter(p => !envFilter || p.env_id === envFilter)
        .map(p => p.id);
      await _dedupLoadProjects(pids);
      renderDedupSpaceList(); // re-render with full space data
    }
  });
}

// ── Panel resize (top edge drag) ──────────────────────────────
function _setupDedupResizers() {
  // Top-edge height resize
  const rszr  = document.getElementById('dedup-panel-resizer');
  const panel = document.getElementById('dedup-panel');
  if (!rszr || !panel || rszr._bound) return;
  rszr._bound = true;
  let on = false, startY = 0, startH = 0;
  rszr.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    on = true; startY = e.clientY; startH = panel.offsetHeight; e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!on) return;
    const viewH = document.getElementById('viewer-area').offsetHeight;
    const newH  = Math.max(80, Math.min(viewH, startH + (startY - e.clientY)));
    panel.style.height = newH + 'px';
  });
  window.addEventListener('mouseup', () => { on = false; });

  // Left/right vertical divider drag
  const vd    = document.getElementById('dedup-vert-divider');
  const left  = document.getElementById('dedup-left');
  if (!vd || !left || vd._bound) return;
  vd._bound = true;
  let vOn = false, vStartX = 0, vStartW = 0;
  vd.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    vOn = true; vStartX = e.clientX; vStartW = left.offsetWidth; e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!vOn) return;
    const bodyW = document.getElementById('dedup-body').offsetWidth;
    const newW  = Math.max(120, Math.min(bodyW - 120, vStartW + e.clientX - vStartX));
    left.style.width = newW + 'px';
  });
  window.addEventListener('mouseup', () => { vOn = false; });

  // Top/bottom inner divider drag
  const ld      = document.getElementById('dedup-left-divider');
  const listTop = document.getElementById('dedup-list-top');
  const listBot = document.getElementById('dedup-list-bottom');
  if (!ld || !listTop || !listBot || ld._bound) return;
  ld._bound = true;
  let lOn = false, lStartY = 0, lStartH = 0;
  ld.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    lOn = true; lStartY = e.clientY; lStartH = listTop.offsetHeight; e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!lOn) return;
    const leftH = document.getElementById('dedup-left').offsetHeight;
    const hdrH  = 30;
    const newH  = Math.max(60, Math.min(leftH - hdrH - 60, lStartH + e.clientY - lStartY));
    listTop.style.flex = 'none'; listTop.style.height = newH + 'px';
  });
  window.addEventListener('mouseup', () => { lOn = false; });
}

// ── Hook autocomplete setup on panel open ─────────────────────
const _origOpenDedup = openDedupPanel;
// (autocomplete is set up when ontologies are loaded; also set up defaults on first open)
document.addEventListener('DOMContentLoaded', () => {
  // Setup default autocomplete with built-in terms
  document.getElementById('dedup-panel')?.addEventListener('transitionend', _setupDedupAutocomplete, { once: true });
  // Also trigger on btn-load-onto click
  document.getElementById('btn-load-onto')?.addEventListener('click', () => {
    if (!DP.open) return;
    document.getElementById('onto-input')?.click();
  });
});

// ════════════════════════════════════════════════════════════════
// 3D VIEWER PANEL
// ════════════════════════════════════════════════════════════════

const V3D = { open: false, renderer: null, scene: null, camera: null, _animId: null, grid: null, gridOn: false, assetFrame: null };
const _nav3D = { target: null, r: 15, phi: 1.0, theta: 0.8, btn: -1, lx: 0, ly: 0 };

// ════════════════════════════════════════════════════════════════
// BP-IN-ASSET  — reference overlay state
// ════════════════════════════════════════════════════════════════
const _BP = { active: false, spAId: null, spXId: null, spXProjId: null, spXProj: null,
              ox: 0, oy: 0, scale: 1, panning: false, panCtrl: false, pmx: 0, pmy: 0 };
// Cache of full project data keyed by project id (avoids re-fetching)
const _bpProjCache = {};

function toggle3DPanel() { V3D.open ? close3DPanel() : open3DPanel(); }

function open3DPanel() {
  V3D.open = true;
  const _v3dPanel = document.getElementById('viewer3d-panel');
  const _v3dViewerH = document.getElementById('viewer-area')?.offsetHeight || 400;
  _v3dPanel.style.height = _v3dViewerH + 'px';
  _v3dPanel.classList.add('open');
  document.getElementById('btn-viewer3d').classList.add('active');
  _init3DViewer();
}

function close3DPanel() {
  V3D.open = false;
  document.getElementById('viewer3d-panel').classList.remove('open');
  document.getElementById('btn-viewer3d').classList.remove('active');
  if (V3D._animId) { cancelAnimationFrame(V3D._animId); V3D._animId = null; }
}

function toggle3DGrid() {
  if (!V3D.grid) return;
  V3D.gridOn = !V3D.gridOn;
  V3D.grid.visible = V3D.gridOn;
  document.getElementById('viewer3d-grid-btn')?.classList.toggle('active', V3D.gridOn);
}

function _init3DViewer() {
  const body   = document.getElementById('viewer3d-body');
  const canvas = document.getElementById('viewer3d-canvas');
  if (!body || !canvas || !window.THREE) return;
  const THREE = window.THREE;

  if (!V3D.renderer) {
    // ── Scene ───────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd4d4d4);
    V3D.scene = scene;

    // ── Camera (FOV 35°) ────────────────────────────
    const w = body.clientWidth || 800, h = body.clientHeight || 380;
    const cam = new THREE.PerspectiveCamera(35, w / h, 0.01, 20000);
    V3D.camera = cam;

    // ── Renderer ────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    V3D.renderer = renderer;

    // ── Floor grid: 5 m cells, 1000 m total (OFF by default) ──
    const grid = new THREE.GridHelper(1000, 200, 0x707070, 0x888888);
    grid.material.opacity = 0.55; grid.material.transparent = true;
    grid.visible = false; // OFF by default
    scene.add(grid);
    V3D.grid = grid;

    // ── Axis lines: +solid / -dashed ────────────────
    // Coordinate mapping (Three.js Y-up):
    //   Semantic X (red,  rear)  → Three.js  Z  (0,0,1)
    //   Semantic Y (green,left)  → Three.js  X  (1,0,0)
    //   Semantic Z (blue, top)   → Three.js  Y  (0,1,0)  ← up axis
    // Grid lies on Three.js XZ plane = semantic XY plane (floor at Z=0)
    const L = 9999;
    const addHalf = (from, to, color, dashed) => {
      const geo = new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(...from), new THREE.Vector3(...to)]
      );
      let mat;
      if (dashed) {
        mat = new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.35 });
      } else {
        mat = new THREE.LineBasicMaterial({ color });
      }
      const line = new THREE.Line(geo, mat);
      if (dashed) line.computeLineDistances();
      scene.add(line);
    };
    // X (red, length·rear) → Three.js +Z solid, -Z dashed
    addHalf([0,0,0], [0, 0,  L], 0xcc3333, false);
    addHalf([0,0,0], [0, 0, -L], 0xcc3333, true);
    // Y (green, width·left) → Three.js +X solid, -X dashed
    addHalf([0,0,0], [ L, 0, 0], 0x33aa33, false);
    addHalf([0,0,0], [-L, 0, 0], 0x33aa33, true);
    // Z (blue, height·top) → Three.js +Y solid (up), -Y dashed
    addHalf([0,0,0], [0,  L, 0], 0x3355cc, false);
    addHalf([0,0,0], [0, -L, 0], 0x3355cc, true);

    // ── Navigation state ────────────────────────────
    _nav3D.target = new THREE.Vector3(0, 0, 0);
    _nav3D.r = 15; _nav3D.phi = 1.0; _nav3D.theta = 0.8;
    _update3DCam();

    // ── Blender-style controls ──────────────────────
    _setup3DNav(canvas);

    // ── Resize observer ─────────────────────────────
    new ResizeObserver(() => {
      if (!V3D.renderer) return;
      const nw = body.clientWidth, nh = body.clientHeight || 1;
      V3D.renderer.setSize(nw, nh);
      V3D.camera.aspect = nw / nh;
      V3D.camera.updateProjectionMatrix();
    }).observe(body);
  }

  if (V3D._animId) cancelAnimationFrame(V3D._animId);
  _run3D();
}

function _run3D() {
  if (!V3D.open) return;
  V3D._animId = requestAnimationFrame(_run3D);
  V3D.renderer.render(V3D.scene, V3D.camera);
}

function _update3DCam() {
  const { r, phi, theta, target } = _nav3D;
  const cam = V3D.camera;
  cam.position.set(
    target.x + r * Math.sin(phi) * Math.sin(theta),
    target.y + r * Math.cos(phi),
    target.z + r * Math.sin(phi) * Math.cos(theta)
  );
  cam.lookAt(target);
}

function _setup3DNav(canvas) {
  const THREE = window.THREE;

  canvas.addEventListener('mousedown', e => {
    if (e.button === 1 || e.button === 2) {
      _nav3D.btn = e.button;
      _nav3D.lx = e.clientX; _nav3D.ly = e.clientY;
      e.preventDefault();
    }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  const onMM = e => {
    if (_nav3D.btn < 0) return;
    const dx = e.clientX - _nav3D.lx, dy = e.clientY - _nav3D.ly;
    _nav3D.lx = e.clientX; _nav3D.ly = e.clientY;
    if (_nav3D.btn === 1 && !e.shiftKey) {
      // Orbit
      _nav3D.theta -= dx * 0.008;
      _nav3D.phi   -= dy * 0.008;
      _nav3D.phi = Math.max(0.02, Math.min(Math.PI - 0.02, _nav3D.phi));
    } else {
      // Pan — Shift+middle or right-drag
      const panSpd = _nav3D.r * 0.0012;
      const fwd   = new THREE.Vector3(); V3D.camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize();
      _nav3D.target.addScaledVector(right, -dx * panSpd);
      _nav3D.target.addScaledVector(new THREE.Vector3(0,1,0), dy * panSpd);
    }
    _update3DCam();
  };
  const onMU = e => { if (e.button === _nav3D.btn) _nav3D.btn = -1; };
  document.addEventListener('mousemove', onMM);
  document.addEventListener('mouseup', onMU);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    _nav3D.r *= e.deltaY > 0 ? 1.12 : 0.89;
    _nav3D.r = Math.max(0.05, Math.min(5000, _nav3D.r));
    _update3DCam();
  }, { passive: false });
}

// ── Panel resize drag (top edge → drag up to expand) ─────────
(function () {
  let rszOn = false, startY = 0, startH = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const rszr  = document.getElementById('viewer3d-resizer');
    const panel = document.getElementById('viewer3d-panel');
    if (!rszr || !panel) return;
    rszr.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      rszOn = true; startY = e.clientY; startH = panel.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    let _rH = 0, _rRaf = false;
    document.addEventListener('mousemove', e => {
      if (!rszOn) return;
      const delta = startY - e.clientY;
      const viewerH = document.getElementById('viewer-area')?.offsetHeight || 600;
      _rH = Math.max(80, Math.min(viewerH, startH + delta));
      if (!_rRaf) { _rRaf = true; requestAnimationFrame(() => { panel.style.height = _rH + 'px'; _rRaf = false; }); }
    });
    document.addEventListener('mouseup', () => { rszOn = false; });
  });
})();

// ── AssetSpace Bounds Picker ──────────────────────────────────
// Plane selection: keyed by the 3 orthogonal planes of asset space
const _v3dAssetSel = { xy: null, xz: null, yz: null };

// Derive which asset-space plane a space lies in from its asset_axes mappings.
// For spaces with 3 mappings the first two entries are the frame (view) axes and
// the third is the view normal — so we use the first two to identify the plane.
function _v3dDetectPlane(sp) {
  const axes = sp.asset_axes || [];
  if (axes.length < 2) return null;
  const norm = a => (a || '').replace('inv_', '');
  // Use only the first two axis mappings (the plane-spanning axes of the 2D frame)
  const [a0, a1] = [norm(axes[0]), norm(axes[1])];
  const has = v => a0 === v || a1 === v;
  if (has('x') && has('y')) return 'xy';
  if (has('x') && has('z')) return 'xz';
  if (has('y') && has('z')) return 'yz';
  return null;
}

const _v3dPlaneStyle = {
  xy: { color: '#c08020', label: 'XY plane', short: 'XY' },
  xz: { color: '#2060aa', label: 'XZ plane', short: 'XZ' },
  yz: { color: '#1a9960', label: 'YZ plane', short: 'YZ' },
};

function open3DAssetPicker() {
  const picker = document.getElementById('v3d-asset-picker');
  if (!picker) return;
  _v3dAssetSel.xy = null; _v3dAssetSel.xz = null; _v3dAssetSel.yz = null;
  _v3dUpdateSelSummary();
  const searchEl = document.getElementById('v3d-asset-search');
  if (searchEl) searchEl.value = '';
  _v3dFilterSpaces('');
  picker.style.display = 'flex';
  searchEl?.focus();
}

function close3DAssetPicker() {
  const picker = document.getElementById('v3d-asset-picker');
  if (picker) picker.style.display = 'none';
}

function _v3dFilterSpaces(q) {
  const list = document.getElementById('v3d-asset-list');
  if (!list) return;
  q = (q || '').toLowerCase();
  // All spaces project-wide that have at least 2 asset axis mappings (enough to detect plane)
  const candidates = Object.values(S.spaces || {}).filter(sp =>
    (sp.asset_axes && sp.asset_axes.length >= 2) &&
    (!q || (sp.name || sp.id || '').toLowerCase().includes(q))
  );
  if (candidates.length === 0) {
    list.innerHTML = '<div style="font-size:9px;font-family:var(--mono);color:var(--text3);padding:10px 6px">No spaces with asset axis mappings found.</div>';
    return;
  }
  list.innerHTML = '';
  candidates.forEach(sp => {
    const plane = _v3dDetectPlane(sp);
    const selPlane = Object.entries(_v3dAssetSel).find(([, v]) => v === sp.id)?.[0];
    const row = document.createElement('div');
    row.className = 'v3d-space-row' + (selPlane ? ' sel-' + selPlane : '');
    if (plane) row.style.cursor = 'pointer';

    // Shortcode badge only (e.g. "XY") — no axis detail tags
    let badge = '';
    if (plane) {
      const { color, short } = _v3dPlaneStyle[plane];
      const active = selPlane === plane;
      badge = `<span class="v3d-plane-badge" style="${
        active
          ? `background:${color};color:#fff;border-color:${color}`
          : `color:${color};border-color:${color}`
      }">${short}</span>`;
    }

    row.innerHTML = `<span class="v3d-space-name" title="${sp.id}">${sp.name || sp.id}</span>${badge}`;
    if (plane) row.addEventListener('click', () => _v3dAutoAssign(sp.id));
    list.appendChild(row);
  });
}

// Toggle assignment of a space to its auto-detected plane slot
function _v3dAutoAssign(spId) {
  const sp = S.spaces[spId];
  if (!sp) return;
  const plane = _v3dDetectPlane(sp);
  if (!plane) { notify('Cannot determine plane from axis mappings', 2000); return; }
  _v3dAssetSel[plane] = (_v3dAssetSel[plane] === spId) ? null : spId;
  _v3dUpdateSelSummary();
  _v3dFilterSpaces(document.getElementById('v3d-asset-search')?.value || '');
}

function _v3dUpdateSelSummary() {
  const el = document.getElementById('v3d-asset-sel-summary');
  if (!el) return;
  const parts = Object.entries(_v3dAssetSel)
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const { color, label } = _v3dPlaneStyle[k];
      const name = S.spaces[v]?.name || v;
      return `<span style="color:${color}">${label}: ${name}</span>`;
    });
  el.innerHTML = parts.length
    ? 'Selected: ' + parts.join(' &nbsp;·&nbsp; ')
    : '<span style="color:var(--text3);font-family:var(--mono);font-size:9px">No planes selected yet</span>';
}

function build3DAssetFrame() {
  const { xy: xyId, xz: xzId, yz: yzId } = _v3dAssetSel;
  if (!xyId || !xzId || !yzId) { notify('Select one space for each plane (XY, XZ, YZ) first', 2500); return; }
  const THREE = window.THREE;
  if (!THREE || !V3D.scene) { notify('Open the 3D viewer first', 2000); return; }

  // Remove old frame
  if (V3D.assetFrame) { V3D.scene.remove(V3D.assetFrame); V3D.assetFrame = null; }

  // For each space, compute pixel extents along each 2D document direction (x=horiz, y=vert),
  // then use asset_src_axes to know which 2D direction each asset_axes entry corresponds to,
  // mapping pixel size onto the correct semantic 3D axis (x/y/z).
  const _norm = a => (a || '').replace('inv_', '');
  const docW = S.cur?.width  || 1000;
  const docH = S.cur?.height || 1000;

  const spAxisSizes = spId => {
    const sp = S.spaces[spId];
    if (!sp?.bbox) return {};
    const rb  = bboxRootNorm(sp.bbox, sp.parent_id);
    const pxW = Math.abs(rb.right  - rb.left) * docW;   // pixel width  of this space in 2D
    const pxH = Math.abs(rb.bottom - rb.top)  * docH;   // pixel height of this space in 2D
    const aAxes = sp.asset_axes     || [];
    const sAxes = sp.asset_src_axes || aAxes.map((_,i) => ['x','y','z'][i] || 'x');
    const result = {};
    aAxes.forEach((tgt, i) => {
      const tNorm = _norm(tgt);                          // semantic 3D axis: 'x','y','z'
      const src   = _norm(sAxes[i] || 'x');             // 2D doc axis: 'x'=horiz, 'y'=vert
      result[tNorm] = src === 'y' ? pxH : pxW;
    });
    return result;
  };

  // Collect one pixel-size per semantic axis (first space that defines it wins)
  const axisSize = { x: null, y: null, z: null };
  [xyId, xzId, yzId].forEach(spId => {
    const dims = spAxisSizes(spId);
    for (const [ax, sz] of Object.entries(dims)) {
      if (ax in axisSize && axisSize[ax] === null) axisSize[ax] = sz;
    }
  });

  // Scale factor: 1 px = 0.01 m  (so 1000 px → 10 m)
  const PX_TO_M = 0.01;
  const lenX = (axisSize.x || 1) * PX_TO_M;
  const lenY = (axisSize.y || 1) * PX_TO_M;
  const lenZ = (axisSize.z || 1) * PX_TO_M;

  // Coordinate mapping to Three.js (Y-up):
  //   Semantic X (rear)  → Three.js Z
  //   Semantic Y (left)  → Three.js X
  //   Semantic Z (up)    → Three.js Y
  // Half-open cube: 3 faces meeting at origin, extending into +semantic directions.
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xffaa22 });
  const addRect = corners => {
    const pts = [...corners, corners[0]].map(([tx, ty, tz]) => new THREE.Vector3(tx, ty, tz));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    group.add(new THREE.Line(geo, mat));
  };
  // XY face (semantic floor, Three.js Y=0): spans Three.js Z (←X) and Three.js X (←Y)
  addRect([[0,0,0],[0,0,lenX],[lenY,0,lenX],[lenY,0,0]]);
  // XZ face (left wall, Three.js X=0): spans Three.js Z (←X) and Three.js Y (←Z)
  addRect([[0,0,0],[0,0,lenX],[0,lenZ,lenX],[0,lenZ,0]]);
  // YZ face (rear wall, Three.js Z=0): spans Three.js X (←Y) and Three.js Y (←Z)
  addRect([[0,0,0],[lenY,0,0],[lenY,lenZ,0],[0,lenZ,0]]);

  V3D.scene.add(group);
  V3D.assetFrame = group;
  const spName = id => S.spaces[id]?.name || id;
  notify(`AssetSpace frame — X:${lenX.toFixed(1)} (${spName(xyId)}) · Y:${lenY.toFixed(1)} · Z:${lenZ.toFixed(1)}m (${spName(xzId)})`, 4000);
  close3DAssetPicker();
  // Camera: focus on semantic centre → Three.js (lenY/2, lenZ/2, lenX/2)
  _nav3D.target = new THREE.Vector3(lenY/2, lenZ/2, lenX/2);
  _nav3D.r = Math.max(lenX, lenY, lenZ) * 1.8;
  _update3DCam();
}

// ════════════════════════════════════════════════════════════════
// BP-IN-ASSET  — functions
// ════════════════════════════════════════════════════════════════

function openBPPicker(spAId) {
  _BP.spAId = spAId;
  const picker = document.getElementById('bp-picker');
  if (!picker) return;
  const searchEl = document.getElementById('bp-space-search');
  if (searchEl) searchEl.value = '';
  picker.style.display = 'flex';
  _bpFilterSpaces('');
  searchEl?.focus();
}

function closeBPPicker() {
  const picker = document.getElementById('bp-picker');
  if (picker) picker.style.display = 'none';
}

async function _bpFilterSpaces(q) {
  const list = document.getElementById('bp-space-list');
  if (!list) return;
  q = (q || '').toLowerCase();

  list.innerHTML = '<div style="color:var(--text3);font-size:9px;font-family:var(--mono);padding:8px 2px;">Loading\u2026</div>';

  // Collect candidates: all spaces with target_asset=true from every project
  const candidates = [];

  // Current open file
  if (S.cur) {
    for (const [sid, sp] of Object.entries(S.spaces)) {
      if (!sp.target_asset) continue;
      candidates.push({ sid, sp, projId: S.cur.id,
        fileName: S.cur.meta?.display_name || S.cur.original_name || S.cur.id,
        project: { ...S.cur, spaces: S.spaces } });
    }
  }

  // All other projects (fetched on demand, cached)
  for (const proj of (S.projects || [])) {
    if (proj.id === S.cur?.id) continue;
    let projData = _bpProjCache[proj.id];
    if (!projData) {
      try {
        const r = await fetch(`/api/project/${proj.id}`);
        projData = await r.json();
        _bpProjCache[proj.id] = projData;
      } catch(e) { continue; }
    }
    for (const [sid, sp] of Object.entries(projData.spaces || {})) {
      if (!sp.target_asset) continue;
      candidates.push({ sid, sp, projId: proj.id,
        fileName: projData.meta?.display_name || projData.original_name || proj.id,
        project: projData });
    }
  }

  // Filter by query
  const filtered = q ? candidates.filter(c => (c.sp.name || c.sid || '').toLowerCase().includes(q)) : candidates;

  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = '<div style="color:var(--text3);font-size:9px;font-family:var(--mono);padding:8px 2px;">No TargetAsset spaces found</div>';
    return;
  }

  filtered.forEach(({ sid, sp, projId, fileName }) => {
    const plane = _v3dDetectPlane(sp);
    const ps    = _v3dPlaneStyle[plane] || null;

    const row = document.createElement('div');
    row.className = 'bp-space-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'bp-space-name';
    nameEl.textContent = sp.name || sid;
    row.appendChild(nameEl);

    const fileTag = document.createElement('span');
    fileTag.className = 'bp-file-tag';
    fileTag.title     = fileName;
    fileTag.textContent = fileName;
    row.appendChild(fileTag);

    if (ps) {
      const badge = document.createElement('span');
      badge.className = 'bp-plane-badge';
      badge.textContent = ps.short;
      badge.style.cssText = `color:${ps.color};border-color:${ps.color};`;
      row.appendChild(badge);
    }

    row.addEventListener('click', () => _bpSelectSpaceX(sid, projId));
    list.appendChild(row);
  });
}

async function _bpSelectSpaceX(spXId, spXProjId) {
  closeBPPicker();

  // Get full project data (use live S.cur + S.spaces for current file)
  let projData;
  if (spXProjId === S.cur?.id) {
    projData = { ...S.cur, spaces: S.spaces };
  } else {
    projData = _bpProjCache[spXProjId];
    if (!projData) {
      try {
        const r = await fetch(`/api/project/${spXProjId}`);
        projData = await r.json();
        _bpProjCache[spXProjId] = projData;
      } catch(e) { notify('Failed to load reference project', 2000); return; }
    }
  }

  const spX = (projData.spaces || {})[spXId];
  if (!spX?.bbox) { notify('Reference space has no bounding box', 2000); return; }

  _BP.spXId     = spXId;
  _BP.spXProjId = spXProjId;
  _BP.spXProj   = projData;

  // Compute initial scale so Space_X's frame comfortably fills the viewer
  const cc     = document.getElementById('canvas-container');
  const ccRect = cc.getBoundingClientRect();
  const rb     = bboxRootNormExt(spX.bbox, spX.parent_id, projData.spaces || {});
  const imgW   = projData.width  || 1000;
  const imgH   = projData.height || 1000;
  const fW_img = (rb.right  - rb.left) * imgW;
  const fH_img = (rb.bottom - rb.top ) * imgH;
  _BP.scale = Math.min(
    (ccRect.width  * 0.65) / (fW_img || 1),
    (ccRect.height * 0.65) / (fH_img || 1),
    2
  );
  // Centre the frame in the viewport
  _BP.ox = (ccRect.width  / 2) - (rb.left + (rb.right  - rb.left) / 2) * imgW * _BP.scale;
  _BP.oy = (ccRect.height / 2) - (rb.top  + (rb.bottom - rb.top ) / 2) * imgH * _BP.scale;

  // Load image
  const img = document.getElementById('bp-ref-img');
  img.src = `/static/uploads/${projData.filename}`;

  // Show overlay elements
  ['bp-dimmer','bp-ref-frame','bp-hud','bp-overlay-hit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
  });

  _BP.active = true;
  _bpUpdateOverlay();

  // Wire up event handlers on the hit-test layer
  const hit = document.getElementById('bp-overlay-hit');
  const canvasContainerRef = document.getElementById('canvas-container'); // kept for reference, no capture listeners needed

  hit._bpWheel = e => {
    e.preventDefault();
    e.stopPropagation();
    const factor  = e.ctrlKey
      ? (e.deltaY < 0 ? 1.02 : 1 / 1.02)   // Ctrl = fine / slow zoom
      : (e.deltaY < 0 ? 1.12 : 1 / 1.12);  // normal zoom
    const rect    = hit.getBoundingClientRect();
    const mx      = e.clientX - rect.left;
    const my      = e.clientY - rect.top;
    _BP.ox = mx - (mx - _BP.ox) * factor;
    _BP.oy = my - (my - _BP.oy) * factor;
    _BP.scale *= factor;
    _bpUpdateOverlay();
  };
  hit._bpMouseDown = e => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 1) {         // middle button = pan OR Ctrl+zoom
      _BP.panning    = true;
      _BP.pmx        = e.clientX;
      _BP.pmy        = e.clientY;
      _BP.panCtrl    = e.ctrlKey;  // true = zoom mode
      hit.style.cursor = e.ctrlKey ? 'ns-resize' : 'grabbing';
    }
  };
  hit._bpMouseMove = e => {
    e.stopPropagation();
    if (!_BP.panning) return;
    const dx = e.clientX - _BP.pmx;
    const dy = e.clientY - _BP.pmy;
    _BP.pmx = e.clientX;
    _BP.pmy = e.clientY;
    if (_BP.panCtrl) {
      // Ctrl + middle-drag: vertical movement = zoom around centre of viewport
      const factor = 1 + (-dy) * 0.005;   // move up (neg dy) = zoom in
      if (factor <= 0) return;
      const rect = hit.getBoundingClientRect();
      const cx = rect.width  / 2;
      const cy = rect.height / 2;
      _BP.ox = cx - (cx - _BP.ox) * factor;
      _BP.oy = cy - (cy - _BP.oy) * factor;
      _BP.scale *= factor;
    } else {
      _BP.ox += dx;
      _BP.oy += dy;
    }
    _bpUpdateOverlay();
  };
  hit._bpMouseUp = e => {
    e.stopPropagation();
    if (e.button === 1) { _BP.panning = false; _BP.panCtrl = false; hit.style.cursor = 'crosshair'; }
  };

  hit.addEventListener('wheel',     hit._bpWheel,     { passive: false });
  hit.addEventListener('mousedown', hit._bpMouseDown);
  hit.addEventListener('mousemove', hit._bpMouseMove);
  hit.addEventListener('mouseup',   hit._bpMouseUp);
  document.addEventListener('keydown', _bpKeyHandler);
}

function _bpUpdateOverlay() {
  if (!_BP.active || !_BP.spXProj) return;
  const spX    = (_BP.spXProj.spaces || {})[_BP.spXId];
  if (!spX?.bbox) return;
  const rb   = bboxRootNormExt(spX.bbox, spX.parent_id, _BP.spXProj.spaces || {});
  const imgW = _BP.spXProj.width  || 1000;
  const imgH = _BP.spXProj.height || 1000;

  // Frame clip div: positioned at the frame's container coords
  const fLeft   = _BP.ox + rb.left   * imgW * _BP.scale;
  const fTop    = _BP.oy + rb.top    * imgH * _BP.scale;
  const fWidth  = (rb.right  - rb.left) * imgW * _BP.scale;
  const fHeight = (rb.bottom - rb.top ) * imgH * _BP.scale;

  const frame = document.getElementById('bp-ref-frame');
  frame.style.left   = fLeft   + 'px';
  frame.style.top    = fTop    + 'px';
  frame.style.width  = fWidth  + 'px';
  frame.style.height = fHeight + 'px';

  // Image inside clip: full root-doc image offset so the frame aligns
  const imgEl = document.getElementById('bp-ref-img');
  imgEl.style.left   = (_BP.ox - fLeft) + 'px';
  imgEl.style.top    = (_BP.oy - fTop)  + 'px';
  imgEl.style.width  = (imgW * _BP.scale) + 'px';
  imgEl.style.height = (imgH * _BP.scale) + 'px';
}

function _bpKeyHandler(e) {
  if (!_BP.active) return;
  if (e.key === 'Enter') { e.preventDefault(); _bpConfirm(); }
  if (e.key === 'Escape') { closeBPOverlay(); }
}

function _bpConfirm() {
  if (!_BP.active || !_BP.spAId || !_BP.spXId) return;
  const sp = S.spaces[_BP.spAId];
  if (!sp?.bbox) { notify('Space has no bounding box', 2000); closeBPOverlay(); return; }

  const spXProj = _BP.spXProj;
  const spX     = (spXProj.spaces || {})[_BP.spXId];
  if (!spX?.bbox) { notify('Reference space has no bounding box', 2000); closeBPOverlay(); return; }

  // Space_A corners in canvas-container pixel coords (panX/Y is the doc's top-left offset)
  const rbA = bboxRootNorm(sp.bbox, sp.parent_id);
  const docW = S.cur?.width || 1000, docH = S.cur?.height || 1000;
  const aL = S.panX + rbA.left   * docW * S.zoom;
  const aT = S.panY + rbA.top    * docH * S.zoom;
  const aR = S.panX + rbA.right  * docW * S.zoom;
  const aB = S.panY + rbA.bottom * docH * S.zoom;

  // Space_X frame corners in canvas-container pixel coords (from overlay state)
  const rbX  = bboxRootNormExt(spX.bbox, spX.parent_id, spXProj.spaces || {});
  const imgW = spXProj.width || 1000, imgH = spXProj.height || 1000;
  const xL = _BP.ox + rbX.left   * imgW * _BP.scale;
  const xT = _BP.oy + rbX.top    * imgH * _BP.scale;
  const xR = _BP.ox + rbX.right  * imgW * _BP.scale;
  const xB = _BP.oy + rbX.bottom * imgH * _BP.scale;
  const fW = xR - xL, fH = xB - xT;

  if (fW < 0.5 || fH < 0.5) { notify('Reference frame is too small — zoom in and try again', 2500); return; }

  sp.asset_bp = {
    ref_space_id: _BP.spXId,
    ref_proj_id:  _BP.spXProjId,
    left:   (aL - xL) / fW,
    top:    (aT - xT) / fH,
    right:  (aR - xL) / fW,
    bottom: (aB - xT) / fH,
  };
  S.dirty = true;
  renderSpacesPanel();
  autoSave();
  const ab = sp.asset_bp;
  notify(`BPs in Asset set \u2014 L:${ab.left.toFixed(3)} T:${ab.top.toFixed(3)} R:${ab.right.toFixed(3)} B:${ab.bottom.toFixed(3)}`, 4500);
  closeBPOverlay();
}

function closeBPOverlay() {
  _BP.active   = false;
  _BP.panning  = false;
  _BP.panCtrl  = false;
  ['bp-dimmer','bp-ref-frame','bp-hud'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const hit = document.getElementById('bp-overlay-hit');
  if (hit) {
    hit.style.display = 'none';
    if (hit._bpWheel)     { hit.removeEventListener('wheel',     hit._bpWheel,     { passive: false }); hit._bpWheel = null; }
    if (hit._bpMouseDown) { hit.removeEventListener('mousedown', hit._bpMouseDown); hit._bpMouseDown = null; }
    if (hit._bpMouseMove) { hit.removeEventListener('mousemove', hit._bpMouseMove); hit._bpMouseMove = null; }
    if (hit._bpMouseUp)   { hit.removeEventListener('mouseup',   hit._bpMouseUp);   hit._bpMouseUp   = null; }
  }
  document.removeEventListener('keydown', _bpKeyHandler);
}

// Expose to window for inline onclick handlers
document.addEventListener('DOMContentLoaded', () => {
  Object.assign(window, {
    toggle3DPanel, open3DPanel, close3DPanel,
    toggle3DGrid, open3DAssetPicker, close3DAssetPicker,
    _v3dFilterSpaces, _v3dAutoAssign, build3DAssetFrame,
    openBPPicker, closeBPPicker, _bpFilterSpaces, closeBPOverlay,
  });
});
