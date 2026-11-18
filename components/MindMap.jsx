'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import DbViewer from './DbViewer';
import ShareModal from './ShareModal';

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
// topo da árvore a que o bloco pertence (blocos sem pai são topos: o principal e os que tiveram a linha desligada)
function topOf(nodes, id) {
  let c = nodes.find(n => n.id === id), hops = 0;
  while (c?.parent && hops++ < nodes.length) { const p = c.parent; c = nodes.find(n => n.id === p); }
  return c;
}
function visibleSet(nodes) {
  const vis = new Set();
  const walk = id => {
    vis.add(id);
    const n = nodes.find(m => m.id === id);
    if (n && !n.collapsed) kidsOf(nodes, id).forEach(c => walk(c.id));
  };
  nodes.filter(n => !n.parent).forEach(r => walk(r.id));
  return vis;
}
function effColor(nodes, n) {
  let cur = n;
  while (cur) { if (cur.color) return cur.color; const pid = cur.parent; cur = nodes.find(m => m.id === pid); }
  return '#ff7b7b';
}
function layoutAll(nodes, sizes) {
  const tops = nodes.filter(n => !n.parent);
  if (!tops.length) return nodes;
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
  for (const root of tops) {   // cada árvore independente é organizada em torno do seu próprio topo
    const rx = root.x ?? 0, ry = root.y ?? 0, cy = ry + H(root.id) / 2;
    pos.set(root.id, { x: rx, y: ry });
    const top = root.collapsed ? [] : kidsOf(nodes, root.id);
    const cut = Math.ceil(top.length / 2);
    place(top.slice(0, cut), rx + W(root.id), cy, 1);
    place(top.slice(cut), rx, cy, -1);
  }
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

// GET JSON; sessão expirada (401) volta ao login
async function getJson(url) {
  const r = await fetch(url);
  if (r.status === 401) { window.location.href = '/login'; throw new Error('401'); }
  return r.json();
}

const jsonHeaders = { 'Content-Type': 'application/json' };

/* ---------- componente ---------- */
// current: { id, uuid, name, papel: 'owner' | 'editor' | 'viewer', visibilidade } · initialData: dados do mapa para o visualizador
export default function MindMap({ user, current, initialData }) {
  const readOnly = current.papel === 'viewer';   // público: qualquer usuário cadastrado visualiza, sem editar
  const isOwner = current.papel === 'owner';
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
  const [link, setLink] = useState(null);          // linha provisória enquanto se liga/religa: { x1, y1, x2, y2 }
  const selEdgesRef = useRef([]); selEdgesRef.current = selEdges;
  const [panel, setPanel] = useState(false);       // painel de funcionalidades (direita), fechado por padrão
  const [features, setFeatures] = useState([]);   // checklist de funcionalidades do Miro
  const [level, setLevel] = useState('all');        // filtro "Nível de importância"
  const [anim, setAnim] = useState(false);          // transições só depois do 1º render (sem animar ao restaurar o estado)
  const [shareOpen, setShareOpen] = useState(false);  // modal de compartilhamento (dono)
  const [dbOpen, setDbOpen] = useState(false);       // visualizador do banco (master)
  const [ctx, setCtx] = useState(null);           // menu de clique direito {x,y}
  const toolRef = useRef('pan'); toolRef.current = tool;
  const prevTool = useRef('pan');             // ferramenta de antes do zoom (volta a ela depois de usar)
  const pickTool = t => { if (t === 'zoom' && toolRef.current !== 'zoom') prevTool.current = toolRef.current; setTool(t); };
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
        if (r.status === 401) { window.location.href = '/login'; return; }
        if (!r.ok) throw new Error(r.status);
        if (--inflight.current === 0) setStatus('Salvo ✓');
      } catch { inflight.current--; setStatus('Erro ao salvar'); }
    });
  }, []);

  // compara o último estado sincronizado com o atual e dispara create / update / delete
  const sync = useCallback(() => {
    if (readOnly) return;
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
    if (readOnly) return;
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
    if (readOnly) return;
    undo.current.push(nodesRef.current); if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    const next = fn(nodesRef.current);
    nodesRef.current = next; setNodes(next);
    if (!pendingLayout.current) sync();
    bump(v => v + 1);
  }, [sync]);

  const patch = (id, p, o) => mutate(ns => ns.map(n => (n.id === id ? { ...n, ...p } : n)), o);

  /* ----- carregar projetos ----- */
  const applyData = useCallback((d, id) => {
    undo.current = []; redo.current = [];
    pidRef.current = id; setPid(id);
    sizesRef.current = {}; setSizes({});
    setSel(null); setEditing(null); setStatus('');
    nodesRef.current = d.nodes; syncedRef.current = d.nodes; setNodes(d.nodes);
    pendingLayout.current = !readOnly && d.nodes.some(n => n.x == null);
    if (d.view) { viewRef.current = d.view; setView(d.view); pendingFit.current = false; }
    else pendingFit.current = true;
  }, []);
  const loadProject = useCallback(async id => { applyData(await getJson(`/api/projects/${id}`), id); }, [applyData]);

  const refreshProjects = useCallback(async () => {
    const list = await getJson('/api/projects');
    setProjects(list); return list;
  }, []);

  useEffect(() => {
    (async () => {
      try { setGuides(localStorage.getItem('mm:guides') !== '0'); } catch {}
      try { setPanel(localStorage.getItem('mm:panel') === '1'); setLevel(localStorage.getItem('mm:level') || 'all'); } catch {}
      requestAnimationFrame(() => requestAnimationFrame(() => setAnim(true)));
      refreshProjects().catch(() => {});
      if (readOnly) applyData(initialData, current.id); else loadProject(current.id);
    })();
    // ao recarregar/fechar: confirma texto em edição e envia um snapshot completo (independe da fila)
    const onHide = () => {
      if (readOnly) return;
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

  /* ----- ferramenta de zoom (Z): arraste um retângulo e a área ocupa a tela, centralizada · clique = aproxima (Shift = afasta) ----- */
  const startZoom = e => {
    const r = stage.current.getBoundingClientRect();
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    setEditing(null); setPalOpen(false);
    let moved = false;
    const box = ev => { const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top; return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; };
    const move = ev => { const b = box(ev); if (!moved && Math.hypot(b.w, b.h) < 6) return; moved = true; setMarq({ ...b, zoom: true }); };
    const up = ev => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const b = box(ev); setMarq(null);
      const v = viewRef.current, W = r.width, H = r.height;
      let s, cx, cy;   // s = nova escala · cx,cy = ponto do mundo que vai para o centro da tela
      if (moved && b.w > 8 && b.h > 8) {
        s = Math.min(W / (b.w / v.s), H / (b.h / v.s)) * 0.94;
        cx = (b.x + b.w / 2 - v.x) / v.s; cy = (b.y + b.h / 2 - v.y) / v.s;
      } else {
        s = ev.shiftKey ? v.s / 1.6 : v.s * 1.6;
        cx = (x0 - v.x) / v.s; cy = (y0 - v.y) / v.s;
      }
      s = Math.min(3, Math.max(0.15, s));
      const nv = { s, x: W / 2 - cx * s, y: H / 2 - cy * s };
      viewRef.current = nv; setView(nv); scheduleSave();
      setTool(prevTool.current);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  /* ----- pan ----- */
  const onStageDown = e => {
    const zooming = toolRef.current === 'zoom';
    if (e.button !== 0 || e.target.closest('.toolbar, .ui') || (!zooming && e.target.closest('.node'))) return;
    setCtx(null); setSelEdges([]);
    if (zooming) return startZoom(e);
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
    if (toolRef.current === 'zoom') return;   // o palco trata o arrasto de zoom
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
    if (readOnly) return;
    // Arrastar move SÓ o(s) bloco(s) arrastado(s): os filhos ficam parados e as linhas se esticam em tempo real.
    // Alt+arrastar leva o ramo junto (e um bloco recolhido sempre leva o ramo escondido).
    // ids = blocos que se movem · sub = ramo de cada bloco arrastado (não pode servir de destino do "soltar sobre": criaria ciclo)
    const ids = new Set(), sub = new Set();
    for (const gid of (group ? mselRef.current : [n.id])) {
      const d = descendants(nodesRef.current, gid);
      d.forEach(i => sub.add(i));
      if (e.altKey || nodesRef.current.find(m => m.id === gid)?.collapsed) d.forEach(i => ids.add(i)); else ids.add(gid);
    }
    const orig = new Map(nodesRef.current.filter(m => ids.has(m.id)).map(m => [m.id, { x: m.x, y: m.y }]));
    const sx = e.clientX, sy = e.clientY;
    let moved = false, target = null;
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved) { if (Math.hypot(dx, dy) < 4) return; moved = true; undo.current.push(nodesRef.current); redo.current = []; }
      const s = viewRef.current.s;
      const next = nodesRef.current.map(m => (orig.has(m.id) ? { ...m, x: orig.get(m.id).x + dx / s, y: orig.get(m.id).y + dy / s } : m));
      nodesRef.current = next; setNodes(next);
      if (!group) {
        const r = stage.current.getBoundingClientRect(), v = viewRef.current;
        const wx = (ev.clientX - r.left - v.x) / v.s, wy = (ev.clientY - r.top - v.y) / v.s;
        const vis = visibleSet(next);
        target = null;
        for (const m of next) {
          const z = sizesRef.current[m.id];
          if (!vis.has(m.id) || sub.has(m.id) || !z) continue;
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
        const root = topOf(nodesRef.current, target);
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
    const root = topOf(ns, pId);
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
    const root = topOf(ns, id);
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
    const n = nodesRef.current.find(m => m.id === id); if (!n) return;
    if (!n.parent && nodesRef.current.filter(m => !m.parent).length < 2) return;   // o único topo não se exclui
    const ids = descendants(nodesRef.current, id);
    mutate(list => list.filter(m => !ids.has(m.id)));
    setSel(n.parent || null); setEditing(null);
  };
  const removeMany = () => {
    const ids = new Set();
    const nTops = nodesRef.current.filter(m => !m.parent).length;
    for (const id of mselRef.current) { const n = nodesRef.current.find(m => m.id === id); if (n && (n.parent || nTops > 1)) descendants(nodesRef.current, id).forEach(i => ids.add(i)); }
    if (ids.size && ids.size < nodesRef.current.length) mutate(list => list.filter(m => !ids.has(m.id)));
    setMsel([]); setSel(null);
  };
  /* ----- ligar / desligar linhas: a linha de um bloco é a que o liga ao pai ----- */
  // changes: [{ id, parent, lc? }] · expand: blocos a expandir. A cor herdada é congelada para ninguém mudar de aparência.
  const relink = (changes, expand = []) => mutate(ns => ns.map(n => {
    const ch = changes.find(c => c.id === n.id);
    if (!ch) return expand.includes(n.id) ? { ...n, collapsed: false } : n;
    return { ...n, parent: ch.parent, color: n.color || effColor(ns, n), ...(ch.lc !== undefined ? { lc: ch.lc } : {}) };
  }));
  const detachEdges = ids => {
    const ch = ids.filter(id => nodesRef.current.find(m => m.id === id)?.parent).map(id => ({ id, parent: null }));
    if (ch.length) relink(ch);
    setSelEdges([]);
  };
  // arrasto de uma ponta de linha (ou do botão "ligar"): a linha provisória segue o mouse e, soltando sobre um bloco válido, liga
  const dragLink = (e, o) => {
    if (e.button !== 0 || readOnly) return;
    e.stopPropagation(); e.preventDefault();
    const r = stage.current.getBoundingClientRect();
    let target = null;
    const move = ev => {
      const v = viewRef.current, x = (ev.clientX - r.left - v.x) / v.s, y = (ev.clientY - r.top - v.y) / v.s;
      const vs = visibleSet(nodesRef.current); target = null;
      for (const m of nodesRef.current) {
        const z = sizesRef.current[m.id];
        if (!vs.has(m.id) || !z || m.x == null) continue;
        if (x >= m.x && x <= m.x + z.w && y >= m.y && y <= m.y + z.h && o.valid(m.id)) target = m.id;
      }
      setDropT(target);
      setLink({ x1: o.fixed.x, y1: o.fixed.y, x2: x, y2: y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setLink(null); setDropT(null);
      if (target) o.apply(target);
    };
    move(e);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // ponta da linha selecionada: 'from' = lado do pai · 'to' = lado do filho
  const onEdgeEnd = (e, g, end) => {
    const ns = nodesRef.current, c = ns.find(m => m.id === g.id); if (!c) return;
    const par = c.parent;
    if (end === 'from') {
      const sub = descendants(ns, c.id);
      dragLink(e, { fixed: { x: g.x2, y: g.y2 }, valid: id => id !== par && !sub.has(id),
        apply: t => relink([{ id: c.id, parent: t }], [t]) });
    } else {
      dragLink(e, { fixed: { x: g.x1, y: g.y1 }, valid: id => id !== par && id !== c.id && !descendants(nodesRef.current, id).has(par),
        apply: t => { relink([{ id: t, parent: par, lc: g.c }, { id: c.id, parent: null }]); setSelEdges([t]); } });
    }
  };
  // botão "ligar" do bloco: arraste até outro bloco, que passa a sair deste
  const startLinkFrom = (e, b) => {
    const z = sizesRef.current[b.id]; if (!z) return;
    dragLink(e, { fixed: { x: b.x + z.w / 2, y: b.y + z.h / 2 },
      valid: id => id !== b.id && !descendants(nodesRef.current, id).has(b.id) && nodesRef.current.find(m => m.id === id)?.parent !== b.id,
      apply: t => relink([{ id: t, parent: b.id }], [b.id]) });
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
  actions.current = { pickTool, selectAll: applySel, removeMany, toggleGuides, commitEdit, addChild, addSibling, remove, doUndo, doRedo, toggleCollapse, detachEdges };
  useEffect(() => {
    const onKey = e => {
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      const a = actions.current, id = selRef.current;
      if (readOnly) {   // somente leitura: só guias, ferramentas, seleção e Esc
        const k = e.key.toLowerCase();
        if (!(['g', 's', 'm', 'z', 'escape'].includes(k) || ((e.ctrlKey || e.metaKey) && k === 'a'))) return;
      }
      if (e.key === 'Escape') { setSelEdges([]); if (toolRef.current === 'zoom') setTool(prevTool.current); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) a.doRedo(); else a.doUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); a.doRedo(); return; }
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey) { a.toggleGuides(); return; }
      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { setTool('select'); return; }
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) { setTool('pan'); return; }
      if (e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey) { pickTool('zoom'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault(); const vis = visibleSet(nodesRef.current);
        a.selectAll([...vis]); setSelEdges(edgeGeom(nodesRef.current, sizesRef.current, vis).map(g => g.id)); return;
      }
      if (mselRef.current.length > 1) {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); a.removeMany(); }
        else if (e.key === 'Escape') setMsel([]);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selEdgesRef.current.length && !id) { e.preventDefault(); a.detachEdges(selEdgesRef.current); return; }
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
    if (readOnly) return;
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
  useEffect(() => { getJson('/api/features').then(setFeatures).catch(() => {}); }, []);
  const [copied, setCopied] = useState(null);
  const copyFeature = async f => {
    const text = f.explicacao_ia || '';
    try { await navigator.clipboard.writeText(text); }
    catch {  // fallback para contextos sem permissão de clipboard
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(f.id); setTimeout(() => setCopied(c => (c === f.id ? null : c)), 1500);
  };
  const toggleFeature = async f => {
    const checked = !f.checked;
    setFeatures(list => list.map(x => (x.id === f.id ? { ...x, checked } : x)));
    try {
      const r = await fetch(`/api/features/${f.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ checked }) });
      if (!r.ok) throw new Error();
    } catch { setFeatures(list => list.map(x => (x.id === f.id ? { ...x, checked: !checked } : x))); }
  };

  const logout = async () => {
    try { sync(); flush(); await queue.current; } catch {}
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
  };

  /* ----- exportar / importar ----- */
  const openExport = async () => {
    sync(); flush(); await queue.current;
    const d = await getJson(`/api/projects/${pidRef.current}`);
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
  // cada projeto tem a sua URL única: /p/<uuid>
  const goProject = async p => {
    if (p.id === current.id) return;
    try { sync(); flush(); await queue.current; } catch {}
    window.location.href = `/p/${p.uuid}`;
  };
  const newProject = async () => {
    const name = prompt('Nome do projeto:', `Projeto ${projects.filter(p => p.papel === 'owner').length + 1}`); if (!name?.trim()) return;
    const p = await (await fetch('/api/projects', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name }) })).json();
    try { sync(); flush(); await queue.current; } catch {}
    window.location.href = `/p/${p.uuid}`;
  };
  const renameProject = async p => {
    if (p.papel !== 'owner') return;
    const name = prompt('Renomear projeto:', p.name); if (!name?.trim()) return;
    await fetch(`/api/projects/${p.id}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ name }) });
    refreshProjects();
  };
  const deleteProject = async p => {
    if (p.papel !== 'owner' || !confirm(`Excluir "${p.name}" e todo o seu mapa?`)) return;
    if (p.id === current.id) { clearTimeout(saveTimer.current); saveTimer.current = null; pidRef.current = null; syncedRef.current = []; }
    await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
    if (p.id === current.id) { window.location.href = '/meus-mapas'; return; }
    refreshProjects();
  };
  useEffect(() => { if (readOnly && editing) setEditing(null); }, [readOnly, editing]);

  /* ----- render ----- */
  const vis = visibleSet(nodes);
  const rootId = nodes.find(n => !n.parent)?.id;
  const topCount = nodes.filter(n => !n.parent).length;
  const sn = nodes.find(n => n.id === sel && vis.has(n.id));
  const edges = edgeGeom(nodes, sizes, vis);
  const ses = edges.filter(e => selEdges.includes(e.id));
  const defSize = n => n.size || (n.id === rootId ? 22 : 16);
  const tb = sn && sizes[sn.id] && sn.x != null && editing !== sn.id
    ? { left: view.x + (sn.x + sizes[sn.id].w / 2) * view.s, top: view.y + sn.y * view.s - 54 } : null;
  const curName = projects.find(p => p.id === pid)?.name || current.name;

  return (
    <div className={`app${full ? ' full' : ''}${guides ? ' g' : ''}`} onContextMenu={onContextMenu}>

      <main className={`stage${tool === 'select' ? ' tool-select' : ''}${tool === 'zoom' ? ' tool-zoom' : ''}${panel ? ' panel-open' : ''}${anim ? ' anim' : ''}`} ref={stage} onPointerDown={onStageDown} onPointerMove={onGuideMove} onPointerLeave={onGuideLeave}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.s}px ${24 * view.s}px` }}>
        <aside className="side ui">
          <div className="logo">mind<b>map</b></div>
          <div className="userbox">
            <div className="u-name">{user.nome} {user.sobrenome}{user.master && <em>master</em>}</div>
            <div className="u-mail" title={user.email}>{user.email}</div>
            <div className="u-actions">
              {user.master && <button onClick={() => setDbOpen(true)} title="Ver as tabelas e os dados do banco">Banco de dados</button>}
              <button className="u-out" onClick={logout}>Sair</button>
            </div>
          </div>
          <div className="side-h">Projetos <button className="icon" title="Novo projeto" onClick={newProject}>＋</button></div>
          <ul>
            {projects.filter(p => p.papel === 'owner').map(p => (
              <li key={p.id} className={p.id === current.id ? 'on' : ''} onClick={() => goProject(p)} onDoubleClick={() => renameProject(p)}>
                <span>{p.name}</span>
                <button className="icon sm" title="Excluir" onClick={e => { e.stopPropagation(); deleteProject(p); }}>×</button>
              </li>
            ))}
            {projects.some(p => p.papel !== 'owner') && <li className="sh-title">Compartilhados comigo</li>}
            {projects.filter(p => p.papel !== 'owner').map(p => (
              <li key={p.id} className={p.id === current.id ? 'on' : ''} onClick={() => goProject(p)} title={`Dono: ${p.dono}`}>
                <span>{p.name}<small className="dono">{p.dono}</small></span>
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
          Z — zoom em área (arraste o retângulo)<br />
          Shift+clique — soma à seleção (blocos e linhas) · Ctrl+A — todos<br />
          Selecionar em área também pega as linhas tocadas<br />
          Linha selecionada: Del desliga · arraste as bolinhas para religar<br />
          Botão 🔗 do bloco: arraste até outro bloco para ligar<br />
          F12 — tela cheia (Esc sai)<br />
            Arrastar move só o bloco (as linhas se esticam) · Alt+arrastar leva o ramo<br />
            Soltar um bloco sobre outro liga-o a ele<br />
          Nó selecionado: arraste a alça direita para redimensionar
          </div>
        </aside>
        <div className="world" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.s})` }}>
          <svg className="edges"><g>
            {edges.map(e => (
              <g key={e.id}>
                {selEdges.includes(e.id) && <path d={e.d} stroke={e.c} className="edge-halo" />}
                <path d={e.d} stroke={e.c} />
                <path d={e.d} className="edge-hit" onPointerDown={ev => { if (ev.button !== 0 || toolRef.current === 'zoom') return; ev.stopPropagation(); selectEdge(e.id, ev.shiftKey); }} />
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
                onPointerDown={e => onNodeDown(e, n)} onDoubleClick={e => { e.stopPropagation(); setSel(n.id); if (!readOnly) setEditing(n.id); }}>
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
                {sel === n.id && !isEd && !readOnly && <span className="rz" title="Arraste para redimensionar · duplo clique = linha inteira" onPointerDown={e => onResizeDown(e, n)} onDoubleClick={e => { e.stopPropagation(); patch(n.id, { w: null }); }} />}
                {n.collapsed && nk > 0 && <button className="badge" style={{ background: color }} onClick={() => toggleCollapse(n.id)}>+{descendants(nodes, n.id).size - 1}</button>}
              </div>
            );
          })}
          {/* camada acima dos blocos: pontas da linha selecionada (religar) e linha provisória */}
          <svg className="edges edges-top"><g>
            {!readOnly && !link && ses.length === 1 && msel.length < 2 && [['from', ses[0].x1, ses[0].y1], ['to', ses[0].x2, ses[0].y2]].map(([end, cx, cy]) => (
              <circle key={end} className="ehandle" cx={cx} cy={cy} r={7} onPointerDown={ev => onEdgeEnd(ev, ses[0], end)}>
                <title>{end === 'from' ? 'Arraste para ligar esta linha a outro bloco de origem' : 'Arraste para ligar esta linha a outro bloco de destino'}</title>
              </circle>
            ))}
            {link && <path className="edge-temp" d={`M${link.x1} ${link.y1} C${(link.x1 + link.x2) / 2} ${link.y1} ${(link.x1 + link.x2) / 2} ${link.y2} ${link.x2} ${link.y2}`} />}
          </g></svg>
        </div>

        {marq && <div className={`marquee${marq.zoom ? ' zoom' : ''}`} style={{ left: marq.x, top: marq.y, width: marq.w, height: marq.h }} />}
        {msel.length > 1 && !readOnly && (() => {
          const ms = msel.map(id => nodes.find(n => n.id === id)).filter(n => n && vis.has(n.id) && sizes[n.id] && n.x != null);
          if (ms.length < 2) return null;
          const ids = ms.map(n => n.id);
          // linhas afetadas: a que liga cada bloco ao pai + as linhas selecionadas
          const lineIds = [...new Set([...ids.filter(id => nodes.find(n => n.id === id)?.parent), ...selEdges])];
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
        {ses.length > 0 && msel.length < 2 && !readOnly && (() => {
          const ids = ses.map(e => e.id);
          const lcs = ids.map(id => nodes.find(n => n.id === id)?.lc || null);
          const same = lcs.every(c => c === lcs[0]);
          const shown = same ? (lcs[0] || ses[0].c) : null;
          const cx = ses.reduce((t, e) => t + e.mx, 0) / ses.length, top = Math.min(...ses.map(e => e.my));
          return (
            <div className="toolbar edge-tb" style={{ left: view.x + cx * view.s, top: view.y + top * view.s - 52 }} onPointerDown={e => e.stopPropagation()}>
              <ColorRow key={ids.join()} label={ses.length > 1 ? `${ses.length} linhas` : 'Linha'} value={shown}
                onPick={c => patchMany(ids, { lc: c })} onReset={() => patchMany(ids, { lc: null })} />
              <span className="sep" />
              <button className="cut" title={ses.length > 1 ? 'Desligar as linhas (Del): os blocos ficam independentes' : 'Desligar a linha (Del). Arraste as bolinhas das pontas para ligá-la a outro bloco'} onClick={() => detachEdges(ids)}>✂ Desligar</button>
            </div>
          );
        })()}
        {tb && !msel.length && !selEdges.length && !readOnly && (
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
            <button title="Ligar: arraste daqui até outro bloco; ele passa a sair deste" onPointerDown={e => startLinkFrom(e, sn)}>🔗</button>
            {kidsOf(nodes, sn.id).length > 0 && <button title="Recolher/expandir (Espaço)" onClick={() => toggleCollapse(sn.id)}>{sn.collapsed ? '⊞' : '⊟'}</button>}
            {(sn.parent || topCount > 1) && <button title="Excluir (Del)" onClick={() => remove(sn.id)}>🗑</button>}
            {palOpen && (
              <div className="pal">
                <ColorRow label="Bloco" value={sn.bg || (sn.id === rootId ? effColor(nodes, sn) : null)} onPick={c => patch(sn.id, { bg: c })} onReset={() => patch(sn.id, { bg: null })} />
                <ColorRow label="Texto" value={sn.fg} onPick={c => patch(sn.id, { fg: c })} onReset={() => patch(sn.id, { fg: null })} />
                {sn.parent && <ColorRow label="Linha" value={sn.lc || effColor(nodes, sn)} onPick={c => patch(sn.id, { lc: c })} onReset={() => patch(sn.id, { lc: null })} />}
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
            <select id="lvl" value={level} onChange={e => { setLevel(e.target.value); try { localStorage.setItem('mm:level', e.target.value); } catch {} }}>
              <option value="all">Todos os níveis</option>
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => <option key={n} value={n}>Nível {n}{n === 10 ? ' (essencial)' : n === 1 ? ' (opcional)' : ''}</option>)}
            </select>
          </div>
          <div className="rpanel-b">
            {features.filter(f => level === 'all' || f.importancia === Number(level)).map(f => (
              <label key={f.id} className={`feat${f.checked ? ' done' : ''}`}>
                <input type="checkbox" checked={f.checked} disabled={!user.master} title={user.master ? undefined : "Somente o master marca como desenvolvida"} onChange={() => toggleFeature(f)} />
                <span className="feat-t"><span>{f.titulo}</span>
                  <span className="feat-r"><em title="Nível de importância">{f.importancia}</em>
                    <button type="button" className={`copy${copied === f.id ? ' ok' : ''}`} title="Copiar explicação para IA"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); copyFeature(f); }}>
                      {copied === f.id
                        ? <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                        : <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>}
                    </button></span></span>
                <span className="feat-d">{f.descricao}</span>
              </label>
            ))}
            {!features.length && <p className="rpanel-empty">Carregando…</p>}
          </div>
        </aside>
        <button className="rtab ui" title={panel ? 'Fechar painel' : 'Abrir painel de funcionalidades'} onClick={() => setPanel(o => { try { localStorage.setItem('mm:panel', o ? '0' : '1'); } catch {} return !o; })}>{panel ? '›' : '‹'}</button>
        <div className="topbar ui">
          <span className="title">{curName || '—'}</span>
          <span className="seg">
            <button title="Mover a tela (M)" className={tool === 'pan' ? 'tog on' : 'tog'} onClick={() => setTool('pan')}>✋ Mover</button>
            <button title="Seleção em área: arraste para selecionar vários blocos (S) — ou Shift+arrastar / Shift+clique" className={tool === 'select' ? 'tog on' : 'tog'} onClick={() => setTool('select')}>⬚ Selecionar</button>
            <button title="Zoom em uma área (Z): arraste um retângulo e a área vai para o centro da tela · clique aproxima, Shift+clique afasta · Esc cancela" className={tool === 'zoom' ? 'tog on' : 'tog'} onClick={() => pickTool(tool === 'zoom' ? prevTool.current : 'zoom')}>🔍 Zoom</button>
          </span>
          {msel.length > 1 && <span className="selcount">{msel.length} selecionados</span>}
          {!readOnly && <button title="Reorganiza todos os nós (desfazível)" onClick={organize}>Organizar</button>}
          <button onClick={() => fit()}>Ajustar</button>
          <button title="Guias cartesianas que seguem o mouse (G)" className={guides ? 'tog on' : 'tog'} onClick={toggleGuides}>Guias</button>
          {!readOnly && <button title="Exportar mapa em JSON" onClick={openExport}>Exportar</button>}
          {!readOnly && <button title="Importar mapa de um JSON" onClick={openImport}>Importar</button>}
          {isOwner && <button className="share-btn" title="URL única, visibilidade e convites" onClick={() => setShareOpen(true)}>Compartilhar</button>}
          {readOnly && <span className="selcount ro" title="Projeto público: você pode visualizar, não editar">Somente leitura</span>}
          {current.papel === 'editor' && <span className="selcount">Colaborador</span>}
          <button title="Tela cheia (F12)" onClick={() => { setFull(true); document.documentElement.requestFullscreen?.().catch(() => {}); }}>⛶</button>
          <span className="status">{status}</span>
        </div>
        <div className="undo ui" style={readOnly ? { display: 'none' } : undefined}>
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
      {dbOpen && <DbViewer onClose={() => setDbOpen(false)} />}
      {shareOpen && <ShareModal projectId={current.id} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
