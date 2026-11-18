'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const PALETTE = ['#ff7b7b', '#ffb454', '#e8c53a', '#3fbf8f', '#5b8def', '#a77bf3', '#555555'];
const COLORS = [...PALETTE, '#ffffff', '#222222'];
const GX = 70, GAP = 14;

// linha de escolha de cor: paleta + cor livre + voltar ao padrão
function ColorRow({ label, value, onPick, onReset }) {
  return (
    <div className="crow">
      <span className="clbl">{label}</span>
      {COLORS.map(c => <button key={c} className={`dot${value === c ? ' cur' : ''}`} style={{ background: c }} onClick={() => onPick(c)} />)}
      <input type="color" title="Cor personalizada" defaultValue={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#888888'}
        ref={el => { if (el) { el._cb = onPick; if (!el._on) { el._on = 1; el.addEventListener('change', ev => el._cb(ev.target.value)); } } }} />
      <button className="rst" title="Voltar ao padrão" onClick={onReset}>↺</button>
    </div>
  );
}
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- helpers puros ---------- */
const kidsOf = (nodes, id) => nodes.filter(n => n.parent === id);
function descendants(nodes, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true; }
  }
  return out;
}
function visibleSet(nodes) {
  const root = nodes.find(n => !n.parent);
  const vis = new Set();
  const walk = id => {
    vis.add(id);
    const n = nodes.find(m => m.id === id);
    if (n && !n.collapsed) kidsOf(nodes, id).forEach(c => walk(c.id));
  };
  if (root) walk(root.id);
  return vis;
}
function effColor(nodes, n) {
  let cur = n;
  while (cur) { if (cur.color) return cur.color; const pid = cur.parent; cur = nodes.find(m => m.id === pid); }
  return '#ff7b7b';
}
function layoutAll(nodes, sizes) {
  const root = nodes.find(n => !n.parent);
  if (!root) return nodes;
  const W = id => sizes[id]?.w || 100, H = id => sizes[id]?.h || 30;
  const memo = {};
  const sub = id => {
    if (memo[id] != null) return memo[id];
    const n = nodes.find(m => m.id === id);
    const ks = n.collapsed ? [] : kidsOf(nodes, id);
    const tot = ks.reduce((s, c) => s + sub(c.id), 0) + GAP * Math.max(0, ks.length - 1);
    return (memo[id] = Math.max(H(id), tot));
  };
  const pos = new Map();
  const place = (list, edgeX, cy, dir) => {
    const total = list.reduce((s, c) => s + sub(c.id), 0) + GAP * Math.max(0, list.length - 1);
    let y = cy - total / 2;
    for (const c of list) {
      const sh = sub(c.id), ccy = y + sh / 2;
      const x = dir > 0 ? edgeX + GX : edgeX - GX - W(c.id);
      pos.set(c.id, { x, y: ccy - H(c.id) / 2 });
      if (!c.collapsed) place(kidsOf(nodes, c.id), dir > 0 ? x + W(c.id) : x, ccy, dir);
      y += sh + GAP;
    }
  };
  const rx = root.x ?? 0, ry = root.y ?? 0, cy = ry + H(root.id) / 2;
  pos.set(root.id, { x: rx, y: ry });
  const top = root.collapsed ? [] : kidsOf(nodes, root.id);
  const cut = Math.ceil(top.length / 2);
  place(top.slice(0, cut), rx + W(root.id), cy, 1);
  place(top.slice(cut), rx, cy, -1);
  return nodes.map(n => (pos.has(n.id) ? { ...n, ...pos.get(n.id) } : n));
}

function edgeGeom(nodes, sizes, vis) {
  const out = [];
  for (const n of nodes) {
    if (!n.parent || !vis.has(n.id) || n.x == null) continue;
    const p = nodes.find(m => m.id === n.parent), a = sizes[n.parent], b = sizes[n.id];
    if (!p || !a || !b || p.x == null) continue;
    const right = n.x + b.w / 2 >= p.x + a.w / 2;
    const x1 = right ? p.x + a.w : p.x, y1 = p.y + a.h / 2;
    const x2 = right ? n.x : n.x + b.w, y2 = n.y + b.h / 2, mx = (x1 + x2) / 2;
    out.push({ id: n.id, d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, c: n.lc || effColor(nodes, n), x1, y1, x2, y2, mx, my: (y1 + y2) / 2 });
  }
  return out;
}
// a curva toca o retângulo? (amostragem da bézier)
function edgeHitsRect(e, rx0, ry0, rx1, ry1) {
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    const x = u * u * u * e.x1 + 3 * u * u * t * e.mx + 3 * u * t * t * e.mx + t * t * t * e.x2;
    const y = u * u * u * e.y1 + 3 * u * u * t * e.y1 + 3 * u * t * t * e.y2 + t * t * t * e.y2;
    if (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) return true;
  }
  return false;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

