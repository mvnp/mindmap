// Funções puras do mapa (sem React): usadas pelo editor e pelo assistente de IA.
export const PALETTE = ['#ff7b7b', '#ffb454', '#e8c53a', '#3fbf8f', '#5b8def', '#a77bf3', '#555555'];
export const COLORS = [...PALETTE, '#ffffff', '#222222'];
export const GX = 70, GAP = 14;
export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- helpers puros ---------- */
export const kidsOf = (nodes, id) => nodes.filter(n => n.parent === id);
export function descendants(nodes, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true; }
  }
  return out;
}
// topo da árvore a que o bloco pertence (blocos sem pai são topos: o principal e os que tiveram a linha desligada)
export function topOf(nodes, id) {
  let c = nodes.find(n => n.id === id), hops = 0;
  while (c?.parent && hops++ < nodes.length) { const p = c.parent; c = nodes.find(n => n.id === p); }
  return c;
}
export function visibleSet(nodes) {
  const vis = new Set();
  const walk = id => {
    vis.add(id);
    const n = nodes.find(m => m.id === id);
    if (n && !n.collapsed) kidsOf(nodes, id).forEach(c => walk(c.id));
  };
  nodes.filter(n => !n.parent).forEach(r => walk(r.id));
  return vis;
}
export function effColor(nodes, n) {
  let cur = n;
  while (cur) { if (cur.color) return cur.color; const pid = cur.parent; cur = nodes.find(m => m.id === pid); }
  return '#ff7b7b';
}
export function layoutAll(nodes, sizes) {
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

export function edgeGeom(nodes, sizes, vis) {
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
export function edgeHitsRect(e, rx0, ry0, rx1, ry1) {
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    const x = u * u * u * e.x1 + 3 * u * u * t * e.mx + 3 * u * t * t * e.mx + t * t * t * e.x2;
    const y = u * u * u * e.y1 + 3 * u * u * t * e.y1 + 3 * u * t * t * e.y2 + t * t * t * e.y2;
    if (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) return true;
  }
  return false;
}


/* ---------- posicionamento de um novo filho (usado pelo editor e pela IA) ---------- */
// base inferior (em coordenadas do mundo) do ramo visível de um nó — para não sobrepor
export function branchBottom(ns, id, sizes) {
  const vis = visibleSet(ns), d = descendants(ns, id);
  let bot = -Infinity;
  for (const m of ns) if (vis.has(m.id) && d.has(m.id) && m.y != null) bot = Math.max(bot, m.y + (sizes[m.id]?.h || 30));
  return bot;
}
export function sideOf(ns, sizes, root, n) {
  const rc = root.x + (sizes[root.id]?.w || 100) / 2;
  return n.x + (sizes[n.id]?.w || 100) / 2 >= rc ? 1 : -1;
}
// só calcula { x, y, color } do novo nó; nenhum outro nó se move
export function placeChild(ns, pId, sizes) {
  const parent = ns.find(n => n.id === pId); if (!parent) return null;
  const root = topOf(ns, pId);
  const sz = sizes[pId] || { w: 100, h: 30 };
  const sibs = kidsOf(ns, pId);
  let side;
  if (pId !== root.id) {
    let t = parent;
    while (t.parent !== root.id) { const pp = t.parent; t = ns.find(m => m.id === pp); }
    side = sideOf(ns, sizes, root, t);
  } else {
    const right = sibs.filter(c => sideOf(ns, sizes, root, c) > 0).length;
    side = right <= sibs.length - right ? 1 : -1;
  }
  const same = sibs.filter(c => pId !== root.id || sideOf(ns, sizes, root, c) === side);
  const last = same[same.length - 1];
  return {
    x: side > 0 ? parent.x + sz.w + GX : parent.x - GX - 110,
    y: last ? branchBottom(ns, last.id, sizes) + GAP : parent.y,
    color: pId === root.id ? PALETTE[sibs.length % PALETTE.length] : null,
  };
}

/* ---------- sobreposição: empurra blocos até ninguém se tocar ---------- */
// Usado ao redimensionar. Só EMPURRA (nunca reorganiza o que não está em conflito):
//  · bloco que invade o próprio ramo (pai alargado por cima dos filhos): o ramo do filho se afasta na horizontal, mantendo o espaço GX;
//  · blocos sem parentesco que se tocam: o de baixo desce junto com o seu ramo, deixando `gap` de espaço vertical.
// Devolve o MESMO array se nada mudou. Considera só blocos visíveis e medidos (sizes).
export function resolveOverlaps(nodes, sizes, { gap = GAP, margin = 4, maxIter = 400 } = {}) {
  const vis = visibleSet(nodes);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const kids = new Map();
  for (const n of nodes) if (n.parent) (kids.get(n.parent) || kids.set(n.parent, []).get(n.parent)).push(n.id);
  const subtree = id => { const out = [], st = [id]; while (st.length) { const c = st.pop(); out.push(c); for (const k of kids.get(c) || []) st.push(k); } return out; };
  const isAnc = (a, b) => { let c = byId.get(b), hops = 0; while (c && c.parent && hops++ < nodes.length) { if (c.parent === a) return true; c = byId.get(c.parent); } return false; };
  const childToward = (p, c) => { let cur = c; while (byId.get(cur).parent !== p) cur = byId.get(cur).parent; return cur; };

  const pos = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  const list = nodes.filter(n => vis.has(n.id) && n.x != null && sizes[n.id]).map(n => n.id);
  const R = id => { const p = pos.get(id), z = sizes[id]; return { x: p.x, y: p.y, r: p.x + z.w, b: p.y + z.h }; };
  const shift = (ids, dx, dy) => { for (const i of ids) { const p = pos.get(i); if (p.x != null) { p.x += dx; p.y += dy; } } };

  let changed = false;

  // 1) Separa os RAMOS irmãos (mesmo pai, mesmo lado): cada ramo inteiro (bloco + descendentes) ocupa uma faixa vertical própria.
  //    Se um ramo cresceu (bloco redimensionado), os irmãos seguintes descem com os seus ramos até caber, sem intercalar com ramos de outros pais.
  const branchBox = id => {
    let t = Infinity, b = -Infinity;
    for (const i of subtree(id)) { if (!sizes[i] || !vis.has(i) || pos.get(i).x == null) continue; const r = R(i); t = Math.min(t, r.y); b = Math.max(b, r.b); }
    return { t, b };
  };
  // 0) Compacta: buracos entre ramos irmãos (sobras de blocos que encolheram) são fechados, de baixo para cima na hierarquia.
  const depth = id => { let d = 0, c = byId.get(id); while (c && c.parent && d < nodes.length) { d++; c = byId.get(c.parent); } return d; };
  for (const p of [...nodes].sort((a, b) => depth(b.id) - depth(a.id))) {
    const ks = (kids.get(p.id) || []).filter(k => vis.has(k) && sizes[k] && sizes[p.id] && pos.get(k).x != null);
    if (ks.length < 2 || pos.get(p.id).x == null) continue;
    const pc = pos.get(p.id).x + sizes[p.id].w / 2;
    for (const side of [-1, 1]) {
      const grp = ks.filter(k => (pos.get(k).x + sizes[k].w / 2 >= pc ? 1 : -1) === side).sort((a, b) => pos.get(a).y - pos.get(b).y);
      let bottom = null;
      for (const k of grp) {
        const bx = branchBox(k);
        if (bottom !== null && bx.t > bottom + gap + 0.5) { const up = bx.t - (bottom + gap); shift(subtree(k), 0, -up); changed = true; bottom = bx.b - up; }
        else bottom = Math.max(bottom ?? -Infinity, bx.b);
      }
    }
  }

  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (const p of nodes) {
      const ks = (kids.get(p.id) || []).filter(k => vis.has(k) && sizes[k] && sizes[p.id] && pos.get(k).x != null);
      if (ks.length < 2 || pos.get(p.id).x == null) continue;
      const pc = pos.get(p.id).x + sizes[p.id].w / 2;
      for (const side of [-1, 1]) {
        const grp = ks.filter(k => (pos.get(k).x + sizes[k].w / 2 >= pc ? 1 : -1) === side).sort((a, b) => pos.get(a).y - pos.get(b).y);
        let bottom = -Infinity;
        for (const k of grp) {
          const bx = branchBox(k);
          if (bx.t < bottom + gap - 0.5) { shift(subtree(k), 0, bottom + gap - bx.t); moved = changed = true; bottom = bx.b + (bottom + gap - bx.t); }
          else bottom = Math.max(bottom, bx.b);
        }
      }
    }
    if (!moved) break;
  }

  for (let iter = 0; iter < maxIter; iter++) {
    const order = [...list].sort((a, b) => pos.get(a).y - pos.get(b).y || pos.get(a).x - pos.get(b).x);
    let did = false;
    for (let i = 0; i < order.length && !did; i++) {
      const ra = R(order[i]);
      for (let j = i + 1; j < order.length; j++) {
        const rb = R(order[j]);
        if (rb.y >= ra.b + margin) break;                                  // ordenados por y: nenhum bloco mais abaixo toca em "a"
        if (ra.r + margin <= rb.x || rb.r + margin <= ra.x) continue;      // lado a lado
        const a = order[i], b = order[j];
        const rel = isAnc(a, b) ? [a, b] : isAnc(b, a) ? [b, a] : null;    // [ancestral, descendente]
        if (rel) {
          const [p, c] = rel, rp = R(p), t = childToward(p, c), rt = R(t);
          const right = (rt.x + rt.r) / 2 >= (rp.x + rp.r) / 2;
          const dx = right ? rp.r + GX - rt.x : (rp.x - GX) - rt.r;
          if (right ? dx > 0 : dx < 0) shift(subtree(t), dx, 0);           // o ramo se afasta do pai
          else shift(subtree(t), 0, Math.max(rp.b + gap - rt.y, 1));       // sem espaço lateral: o ramo desce
        } else {
          shift(subtree(b), 0, Math.max(ra.b + gap - rb.y, 1));            // o de baixo desce com o seu ramo
        }
        did = changed = true; break;
      }
    }
    if (!did) break;
  }
  if (!changed) return nodes;
  return nodes.map(n => {
    const p = pos.get(n.id);
    return p.x !== n.x || p.y !== n.y ? { ...n, x: p.x, y: p.y } : n;
  });
}
