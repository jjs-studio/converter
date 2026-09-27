const $ = (id) => document.getElementById(id);

const state = {
  fileName: '',
  tree: null,
  nodeMap: {},
  browseId: 'root',
  selected: null,
  search: '',
  duration: 0,
  position: '0, 0, 0',
  skillName: 'converted',
  skillKey: 1,
  recolor: false,
  colors: { main: '#ff3355', accent: '#ffcc66', other: '#ffffff' },
  output: '',
  compact: ''
};

function toast(msg) {
  $('statusText').textContent = msg;
}

function sanitizeFilename(name) {
  return String(name || 'file').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
}

function collectNodeParticles(node) {
  const out = [];
  (node.particles || []).forEach((p) => out.push(p));
  (node.children || []).forEach((c) => collectNodeParticles(c).forEach((p) => out.push(p)));
  return out;
}

function indexTree(node, map) {
  map[node.id] = node;
  (node.children || []).forEach((c) => indexTree(c, map));
}

function isFolder(n) {
  return n && (n.type === 'ParticleFolder' || /folder/i.test(n.className || ''));
}

function hostCount(n) {
  if (!n) return 0;
  if (Number(n.count) > 0) return Number(n.count);
  return collectNodeParticles(n).length;
}

function parseRgbList(str) {
  const out = [];
  const re = /(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
  let m;
  const s = String(str || '');
  while ((m = re.exec(s))) out.push({ r: +m[1], g: +m[2], b: +m[3] });
  return out;
}

function hexToRgb(hex) {
  const s = String(hex || '').trim().replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  }
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) };
  }
  const m = String(hex).match(/(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return { r: 255, g: 255, b: 255 };
}

function rgbKey(c) { return `${c.r},${c.g},${c.b}`; }
function rgbDist(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function detectPalette(particles) {
  const counts = {};
  particles.forEach((p) => parseRgbList(p.COLOR).forEach((c) => {
    const k = rgbKey(c);
    counts[k] = counts[k] || { c, n: 0 };
    counts[k].n++;
  }));
  const items = Object.values(counts).sort((a, b) => b.n - a.n);
  if (!items.length) return { main: { r: 255, g: 255, b: 255 }, accent: { r: 255, g: 255, b: 255 }, other: { r: 0, g: 0, b: 0 } };
  const main = items[0].c;
  let accent = items[1] ? items[1].c : main;
  let best = -1;
  items.forEach((it, i) => {
    if (!i) return;
    const score = Math.sqrt(rgbDist(it.c, main));
    if (score > best) { best = score; accent = it.c; }
  });
  let other = items[Math.min(2, items.length - 1)].c;
  return { main, accent, other };
}

function remapColorString(str, detected, next) {
  const parts = parseRgbList(str);
  if (!parts.length) return str;
  return parts.map((c) => {
    const dMain = rgbDist(c, detected.main);
    const dAcc = rgbDist(c, detected.accent);
    const dOth = rgbDist(c, detected.other);
    const role = (dMain <= dAcc && dMain <= dOth) ? 'main' : (dAcc <= dOth ? 'accent' : 'other');
    return rgbKey(next[role]);
  }).join(' ');
}

function lineFromParticle(p, i, over) {
  return {
    SIZE: String(p.SIZE || '0.0000'),
    SPEED: String(p.SPEED || '0.00, 0.00'),
    NAME: String(p.NAME || p.Name || ('PARTICLE_' + (i + 1))).slice(0, 80),
    'PART SIZE': '0, 0, 0',
    'LIGHT EMISSION': Number(p['LIGHT EMISSION']) || 0,
    'EMIT COUNT': Number(p['EMIT COUNT']) || 0,
    TEXTURE: Number(p.TEXTURE) || 0,
    DURATION: Number(over.duration) || 0,
    BRIGHTNESS: p.BRIGHTNESS != null ? Number(p.BRIGHTNESS) : 1,
    LIFETIME: String(p.LIFETIME || '0.00, 0.00'),
    ZOFFSET: Number(p.ZOFFSET) || 0,
    COLOR: over.recolor
      ? remapColorString(p.COLOR || '255,255,255 255,255,255', over.detected, over.next)
      : String(p.COLOR || '255,255,255 255,255,255'),
    ACCELERATION: String(p.ACCELERATION || '0, 0, 0'),
    POSITION: String(over.position || '0, 0, 0'),
    'RUN ON SERVER': p['RUN ON SERVER'] !== false,
    'LIGHT INFLUENCE': Number(p['LIGHT INFLUENCE']) || 0,
    'FLIPBOOK FRAMERATE': String(p['FLIPBOOK FRAMERATE'] || '1.00, 1.00'),
    'FLIPBOOK SIZE': String(p['FLIPBOOK SIZE'] != null ? p['FLIPBOOK SIZE'] : '1, 1'),
    K_NAME: 'PARTICLE',
    TRANSPARENCY: String(p.TRANSPARENCY || '0.00,0.00'),
    ROTATION: String(p.ROTATION || '0.00, 0.00'),
    RATE: p.RATE != null ? Number(p.RATE) : 20,
    'ROT SPEED': String(p['ROT SPEED'] || '0.00, 0.00'),
    'ORIENTATION TYPE': String(p['ORIENTATION TYPE'] || 'FacingCamera'),
    'EMISSION DIRECTION': String(p['EMISSION DIRECTION'] || 'Top'),
    'LOCK TO PART': p['LOCK TO PART'] !== false,
    'SPREAD ANGLE': String(p['SPREAD ANGLE'] || '0.00, 0.00, 0.00'),
    'FLIPBOOK MODE': String(p['FLIPBOOK MODE'] || 'OneShot'),
    DRAG: Number(p.DRAG) || 0,
    SQUASH: String(p.SQUASH || '0.00,0.00')
  };
}

function buildSkillJson(lines, meta) {
  const skill = {
    ADD: false,
    NAME: String(meta.name || 'converted').slice(0, 80),
    COOLDOWN: 0,
    KEY: Number(meta.key) || 1,
    K_NAME: 'SKILL',
    DATA: JSON.stringify({ Line: lines, Prop: [], Req: [] }),
    'TOOL TIP': ''
  };
  return JSON.stringify([skill]);
}

function visibleChildren(node) {
  const q = String(state.search || '').trim().toLowerCase();
  const kids = (node && node.children) || [];
  if (!q) return kids;
  const out = [];
  const seen = new Set();
  function walk(n) {
    if (!n || seen.has(n.id)) return;
    const hay = [n.name, n.className, n.path, n.type].join(' ').toLowerCase();
    const textures = collectNodeParticles(n).map((p) => String(p.TEXTURE || '')).join(' ');
    if (hay.includes(q) || textures.includes(q)) {
      seen.add(n.id);
      out.push(n);
      return;
    }
    (n.children || []).forEach(walk);
  }
  kids.forEach(walk);
  return out;
}

function renderTree() {
  const root = state.tree;
  const box = $('tree');
  box.innerHTML = '';
  if (!root) {
    box.innerHTML = '<div class="hint" style="padding:8px">Open an .rbxl / .rbxm / .rbxlx to see the explorer.</div>';
    return;
  }
  const node = state.nodeMap[state.browseId] || root;
  const crumbs = [];
  let walk = node;
  while (walk && walk.id !== root.id) {
    crumbs.unshift(walk);
    walk = state.nodeMap[walk.parentId];
  }
  $('explorerPath').textContent = crumbs.length ? crumbs.map((c) => c.name).join(' / ') : 'Workspace';
  if (node.id !== root.id) {
    const back = document.createElement('div');
    back.className = 'row';
    back.innerHTML = '<span class="dot folder"></span><span class="name">..</span><span class="meta">up</span>';
    back.onclick = () => { state.browseId = node.parentId || root.id; renderTree(); };
    box.appendChild(back);
  }
  visibleChildren(node).forEach((child, i) => {
    const row = document.createElement('div');
    row.className = 'row' + (state.selected && state.selected.id === child.id ? ' on' : '');
    row.style.animationDelay = (i * 18) + 'ms';
    const count = hostCount(child);
    const folder = isFolder(child) && (child.children || []).length;
    row.innerHTML = `<span class="dot ${folder ? 'folder' : ''}"></span><span class="name">${escapeHtml(child.name || child.className)}</span><span class="meta">${folder ? 'folder' : (child.className || 'Part')} · ${count}</span>`;
    row.onclick = () => {
      if (folder) { state.browseId = child.id; state.selected = child; }
      else state.selected = child;
      renderTree();
      renderHud();
    };
    box.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHud() {
  const n = state.selected;
  const count = n ? hostCount(n) : (state.tree ? collectNodeParticles(state.tree).length : 0);
  $('hudTitle').textContent = n ? n.name : (state.fileName || 'No place loaded');
  $('hudMeta').innerHTML = n
    ? `<b>${count}</b> emitters · ${escapeHtml(n.className || n.type || '')}`
    : 'Drop a Roblox place or model to convert ParticleEmitters into JJS import codes.';
  $('emptyState').style.display = state.tree ? 'none' : 'grid';
  $('selCount').textContent = count + ' emitters';
}

function currentParticles() {
  const n = state.selected || state.tree;
  return n ? collectNodeParticles(n) : [];
}

function exportCurrent() {
  const particles = currentParticles();
  if (!particles.length) {
    toast('Nothing selected to export.');
    return;
  }
  const detected = detectPalette(particles);
  const next = {
    main: hexToRgb(state.colors.main),
    accent: hexToRgb(state.colors.accent),
    other: hexToRgb(state.colors.other)
  };
  const lines = particles.map((p, i) => lineFromParticle(p, i, {
    duration: state.duration,
    position: state.position,
    recolor: state.recolor,
    detected,
    next
  }));
  const json = buildSkillJson(lines, { name: state.skillName || sanitizeFilename(state.fileName), key: state.skillKey });
  state.output = json;
  $('output').textContent = json;
  toast('Exported ' + lines.length + ' particles from ' + (state.selected && state.selected.name || 'root') + '.');
  compressMaybe(json);
}

async function compressMaybe(json) {
  $('compactOut').textContent = 'Compressing…';
  try {
    if (window.ZstdCodec) {
      await new Promise((resolve) => {
        window.ZstdCodec.run((zstd) => {
          try {
            const simple = new zstd.Simple();
            const bytes = new TextEncoder().encode(json);
            const out = simple.compress(bytes, 22) || simple.compress(bytes);
            let bin = '';
            for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
            state.compact = btoa(bin);
            $('compactOut').textContent = state.compact;
          } catch (e) {
            $('compactOut').textContent = 'zstd failed — use JSON.';
          }
          resolve();
        });
      });
      return;
    }
  } catch (e) {}
  $('compactOut').textContent = 'zstd-codec not loaded — copy the JSON instead.';
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied.');
  } catch (e) {
    toast('Copy failed — select the box and copy manually.');
  }
}

async function loadFile(file) {
  toast('Reading ' + file.name + '…');
  $('hudTitle').textContent = file.name;
  $('hudMeta').textContent = 'Reading bytes…';
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!window.JJSParser || typeof window.JJSParser.parsePlace !== 'function') {
    toast('Parser failed to load.');
    return;
  }
  toast('Parsing ' + file.name + ' (' + (buf.length / 1024).toFixed(0) + ' KB)…');
  await new Promise((r) => setTimeout(r, 30));
  let parsed;
  try {
    const wrapped = window.JJSParser.Buffer.from(buf);
    parsed = window.JJSParser.parsePlace(wrapped, file.name);
  } catch (e) {
    console.error(e);
    toast('Parse failed: ' + (e && e.message ? e.message : e));
    return;
  }
  state.fileName = file.name;
  state.tree = parsed.tree || { id: 'root', name: 'Root', type: 'ParticleFolder', children: parsed.hosts || [], particles: parsed.particles || [] };
  state.nodeMap = {};
  indexTree(state.tree, state.nodeMap);
  state.browseId = state.tree.id || 'root';
  state.selected = (state.tree.children && state.tree.children[0]) || state.tree;
  state.skillName = sanitizeFilename(file.name).replace(/\.[^.]+$/, '') || 'converted';
  $('skillName').value = state.skillName;
  const total = collectNodeParticles(state.tree).length;
  toast('Loaded ' + file.name + ' · ' + total + ' emitters');
  renderTree();
  renderHud();
}

function bind() {
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
  });
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  $('search').addEventListener('input', (e) => { state.search = e.target.value; renderTree(); });
  $('skillName').addEventListener('input', (e) => { state.skillName = e.target.value; });
  $('skillKey').addEventListener('input', (e) => { state.skillKey = Number(e.target.value) || 1; });
  $('duration').addEventListener('input', (e) => { state.duration = Number(e.target.value) || 0; });
  $('position').addEventListener('input', (e) => { state.position = e.target.value || '0, 0, 0'; });
  $('recolor').addEventListener('change', (e) => { state.recolor = e.target.checked; $('recolorBox').style.opacity = state.recolor ? '1' : '.45'; });
  ['main', 'accent', 'other'].forEach((k) => {
    $(k + 'Color').addEventListener('input', (e) => {
      state.colors[k] = e.target.value;
      $(k + 'Hex').value = e.target.value;
    });
    $(k + 'Hex').addEventListener('input', (e) => { state.colors[k] = e.target.value; });
  });
  $('exportBtn').addEventListener('click', exportCurrent);
  $('copyJson').addEventListener('click', () => copyText(state.output || $('output').textContent));
  $('copyCompact').addEventListener('click', () => copyText(state.compact || $('compactOut').textContent));
  $('dlJson').addEventListener('click', () => download((state.skillName || 'skill') + '.particle.json', state.output || $('output').textContent));
  $('dlCompact').addEventListener('click', () => download((state.skillName || 'skill') + '.particle.txt', state.compact || $('compactOut').textContent));
}

bind();
renderTree();
renderHud();
toast('Ready. Open a place file.');