/* ---------- componente ---------- */
export default function MindMap() {
  const [projects, setProjects] = useState([]);
  const [pid, setPid] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [view, setView] = useState({ x: 0, y: 0, s: 1 });
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sizes, setSizes] = useState({});
  const [status, setStatus] = useState('');
  const [palOpen, setPalOpen] = useState(false);
  const [dropT, setDropT] = useState(null);
  const [full, setFull] = useState(false);
  const [guides, setGuides] = useState(true);
  const [tool, setTool] = useState('pan');      // 'pan' = mover a tela · 'select' = seleção em área
  const [msel, setMsel] = useState([]);           // seleção múltipla (2+ blocos)
  const [marq, setMarq] = useState(null);
  const [selEdges, setSelEdges] = useState([]);   // linhas selecionadas (ids dos filhos)
  const selEdgesRef = useRef([]); selEdgesRef.current = selEdges;
  const [panel, setPanel] = useState(false);       // painel de funcionalidades (direita), fechado por padrão
  const [features, setFeatures] = useState([]);   // checklist de funcionalidades do Miro
  const [level, setLevel] = useState('all');        // filtro "Nível de importância"
  const [ctx, setCtx] = useState(null);           // menu de clique direito {x,y}
  const toolRef = useRef('pan'); toolRef.current = tool;
  const mselRef = useRef([]); mselRef.current = msel;
  const selRef = useRef(null); selRef.current = sel;
  const gH = useRef(null), gV = useRef(null), gL = useRef(null);
  const [dlg, setDlg] = useState(null);
  const [dlgText, setDlgText] = useState('');
  const [dlgMsg, setDlgMsg] = useState('');
  const [, bump] = useState(0);

  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const viewRef = useRef(view); viewRef.current = view;
  const pidRef = useRef(pid);
  const sizesRef = useRef({});
  const undo = useRef([]); const redo = useRef([]);
  const pendingLayout = useRef(false);
  const pendingFit = useRef(false);
  const saveTimer = useRef(null);
  const stage = useRef(null);
  const nodeEls = useRef({});
  const editRef = useRef(null);
  const editingRef = useRef(null); editingRef.current = editing;
  const actions = useRef({});

  /* ----- persistência: CRUD por ação (fila serial, na ordem em que ocorreram) ----- */
  const syncedRef = useRef([]);
  const queue = useRef(Promise.resolve());
  const inflight = useRef(0);
  const FIELDS = ['parent', 'text', 'x', 'y', 'color', 'size', 'bold', 'collapsed', 'w', 'bg', 'fg', 'lc'];

  const enqueue = useCallback((method, url, body) => {
    inflight.current++; setStatus('Salvando…');
    queue.current = queue.current.then(async () => {
      try {
        const r = await fetch(url, { method, headers: jsonHeaders, keepalive: true, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw new Error(r.status);
        if (--inflight.current === 0) setStatus('Salvo ✓');
      } catch { inflight.current--; setStatus('Erro ao salvar'); }
    });
  }, []);

  // compara o último estado sincronizado com o atual e dispara create / update / delete
  const sync = useCallback(() => {
    const id = pidRef.current; if (!id) return;
    const prev = syncedRef.current, cur = nodesRef.current;
    if (prev === cur) return;
    const pm = new Map(prev.map(n => [n.id, n])), cm = new Map(cur.map(n => [n.id, n]));
    const base = `/api/projects/${id}/nodes`;
    // CREATE (pais antes dos filhos, pois o array já vem nessa ordem)
    cur.forEach((n, i) => { if (!pm.has(n.id)) enqueue('POST', base, { node: n, after: i > 0 ? cur[i - 1].id : null }); });
    // UPDATE (em lote)
    const patches = [];
    for (const n of cur) {
      const o = pm.get(n.id); if (!o) continue;
      const d = {}; for (const f of FIELDS) if (o[f] !== n[f]) d[f] = n[f];
      if (Object.keys(d).length) patches.push({ id: n.id, ...d });
    }
    if (patches.length) enqueue('PATCH', base, { patches });
    // DELETE (só a raiz de cada ramo removido; o servidor apaga os descendentes)
    for (const o of prev) if (!cm.has(o.id) && (!o.parent || cm.has(o.parent))) enqueue('DELETE', `${base}/${o.id}`);
    syncedRef.current = cur;
  }, [enqueue]);

  // pan/zoom: só a visão é salva (com debounce)
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const id = pidRef.current; if (!id) return;
      enqueue('PATCH', `/api/projects/${id}`, { view: viewRef.current });
    }, 500);
  }, [enqueue]);
  const flush = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current); saveTimer.current = null;
    const id = pidRef.current; if (id) enqueue('PATCH', `/api/projects/${id}`, { view: viewRef.current });
  }, [enqueue]);

  /* ----- mutações ----- */
  const mutate = useCallback(fn => {
    undo.current.push(nodesRef.current); if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    const next = fn(nodesRef.current);
    nodesRef.current = next; setNodes(next);
    if (!pendingLayout.current) sync();
    bump(v => v + 1);
  }, [sync]);

  const patch = (id, p, o) => mutate(ns => ns.map(n => (n.id === id ? { ...n, ...p } : n)), o);

  /* ----- carregar projetos ----- */
  const loadProject = useCallback(async id => {
    if (pidRef.current && pidRef.current !== id) { sync(); flush(); }
    const d = await (await fetch(`/api/projects/${id}`)).json();
    undo.current = []; redo.current = [];
    pidRef.current = id; setPid(id);
    sizesRef.current = {}; setSizes({});
    setSel(null); setEditing(null); setStatus('');
    nodesRef.current = d.nodes; syncedRef.current = d.nodes; setNodes(d.nodes);
    pendingLayout.current = d.nodes.some(n => n.x == null);
    if (d.view) { viewRef.current = d.view; setView(d.view); pendingFit.current = false; }
    else pendingFit.current = true;
    try { localStorage.setItem('mm:pid', id); } catch {}
  }, [flush, sync]);

  const refreshProjects = useCallback(async () => {
    const list = await (await fetch('/api/projects')).json();
    setProjects(list); return list;
  }, []);

  useEffect(() => {
    (async () => {
      const list = await refreshProjects();
      let id = list[0]?.id;
      try { setGuides(localStorage.getItem('mm:guides') !== '0'); } catch {}
      try { const s = Number(localStorage.getItem('mm:pid')); if (list.some(p => p.id === s)) id = s; } catch {}
      if (id) loadProject(id);
    })();
    // ao recarregar/fechar: confirma texto em edição e envia um snapshot completo (independe da fila)
    const onHide = () => {
      const id = pidRef.current; if (!id) return;
      const ed = editingRef.current;
      if (ed && editRef.current) actions.current.commitEdit(ed, editRef.current.textContent);
      sync(); flush();
      if (inflight.current > 0 || ed) {
        fetch(`/api/projects/${id}/nodes`, { method: 'PUT', headers: jsonHeaders, keepalive: true,
          body: JSON.stringify({ nodes: nodesRef.current, view: viewRef.current }) });
      }
    };
    const onVis = () => { if (document.visibilityState === 'hidden') onHide(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onVis); };
  }, [refreshProjects, loadProject, flush, sync]);

  /* ----- medir nós, layout e fit ----- */
  function fit() {
    const ns = nodesRef.current, vis = visibleSet(ns), sz = sizesRef.current;
    const box = stage.current?.getBoundingClientRect(); if (!box) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) if (vis.has(n.id) && sz[n.id] && n.x != null) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + sz[n.id].w); y1 = Math.max(y1, n.y + sz[n.id].h);
    }
    if (x0 === Infinity) return;
    const pad = 120;
    const s = Math.min(1.2, Math.max(0.2, Math.min((box.width - pad * 2) / (x1 - x0 || 1), (box.height - pad * 2) / (y1 - y0 || 1))));
    const v = { s, x: box.width / 2 - ((x0 + x1) / 2) * s, y: box.height / 2 - ((y0 + y1) / 2) * s };
    viewRef.current = v; setView(v); scheduleSave();
  }

  useLayoutEffect(() => {
    const vis = visibleSet(nodesRef.current);
    const next = {}; let changed = false, all = true;
    for (const id of vis) {
      const el = nodeEls.current[id];
      if (!el) { all = false; continue; }
      const w = el.offsetWidth, h = el.offsetHeight;
      next[id] = { w, h };
      const o = sizesRef.current[id];
      if (!o || o.w !== w || o.h !== h) changed = true;
    }
    if (changed) { sizesRef.current = { ...sizesRef.current, ...next }; setSizes(sizesRef.current); }
    if (!all || changed) return;
    if (pendingLayout.current) {
      pendingLayout.current = false;
      const laid = layoutAll(nodesRef.current, sizesRef.current);
      nodesRef.current = laid; setNodes(laid); sync();
      return;
    }
    if (pendingFit.current) { pendingFit.current = false; fit(); }
  });

  /* ----- zoom (roda) ----- */
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const onWheel = e => {
      if (e.target.closest?.('.side, .rpanel')) return;   // rolagem dos painéis não dá zoom no mapa
      e.preventDefault();
      const v = viewRef.current, r = el.getBoundingClientRect();
      const s = Math.min(3, Math.max(0.15, v.s * Math.exp(-e.deltaY * 0.0015)));
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const nv = { s, x: mx - ((mx - v.x) / v.s) * s, y: my - ((my - v.y) / v.s) * s };
      viewRef.current = nv; setView(nv); scheduleSave();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scheduleSave]);

  const zoomBy = f => {
    const r = stage.current.getBoundingClientRect(), v = viewRef.current;
    const s = Math.min(3, Math.max(0.15, v.s * f)), mx = r.width / 2, my = r.height / 2;
    const nv = { s, x: mx - ((mx - v.x) / v.s) * s, y: my - ((my - v.y) / v.s) * s };
    viewRef.current = nv; setView(nv); scheduleSave();
  };

  /* ----- pan ----- */
  const onStageDown = e => {
    if (e.button !== 0 || e.target.closest('.node, .toolbar, .ui')) return;
    setCtx(null); setSelEdges([]);
    if (toolRef.current === 'select' || e.shiftKey) return startMarquee(e);
    setSel(null); setMsel([]); setEditing(null); setPalOpen(false);
    const sx = e.clientX, sy = e.clientY, v0 = viewRef.current;
    const move = ev => {
      const nv = { ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy };
      viewRef.current = nv; setView(nv);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); scheduleSave(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  /* ----- ferramenta de seleção: retângulo que seleciona todos os blocos tocados ----- */
  const applySel = ids => {
    if (ids.length > 1) { setMsel(ids); setSel(null); }
    else { setMsel([]); setSel(ids[0] || null); }
  };
  const startMarquee = e => {
    const r = stage.current.getBoundingClientRect();
    const base = e.shiftKey ? (mselRef.current.length ? mselRef.current : (selRef.current ? [selRef.current] : [])) : [];
    setEditing(null); setPalOpen(false);
    const baseE = e.shiftKey ? selEdgesRef.current : [];
    if (!e.shiftKey) { setSel(null); setMsel([]); setSelEdges([]); }
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    const move = ev => {
      const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
      const bx = Math.min(x0, x1), by = Math.min(y0, y1), bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0);
      setMarq({ x: bx, y: by, w: bw, h: bh });
      const v = viewRef.current, wx0 = (bx - v.x) / v.s, wy0 = (by - v.y) / v.s, wx1 = (bx + bw - v.x) / v.s, wy1 = (by + bh - v.y) / v.s;
      const vis = visibleSet(nodesRef.current), hit = [];
      for (const m of nodesRef.current) {
        const z = sizesRef.current[m.id];
        if (vis.has(m.id) && z && m.x != null && m.x < wx1 && m.x + z.w > wx0 && m.y < wy1 && m.y + z.h > wy0) hit.push(m.id);
      }
      applySel([...new Set([...base, ...hit])]);
      const eh = edgeGeom(nodesRef.current, sizesRef.current, vis).filter(g => edgeHitsRect(g, wx0, wy0, wx1, wy1)).map(g => g.id);
      setSelEdges([...new Set([...baseE, ...eh])]);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setMarq(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  /* ----- arrastar nó (move o ramo; soltar sobre outro nó = reparentar) ----- */
  const onNodeDown = (e, n) => {
    if (editing === n.id || e.button !== 0) return;
    e.stopPropagation();
    if (e.target.closest('.badge')) return;
    setPalOpen(false);
    if (e.shiftKey) {  // Shift+clique: adiciona/remove da seleção
      const cur = mselRef.current.length ? mselRef.current : (selRef.current ? [selRef.current] : []);
      applySel(cur.includes(n.id) ? cur.filter(i => i !== n.id) : [...cur, n.id]);
      return;
    }
    const group = mselRef.current.length > 1 && mselRef.current.includes(n.id);
    if (!group) { setMsel([]); setSel(n.id); setSelEdges([]); }
    // grupo: move todos os blocos selecionados (cada um com o seu ramo) de uma vez
    const ids = new Set();
    for (const gid of (group ? mselRef.current : [n.id])) descendants(nodesRef.current, gid).forEach(i => ids.add(i));
    const orig = new Map(nodesRef.current.filter(m => ids.has(m.id)).map(m => [m.id, { x: m.x, y: m.y }]));
    const sx = e.clientX, sy = e.clientY;
    let moved = false, target = null;
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved) { if (Math.hypot(dx, dy) < 4) return; moved = true; undo.current.push(nodesRef.current); redo.current = []; }
      const s = viewRef.current.s;
      const next = nodesRef.current.map(m => (orig.has(m.id) ? { ...m, x: orig.get(m.id).x + dx / s, y: orig.get(m.id).y + dy / s } : m));
      nodesRef.current = next; setNodes(next);
      if (n.parent && !group) {
        const r = stage.current.getBoundingClientRect(), v = viewRef.current;
        const wx = (ev.clientX - r.left - v.x) / v.s, wy = (ev.clientY - r.top - v.y) / v.s;
        const vis = visibleSet(next);
        target = null;
        for (const m of next) {
          const z = sizesRef.current[m.id];
          if (!vis.has(m.id) || ids.has(m.id) || !z) continue;
          if (wx >= m.x && wx <= m.x + z.w && wy >= m.y && wy <= m.y + z.h) target = m.id;
        }
        setDropT(target);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDropT(null);
      if (!moved) return;
      if (!group && target && target !== n.parent) {
        const root = nodesRef.current.find(m => !m.parent);
        const next = nodesRef.current.map(m => {
          if (m.id === n.id) return { ...m, parent: target, color: target === root.id ? (m.color || PALETTE[kidsOf(nodesRef.current, root.id).length % PALETTE.length]) : null };
          if (m.id === target) return { ...m, collapsed: false };
          return m;
        });
        nodesRef.current = next; setNodes(next);
      }
      if (!pendingLayout.current) sync();
      bump(v => v + 1);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  /* ----- redimensionar bloco (largura); o texto quebra linha dentro dele ----- */
  const onResizeDown = (e, n) => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, w0 = sizesRef.current[n.id]?.w || n.w || 100;
    let moved = false;
    const move = ev => {
      if (!moved) { moved = true; undo.current.push(nodesRef.current); redo.current = []; }
      const w = Math.max(60, Math.round(w0 + (ev.clientX - sx) / viewRef.current.s));
      const next = nodesRef.current.map(m => (m.id === n.id ? { ...m, w } : m));
      nodesRef.current = next; setNodes(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (moved) { sync(); bump(v => v + 1); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  /* ----- ações ----- */
  const newNode = (parent, extra) => ({ id: uid(), parent, text: 'Novo tópico', x: 0, y: 0, color: null, size: null, bold: false, collapsed: false, w: null, bg: null, fg: null, lc: null, ...extra });

  // base inferior (em coordenadas do mundo) do ramo visível de um nó — para não sobrepor
  const branchBottom = (ns, id) => {
    const vis = visibleSet(ns); let bot = -Infinity;
    for (const m of ns) if (vis.has(m.id) && descendants(ns, id).has(m.id) && m.y != null)
      bot = Math.max(bot, m.y + (sizesRef.current[m.id]?.h || 30));
    return bot;
  };
  const sideOf = (ns, root, n) => {
    const rc = root.x + (sizesRef.current[root.id]?.w || 100) / 2;
    return n.x + (sizesRef.current[n.id]?.w || 100) / 2 >= rc ? 1 : -1;
  };

  // só o novo nó é posicionado; nenhum outro nó se move
  const addChild = pId => {
    const ns = nodesRef.current, parent = ns.find(n => n.id === pId); if (!parent) return;
    const root = ns.find(n => !n.parent);
    const sz = sizesRef.current[pId] || { w: 100, h: 30 };
    const sibs = kidsOf(ns, pId);
    let side;
    if (pId !== root.id) {
      let t = parent;
      while (t.parent !== root.id) { const pp = t.parent; t = ns.find(m => m.id === pp); }
      side = sideOf(ns, root, t);
    } else {
      const right = sibs.filter(c => sideOf(ns, root, c) > 0).length;
      side = right <= sibs.length - right ? 1 : -1;
    }
    const same = sibs.filter(c => pId !== root.id || sideOf(ns, root, c) === side);
    const last = same[same.length - 1];
    const node = newNode(pId, {
      x: side > 0 ? parent.x + sz.w + GX : parent.x - GX - 110,
      y: last ? branchBottom(ns, last.id) + GAP : parent.y,
      color: pId === root.id ? PALETTE[sibs.length % PALETTE.length] : null,
    });
    mutate(list => [...list.map(n => (n.id === pId ? { ...n, collapsed: false } : n)), node]);
    setSel(node.id); setEditing(node.id);
  };
  const addSibling = id => {
    const ns = nodesRef.current, n = ns.find(m => m.id === id);
    if (!n?.parent) return addChild(id);
    const root = ns.find(m => !m.parent);
    const node = newNode(n.parent, {
      x: n.x, y: branchBottom(ns, id) + GAP,
      color: n.parent === root.id ? PALETTE[kidsOf(ns, root.id).length % PALETTE.length] : null,
    });
    mutate(list => {
      const ids = descendants(list, id);
      let j = list.findIndex(m => m.id === id);
      while (j + 1 < list.length && ids.has(list[j + 1].id)) j++;
      return [...list.slice(0, j + 1), node, ...list.slice(j + 1)];
    });
    setSel(node.id); setEditing(node.id);
  };
  const remove = id => {
    const n = nodesRef.current.find(m => m.id === id); if (!n?.parent) return;
    const ids = descendants(nodesRef.current, id);
    mutate(list => list.filter(m => !ids.has(m.id)));
    setSel(n.parent); setEditing(null);
  };
  const removeMany = () => {
    const ids = new Set();
    for (const id of mselRef.current) { const n = nodesRef.current.find(m => m.id === id); if (n?.parent) descendants(nodesRef.current, id).forEach(i => ids.add(i)); }
    if (ids.size) mutate(list => list.filter(m => !ids.has(m.id)));
    setMsel([]); setSel(null);
  };
  const toggleCollapse = id => patch(id, { collapsed: !nodesRef.current.find(n => n.id === id).collapsed });
  const doUndo = () => {
    const prev = undo.current.pop(); if (!prev) return;
    redo.current.push(nodesRef.current); nodesRef.current = prev; setNodes(prev); sync(); bump(v => v + 1);
  };
  const doRedo = () => {
    const nx = redo.current.pop(); if (!nx) return;
    undo.current.push(nodesRef.current); nodesRef.current = nx; setNodes(nx); sync(); bump(v => v + 1);
  };
  const organize = () => { undo.current.push(nodesRef.current); redo.current = []; pendingLayout.current = true; bump(v => v + 1); };

  const commitEdit = (id, text) => {
    setEditing(null);
    const t = text.replace(/\s+/g, ' ').trim() || 'Novo tópico';
    const n = nodesRef.current.find(m => m.id === id);
    if (n && n.text !== t) patch(id, { text: t });
  };

  /* ----- teclado ----- */
  // clique numa linha seleciona só ela; Shift+clique soma/remove da seleção de linhas
  const selectEdge = (id, additive) => {
    setEditing(null); setPalOpen(false); setCtx(null);
    if (additive) { setSelEdges(cur => (cur.includes(id) ? cur.filter(i => i !== id) : [...cur, id])); return; }
    setSel(null); setMsel([]); setSelEdges([id]);
  };
  const patchMany = (ids, p) => { const set = new Set(ids); mutate(ns => ns.map(n => (set.has(n.id) ? { ...n, ...p } : n))); };
  const toggleGuides = () => setGuides(g => { try { localStorage.setItem('mm:guides', g ? '0' : '1'); } catch {} return !g; });
  actions.current = { selectAll: applySel, removeMany, toggleGuides, commitEdit, addChild, addSibling, remove, doUndo, doRedo, toggleCollapse };
  useEffect(() => {
    const onKey = e => {
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      const a = actions.current, id = selRef.current;
      if (e.key === 'Escape') setSelEdges([]);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) a.doRedo(); else a.doUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); a.doRedo(); return; }
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey) { a.toggleGuides(); return; }
      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { setTool('select'); return; }
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) { setTool('pan'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault(); const vis = visibleSet(nodesRef.current);
        a.selectAll([...vis]); setSelEdges(edgeGeom(nodesRef.current, sizesRef.current, vis).map(g => g.id)); return;
      }
      if (mselRef.current.length > 1) {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); a.removeMany(); }
        else if (e.key === 'Escape') setMsel([]);
        return;
      }
      if (!id) return;
      if (e.key === 'Tab') { e.preventDefault(); a.addChild(id); }
      else if (e.key === 'Enter') { e.preventDefault(); a.addSibling(id); }
      else if (e.key === 'F2') { e.preventDefault(); setEditing(id); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); a.remove(id); }
      else if (e.key === ' ') { e.preventDefault(); a.toggleCollapse(id); }
      else if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  // entra em modo edição: preenche, foca, seleciona tudo
  useEffect(() => {
    const el = editRef.current; if (!editing || !el) return;
    el.textContent = nodesRef.current.find(n => n.id === editing)?.text || '';
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, [editing]);

  // F12: área de desenho em tela cheia (esconde painéis); Esc sai
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'F12') return;
      e.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen();
      else { setFull(true); document.documentElement.requestFullscreen?.().catch(() => {}); }
    };
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
  }, []);

  /* ----- guias cartesianas (cruz que segue o mouse, estilo AutoCAD) ----- */
  const onGuideMove = e => {
    const r = stage.current.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (gV.current) { gV.current.style.transform = `translateX(${x}px)`; gH.current.style.transform = `translateY(${y}px)`; }
    if (gL.current) {
      const v = viewRef.current;
      gL.current.style.transform = `translate(${x + 14}px,${y + 14}px)`;
      gL.current.textContent = `${Math.round((x - v.x) / v.s)}, ${Math.round((y - v.y) / v.s)}`;
    }
  };
  const onGuideLeave = () => {};  // as guias ficam fixas na última posição do mouse

  useEffect(() => {
    if (!guides || !stage.current || !gV.current) return;
    const r = stage.current.getBoundingClientRect(), x = r.width / 2, y = r.height / 2;
    gV.current.style.transform = `translateX(${x}px)`; gH.current.style.transform = `translateY(${y}px)`;
    gL.current.style.transform = `translate(${x + 14}px,${y + 14}px)`; gL.current.textContent = '';
  }, [guides]);

  /* ----- menu de clique direito (a aplicação responde, não o navegador) ----- */
  const STACK_GAP = 10;
  const onContextMenu = e => {
    e.preventDefault();
    if (!e.target.closest('.stage')) return setCtx(null);
    if (e.target.closest('.toolbar, .ui')) return;
    const nid = e.target.closest('.node')?.dataset.id;
    if (nid && !mselRef.current.includes(nid)) applySel([nid]);   // botão direito num bloco fora da seleção seleciona esse bloco
    setEditing(null); setPalOpen(false);
    setCtx({ x: e.clientX, y: e.clientY });
  };

  // "Padrão vertical": usa a menor distância atual entre os blocos selecionados, repete-a entre todos
  // e recentraliza o conjunto verticalmente em relação ao bloco pai. Blocos com pais diferentes formam um
  // conjunto cada. O X não muda e cada bloco leva o seu ramo junto.
  const verticalPattern = () => {
    const ns = nodesRef.current, sz = sizesRef.current;
    const work = new Map(ns.map(n => [n.id, { ...n }]));
    const depth = id => { let d = 0, c = work.get(id); while (c?.parent) { d++; c = work.get(c.parent); } return d; };
    const groups = new Map();
    for (const id of mselRef.current) {
      const n = work.get(id);
      if (n && n.parent && n.y != null && sz[id]) (groups.get(n.parent) || groups.set(n.parent, []).get(n.parent)).push(id);
    }
    if (![...groups.values()].some(g => g.length)) return;
    // pais mais próximos da raiz primeiro (se um pai também for movido, os filhos já seguem a posição nova dele)
    for (const [pid, ids] of [...groups].sort((a, b) => depth(a[0]) - depth(b[0]))) {
      const parent = work.get(pid), ps = sz[pid]; if (!parent || !ps) continue;
      const list = ids.map(id => work.get(id)).sort((a, b) => a.y - b.y);
      // espaço = a MENOR distância atual entre blocos vizinhos do conjunto (nunca negativa), repetida entre todos
      let gap = Infinity;
      for (let i = 1; i < list.length; i++) gap = Math.min(gap, list[i].y - (list[i - 1].y + sz[list[i - 1].id].h));
      gap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
      const total = list.reduce((t, n) => t + sz[n.id].h, 0) + gap * (list.length - 1);
      let y = parent.y + ps.h / 2 - total / 2;
      for (const n of list) {
        const d = y - n.y;
        if (d) for (const m of work.values()) if (descendants(ns, n.id).has(m.id)) m.y += d;
        y += sz[n.id].h + gap;
      }
    }
    mutate(all => all.map(m => work.get(m.id)));
    setCtx(null);
  };

  useEffect(() => {
    if (!ctx) return;
    const close = e => { if (!e.target.closest?.('.ctx')) setCtx(null); };
    const onKey = e => { if (e.key === 'Escape') setCtx(null); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('wheel', close, true); window.removeEventListener('keydown', onKey); window.removeEventListener('blur', close); };
  }, [ctx]);

  /* ----- funcionalidades (painel da direita) ----- */
  useEffect(() => { fetch('/api/features').then(r => r.json()).then(setFeatures).catch(() => {}); }, []);
  const toggleFeature = async f => {
    const checked = !f.checked;
    setFeatures(list => list.map(x => (x.id === f.id ? { ...x, checked } : x)));
    try {
      const r = await fetch(`/api/features/${f.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ checked }) });
      if (!r.ok) throw new Error();
    } catch { setFeatures(list => list.map(x => (x.id === f.id ? { ...x, checked: !checked } : x))); }
  };

  /* ----- exportar / importar ----- */
  const openExport = async () => {
    sync(); flush(); await queue.current;
    const d = await (await fetch(`/api/projects/${pidRef.current}`)).json();
    setDlgText(JSON.stringify({ format: 'mindmap', version: 1, project: { name: d.project.name }, view: d.view, nodes: d.nodes }, null, 2));
    setDlgMsg(''); setDlg('export');
  };
  const openImport = () => { setDlgText(''); setDlgMsg(''); setDlg('import'); };
  const downloadJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([dlgText], { type: 'application/json' }));
    a.download = `${(curName || 'mindmap').replace(/[^\w-]+/g, '_')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const copyJson = async () => { try { await navigator.clipboard.writeText(dlgText); setDlgMsg('Copiado ✓'); } catch { setDlgMsg('Não foi possível copiar'); } };
  const pickFile = async e => { const f = e.target.files?.[0]; if (f) { setDlgText(await f.text()); setDlgMsg(''); } e.target.value = ''; };
  const doImport = async () => {
    let body; try { body = JSON.parse(dlgText); } catch { return setDlgMsg('JSON inválido'); }
    const r = await fetch(`/api/projects/${pid}/import`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
    if (!r.ok) return setDlgMsg((await r.json().catch(() => ({}))).error || 'Falha ao importar');
    setDlg(null); await loadProject(pid);
    if (nodesRef.current.some(n => n.x == null)) pendingLayout.current = true;
    pendingFit.current = true; bump(v => v + 1);
  };

  /* ----- projetos ----- */
  const newProject = async () => {
    const name = prompt('Nome do projeto:', `Projeto ${projects.length + 1}`); if (!name?.trim()) return;
    const p = await (await fetch('/api/projects', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name }) })).json();
    await refreshProjects(); loadProject(p.id);
  };
  const renameProject = async p => {
    const name = prompt('Renomear projeto:', p.name); if (!name?.trim()) return;
    await fetch(`/api/projects/${p.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ name }) });
    refreshProjects();
  };
  const deleteProject = async p => {
    if (!confirm(`Excluir "${p.name}" e todo o seu mapa?`)) return;
    await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
    const list = await refreshProjects();
    if (p.id === pid) {
      pidRef.current = null; clearTimeout(saveTimer.current); saveTimer.current = null; syncedRef.current = [];
      if (list[0]) loadProject(list[0].id); else { setPid(null); setNodes([]); }
    }
  };

  /* ----- render ----- */
  const vis = visibleSet(nodes);
  const rootId = nodes.find(n => !n.parent)?.id;
  const sn = nodes.find(n => n.id === sel && vis.has(n.id));
  const edges = edgeGeom(nodes, sizes, vis);
  const ses = edges.filter(e => selEdges.includes(e.id));
  const defSize = n => n.size || (n.id === rootId ? 22 : 16);
  const tb = sn && sizes[sn.id] && sn.x != null && editing !== sn.id
    ? { left: view.x + (sn.x + sizes[sn.id].w / 2) * view.s, top: view.y + sn.y * view.s - 54 } : null;
  const curName = projects.find(p => p.id === pid)?.name;

  return (
    <div className={`app${full ? ' full' : ''}${guides ? ' g' : ''}`} onContextMenu={onContextMenu}>

      <main className={`stage${tool === 'select' ? ' tool-select' : ''}${panel ? ' panel-open' : ''}`} ref={stage} onPointerDown={onStageDown} onPointerMove={onGuideMove} onPointerLeave={onGuideLeave}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.s}px ${24 * view.s}px` }}>
        <aside className="side ui">
          <div className="logo">mind<b>map</b></div>
          <div className="side-h">Projetos <button className="icon" title="Novo projeto" onClick={newProject}>＋</button></div>
          <ul>
            {projects.map(p => (
              <li key={p.id} className={p.id === pid ? 'on' : ''} onClick={() => loadProject(p.id)} onDoubleClick={() => renameProject(p)}>
                <span>{p.name}</span>
                <button className="icon sm" title="Excluir" onClick={e => { e.stopPropagation(); deleteProject(p); }}>×</button>
              </li>
            ))}
          </ul>
          <div className="help">
            <b>Atalhos</b><br />
            Tab — filho · Enter — irmão<br />
            F2 / duplo clique — editar<br />
            Del — excluir · Espaço — recolher<br />
            Ctrl+Z / Ctrl+Y — desfazer/refazer<br />
          G — guias do mouse<br />
          S — selecionar vários (arraste) · M — mover tela<br />
          Shift+clique — soma à seleção (blocos e linhas) · Ctrl+A — todos<br />
          Selecionar em área também pega as linhas tocadas<br />
          F12 — tela cheia (Esc sai)<br />
            Arraste um nó sobre outro para mover o ramo<br />
          Nó selecionado: arraste a alça direita para redimensionar
          </div>
        </aside>
        <div className="world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.s})` }}>
          <svg className="edges"><g>
            {edges.map(e => (
              <g key={e.id}>
                {selEdges.includes(e.id) && <path d={e.d} stroke={e.c} className="edge-halo" />}
                <path d={e.d} stroke={e.c} />
                <path d={e.d} className="edge-hit" onPointerDown={ev => { if (ev.button !== 0) return; ev.stopPropagation(); selectEdge(e.id, ev.shiftKey); }} />
              </g>
            ))}
          </g></svg>
          {nodes.filter(n => vis.has(n.id)).map(n => {
            const isRoot = n.id === rootId, color = effColor(nodes, n), nk = kidsOf(nodes, n.id).length;
            const isEd = editing === n.id;
            return (
              <div key={n.id} data-id={n.id} ref={el => { if (el) nodeEls.current[n.id] = el; else delete nodeEls.current[n.id]; }}
                className={`node${n.w ? ' fw' : ''}${isRoot ? ' root' : ''}${sel === n.id || msel.includes(n.id) ? ' sel' : ''}${dropT === n.id ? ' drop' : ''}`}
                style={{ left: n.x ?? 0, top: n.y ?? 0, visibility: n.x == null ? 'hidden' : 'visible', fontSize: defSize(n), fontWeight: n.bold || isRoot ? 700 : 400, ...(n.w ? { width: n.w } : {}), ...(isRoot || n.bg ? { background: n.bg || color } : {}), ...(n.fg ? { color: n.fg } : {}) }}
                onPointerDown={e => onNodeDown(e, n)} onDoubleClick={e => { e.stopPropagation(); setSel(n.id); setEditing(n.id); }}>
                <span key={isEd ? 'e' : 'v'} className="txt" ref={isEd ? editRef : null}
                  contentEditable={isEd} suppressContentEditableWarning spellCheck={false}
                  onBlur={e => isEd && commitEdit(n.id, e.currentTarget.textContent)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitEdit(n.id, e.currentTarget.textContent); }
                    else if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); commitEdit(n.id, e.currentTarget.textContent); addChild(n.id); }
                  }}
                  onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
                  onInput={() => bump(v => v + 1)}>
                  {isEd ? null : n.text}
                </span>
                {sel === n.id && !isEd && <span className="rz" title="Arraste para redimensionar · duplo clique = linha inteira" onPointerDown={e => onResizeDown(e, n)} onDoubleClick={e => { e.stopPropagation(); patch(n.id, { w: null }); }} />}
                {n.collapsed && nk > 0 && <button className="badge" style={{ background: color }} onClick={() => toggleCollapse(n.id)}>+{descendants(nodes, n.id).size - 1}</button>}
              </div>
            );
          })}
        </div>

        {marq && <div className="marquee" style={{ left: marq.x, top: marq.y, width: marq.w, height: marq.h }} />}
        {msel.length > 1 && (() => {
          const ms = msel.map(id => nodes.find(n => n.id === id)).filter(n => n && vis.has(n.id) && sizes[n.id] && n.x != null);
          if (ms.length < 2) return null;
          const ids = ms.map(n => n.id);
          // linhas afetadas: a que liga cada bloco ao pai + as linhas selecionadas
          const lineIds = [...new Set([...ids.filter(id => id !== rootId), ...selEdges])];
          const common = (list, f) => { const v = list.map(f); return v.every(x => x === v[0]) ? v[0] : null; };
          const bgV = common(ms, n => n.bg || (n.id === rootId ? effColor(nodes, n) : null));
          const fgV = common(ms, n => n.fg);
          const lnV = common(lineIds.map(id => nodes.find(n => n.id === id)), n => n && (n.lc || effColor(nodes, n)));
          const cx = ms.reduce((t, n) => t + n.x + sizes[n.id].w / 2, 0) / ms.length, top = Math.min(...ms.map(n => n.y));
          return (
            <div className="toolbar group-tb" style={{ left: view.x + cx * view.s, top: Math.max(8, view.y + top * view.s - 128) }} onPointerDown={e => e.stopPropagation()}>
              <div className="gtitle">{ms.length} blocos selecionados</div>
              <ColorRow key={'b' + ids.join()} label="Bloco" value={bgV} onPick={c => patchMany(ids, { bg: c })} onReset={() => patchMany(ids, { bg: null })} />
              <ColorRow key={'t' + ids.join()} label="Texto" value={fgV} onPick={c => patchMany(ids, { fg: c })} onReset={() => patchMany(ids, { fg: null })} />
              {lineIds.length > 0 && <ColorRow key={'l' + lineIds.join()} label="Linha" value={lnV} onPick={c => patchMany(lineIds, { lc: c })} onReset={() => patchMany(lineIds, { lc: null })} />}
            </div>
          );
        })()}
        {ses.length > 0 && msel.length < 2 && (() => {
          const ids = ses.map(e => e.id);
          const lcs = ids.map(id => nodes.find(n => n.id === id)?.lc || null);
          const same = lcs.every(c => c === lcs[0]);
          const shown = same ? (lcs[0] || ses[0].c) : null;
          const cx = ses.reduce((t, e) => t + e.mx, 0) / ses.length, top = Math.min(...ses.map(e => e.my));
          return (
            <div className="toolbar edge-tb" style={{ left: view.x + cx * view.s, top: view.y + top * view.s - 52 }} onPointerDown={e => e.stopPropagation()}>
              <ColorRow key={ids.join()} label={ses.length > 1 ? `${ses.length} linhas` : 'Linha'} value={shown}
                onPick={c => patchMany(ids, { lc: c })} onReset={() => patchMany(ids, { lc: null })} />
            </div>
          );
        })()}
        {tb && !msel.length && !selEdges.length && (
          <div className="toolbar" style={{ left: tb.left, top: tb.top }} onPointerDown={e => e.stopPropagation()}>
            <button title="Cores: bloco, texto e linha" onClick={() => setPalOpen(o => !o)}>🎨</button>
            <span className="sep" />
            <button title="Menor" onClick={() => patch(sn.id, { size: Math.max(10, defSize(sn) - 2) })}>A−</button>
            <span className="val">{defSize(sn)}</span>
            <button title="Maior" onClick={() => patch(sn.id, { size: Math.min(64, defSize(sn) + 2) })}>A+</button>
            <button title="Negrito" className={sn.bold ? 'act' : ''} onClick={() => patch(sn.id, { bold: !sn.bold })}><b>B</b></button>
            {sn.w && <button title="Largura automática (linha inteira)" onClick={() => patch(sn.id, { w: null })}>↔</button>}
            <span className="sep" />
            <button title="Adicionar filho (Tab)" onClick={() => addChild(sn.id)}>＋</button>
            {kidsOf(nodes, sn.id).length > 0 && <button title="Recolher/expandir (Espaço)" onClick={() => toggleCollapse(sn.id)}>{sn.collapsed ? '⊞' : '⊟'}</button>}
            {sn.id !== rootId && <button title="Excluir (Del)" onClick={() => remove(sn.id)}>🗑</button>}
            {palOpen && (
              <div className="pal">
                <ColorRow label="Bloco" value={sn.bg || (sn.id === rootId ? effColor(nodes, sn) : null)} onPick={c => patch(sn.id, { bg: c })} onReset={() => patch(sn.id, { bg: null })} />
                <ColorRow label="Texto" value={sn.fg} onPick={c => patch(sn.id, { fg: c })} onReset={() => patch(sn.id, { fg: null })} />
                {sn.id !== rootId && <ColorRow label="Linha" value={sn.lc || effColor(nodes, sn)} onPick={c => patch(sn.id, { lc: c })} onReset={() => patch(sn.id, { lc: null })} />}
              </div>
            )}
          </div>
        )}

        {guides && (
          <div className="guides" aria-hidden>
            <div className="guide-h" ref={gH} /><div className="guide-v" ref={gV} /><div className="guide-lbl" ref={gL} />
          </div>
        )}
        <aside className="rpanel ui" aria-hidden={!panel}>
          <div className="rpanel-h">Funcionalidades do Miro <small>{features.filter(f => f.checked).length}/{features.length} prontas</small></div>
          <div className="rpanel-f">
            <label htmlFor="lvl">Nível de importância</label>
            <select id="lvl" value={level} onChange={e => setLevel(e.target.value)}>
              <option value="all">Todos os níveis</option>
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => <option key={n} value={n}>Nível {n}{n === 10 ? ' (essencial)' : n === 1 ? ' (opcional)' : ''}</option>)}
            </select>
          </div>
          <div className="rpanel-b">
            {features.filter(f => level === 'all' || f.importancia === Number(level)).map(f => (
              <label key={f.id} className={`feat${f.checked ? ' done' : ''}`}>
                <input type="checkbox" checked={f.checked} onChange={() => toggleFeature(f)} />
                <span className="feat-t">{f.titulo}<em title="Nível de importância">{f.importancia}</em></span>
                <span className="feat-d">{f.descricao}</span>
              </label>
            ))}
            {!features.length && <p className="rpanel-empty">Carregando…</p>}
          </div>
        </aside>
        <button className="rtab ui" title={panel ? 'Fechar painel' : 'Abrir painel de funcionalidades'} onClick={() => setPanel(o => !o)}>{panel ? '›' : '‹'}</button>
        <div className="topbar ui">
          <span className="title">{curName || '—'}</span>
          <span className="seg">
            <button title="Mover a tela (M)" className={tool === 'pan' ? 'tog on' : 'tog'} onClick={() => setTool('pan')}>✋ Mover</button>
            <button title="Seleção em área: arraste para selecionar vários blocos (S) — ou Shift+arrastar / Shift+clique" className={tool === 'select' ? 'tog on' : 'tog'} onClick={() => setTool('select')}>⬚ Selecionar</button>
          </span>
          {msel.length > 1 && <span className="selcount">{msel.length} selecionados</span>}
          <button title="Reorganiza todos os nós (desfazível)" onClick={organize}>Organizar</button>
          <button onClick={() => fit()}>Ajustar</button>
          <button title="Guias cartesianas que seguem o mouse (G)" className={guides ? 'tog on' : 'tog'} onClick={toggleGuides}>Guias</button>
          <button title="Exportar mapa em JSON" onClick={openExport}>Exportar</button>
          <button title="Importar mapa de um JSON" onClick={openImport}>Importar</button>
          <button title="Tela cheia (F12)" onClick={() => { setFull(true); document.documentElement.requestFullscreen?.().catch(() => {}); }}>⛶</button>
          <span className="status">{status}</span>
        </div>
        <div className="undo ui">
          <button title="Desfazer" onClick={doUndo}>↶</button>
          <button title="Refazer" onClick={doRedo}>↷</button>
        </div>
        <div className="zoom ui">
          <button onClick={() => zoomBy(1 / 1.2)}>−</button>
          <span>{Math.round(view.s * 100)}%</span>
          <button onClick={() => zoomBy(1.2)}>＋</button>
        </div>
      </main>
      {dlg && (
        <div className="modal-bg ui" onPointerDown={e => e.target === e.currentTarget && setDlg(null)}>
          <div className="modal">
            <h3>{dlg === 'export' ? `Exportar “${curName}” (JSON)` : `Importar JSON em “${curName}”`}</h3>
            {dlg === 'import' && nodes.length > 1 && <p className="warn">Este projeto já tem ramificações. A importação só é permitida em um projeto novo/zerado — crie um novo projeto na barra lateral.</p>}
            <textarea value={dlgText} readOnly={dlg === 'export'} spellCheck={false}
              placeholder={dlg === 'import' ? 'Cole aqui o JSON exportado ou escolha um arquivo…' : ''}
              onChange={e => setDlgText(e.target.value)} />
            <div className="modal-actions">
              <span className="msg">{dlgMsg}</span>
              {dlg === 'export' && <><button onClick={copyJson}>Copiar</button><button className="primary" onClick={downloadJson}>Baixar .json</button></>}
              {dlg === 'import' && <><label className="btn">Escolher arquivo<input type="file" accept=".json,application/json" hidden onChange={pickFile} /></label>
                <button className="primary" disabled={nodes.length > 1 || !dlgText.trim()} onClick={doImport}>Importar</button></>}
              <button onClick={() => setDlg(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
      {ctx && (
        <div className="ctx ui" style={{ left: Math.min(ctx.x, window.innerWidth - 230), top: Math.min(ctx.y, window.innerHeight - 70) }}
          onContextMenu={e => e.preventDefault()}>
          <button disabled={msel.length < 2} onClick={verticalPattern}
            title={msel.length < 2 ? 'Selecione 2 ou mais blocos (ferramenta Selecionar / Shift+clique)' : 'Repete a menor distância entre os blocos selecionados em todos eles e centraliza em relação ao bloco pai'}>
            Padrão vertical{msel.length > 1 && <small>{msel.length} blocos</small>}
          </button>
        </div>
      )}
    </div>
  );
}
