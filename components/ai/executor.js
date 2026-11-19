// Executa as ferramentas da IA no editor, com um cursor animado: cada chamada faz o que o mouse faria.
// `h` é a ponte com o MindMap (refs do estado, setters, câmera, cursor). `rt` = { gate, speed } de cada passo:
//  gate() espera enquanto pausado (e lança StopError se o usuário parou) · speed() = multiplicador de tempo (0 = sem animação).
import { GX, kidsOf, descendants, topOf, visibleSet, effColor, layoutAll, edgeGeom, placeChild, uid } from '@/lib/mm-core';

export class StopError extends Error { constructor() { super('parado'); this.stop = true; } }

const HEX = /^#[0-9a-f]{3,8}$/i;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
const ok = (text, label, extra) => ({ text, label, ...extra });
const err = text => ({ text: `Erro: ${text}`, label: `⚠ ${text}`, isError: true });
const short = (t, n = 90) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

// estado do mapa em texto (acompanha cada mensagem do usuário e a ferramenta ler_mapa)
export function describeMap(h) {
  const ns = h.nodesRef.current, sz = h.sizesRef.current, v = h.viewRef.current, box = h.stageBox();
  const vis = visibleSet(ns);
  const sel = h.selection();
  const L = [];
  L.push(`Projeto: "${h.projectName()}" · ${ns.length} blocos · zoom ${Math.round(v.s * 100)}% · ferramenta ativa: ${h.toolName()}`);
  const fr = h.free();
  L.push(`Área visível do mapa (coordenadas do mundo): x de ${Math.round((fr.l - v.x) / v.s)} a ${Math.round((fr.r - v.x) / v.s)}, y de ${Math.round((fr.t - v.y) / v.s)} a ${Math.round((fr.b - v.y) / v.s)} (tela ${Math.round(box.w)}×${Math.round(box.h)}px)`);
  L.push(sel.length ? `Selecionados: ${sel.map(id => { const n = ns.find(m => m.id === id); return n ? `[${id}] "${short(n.text, 40)}"` : id; }).join(', ')}` : 'Selecionados: nenhum');
  const tops = ns.filter(n => !n.parent);
  L.push(`Topos (blocos sem pai): ${tops.map(n => `[${n.id}]`).join(' ')}`);
  L.push('Blocos — formato: [id] "texto" · posição x,y · tamanho l×a · atributos. Cada nível de recuo é um filho.');
  let count = 0; const LIMIT = 600;
  const walk = (n, d) => {
    if (count++ >= LIMIT) return;
    const z = sz[n.id], a = [];
    if (!n.parent) a.push(tops.length > 1 && n !== ns.find(m => !m.parent) ? 'topo independente' : 'bloco central');
    if (n.color) a.push(`cor ${n.color}`); else a.push(`cor herdada ${effColor(ns, n)}`);
    if (n.bg) a.push(`fundo ${n.bg}`); if (n.fg) a.push(`texto ${n.fg}`); if (n.lc) a.push(`linha ${n.lc}`);
    if (n.bold) a.push('negrito'); if (n.size) a.push(`fonte ${n.size}`); if (n.w) a.push(`largura fixa ${n.w}`);
    if (n.collapsed && kidsOf(ns, n.id).length) a.push(`recolhido (${descendants(ns, n.id).size - 1} ocultos)`);
    L.push(`${'  '.repeat(d)}[${n.id}] "${short(n.text)}" · ${n.x == null ? '?,?' : `${Math.round(n.x)},${Math.round(n.y)}`}${z ? ` · ${Math.round(z.w)}×${Math.round(z.h)}` : ''} · ${a.join(', ')}`);
    for (const c of kidsOf(ns, n.id)) walk(c, d + 1);
  };
  for (const t of tops) walk(t, 0);
  if (ns.length > LIMIT) L.push(`… (+${ns.length - LIMIT} blocos omitidos)`);
  return L.join('\n');
}

export function makeExecutor(h) {
  const refs = new Map();           // ref dado pela IA → id real
  let rt = null;

  const res = x => (x == null || x === '' ? null : (refs.get(String(x)) ?? String(x)));
  const get = id => h.nodesRef.current.find(n => n.id === id);
  const need = x => { const n = get(res(x)); return n || null; };
  const notFound = x => `bloco "${x}" não existe. Use um id da lista do estado do mapa (ou chame ler_mapa).`;
  const sizeOf = n => h.sizesRef.current[n.id] || { w: n.w || 100, h: 30 };
  const center = n => { const z = sizeOf(n); return { x: n.x + z.w / 2, y: n.y + z.h / 2 }; };
  const toScreen = (wx, wy) => { const v = h.viewRef.current; return { x: v.x + wx * v.s, y: v.y + wy * v.s }; };
  const color = (v) => (v === '' || v === null ? null : (typeof v === 'string' && HEX.test(v) ? v : undefined));   // undefined = inválida

  const frame = () => new Promise(r => setTimeout(r, 16));
  const sleep = async ms => {
    await rt.gate(); const m = rt.speed();
    if (m > 0) await new Promise(r => setTimeout(r, ms * m));
    await rt.gate();
  };
  // chama step(e) com e de 0 a 1 (suavizado) ao longo de ms; sem animação, só o estado final
  const tween = async (ms, step) => {
    const dur = ms * rt.speed();
    if (dur <= 0) { await rt.gate(); step(1); return; }
    const t0 = performance.now();
    for (;;) {
      await rt.gate();
      const t = Math.min(1, (performance.now() - t0) / dur);
      step(ease(t));
      if (t >= 1) break;
      await frame();
    }
  };

  const animateView = (target, ms = 450) => {
    const v0 = h.viewRef.current;
    return tween(ms, e => h.applyView({ s: v0.s + (target.s - v0.s) * e, x: v0.x + (target.x - v0.x) * e, y: v0.y + (target.y - v0.y) * e }));
  };
  // a câmera acompanha o cursor: se o ponto sair da área livre da tela, desliza até ele
  const ensureVisible = async (wx, wy) => {
    const fr = h.free(), p = toScreen(wx, wy);
    if (p.x > fr.l + 30 && p.x < fr.r - 30 && p.y > fr.t + 30 && p.y < fr.b - 30) return;
    const v = h.viewRef.current;
    await animateView({ s: v.s, x: (fr.l + fr.r) / 2 - wx * v.s, y: (fr.t + fr.b) / 2 - wy * v.s });
  };
  const moveCursor = async (wx, wy, ms = 420) => {
    await ensureVisible(wx, wy);
    const p = toScreen(wx, wy);
    h.cursor({ x: p.x, y: p.y, vis: true });
    await sleep(ms);
  };
  const moveCursorToEl = async (el, ms = 480) => {
    const r = h.stageEl().getBoundingClientRect(), b = el.getBoundingClientRect();
    h.cursor({ x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2, vis: true });
    await sleep(ms);
  };
  const click = async () => { h.cursor({ down: true }); await sleep(130); h.cursor({ down: false }); };

  const setText = (id, text) => h.applyNodes(h.nodesRef.current.map(n => (n.id === id ? { ...n, text } : n)));
  const typeText = async (id, text) => {
    const dur = Math.min(1100, 28 * text.length) * rt.speed();
    if (dur <= 0) { await rt.gate(); setText(id, text); return; }
    const t0 = performance.now();
    for (;;) {
      await rt.gate();
      const t = Math.min(1, (performance.now() - t0) / dur);
      setText(id, text.slice(0, Math.ceil(text.length * t)));
      if (t >= 1) break;
      await frame();
    }
  };

  /* ----- anti-sobreposição: mede os blocos de verdade e reorganiza a árvore quando algo se toca ----- */
  const waitFrames = async (n = 2) => { for (let k = 0; k < n; k++) await frame(); };
  // existe algum par de blocos visíveis (do conjunto ids) cujos retângulos se tocam? (folga de 4px)
  const hasOverlap = (ns, ids) => {
    const vis = visibleSet(ns), M = 4;
    const L = ns.filter(n => ids.has(n.id) && vis.has(n.id) && n.x != null).map(n => { const z = sizeOf(n); return { x: n.x, y: n.y, r: n.x + z.w, b: n.y + z.h }; });
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], c = L[j];
      if (!(a.r + M <= c.x || c.r + M <= a.x || a.b + M <= c.y || c.b + M <= a.y)) return true;
    }
    return false;
  };
  // depois de criar/editar/ligar: espera a medição real dos blocos e, se a árvore tiver blocos se tocando,
  // reorganiza só essa árvore (a raiz fica parada) com animação
  const settle = async id => {
    await waitFrames(2);
    for (let k = 0; k < 10 && !h.sizesRef.current[id]; k++) await frame();   // espera o bloco ser medido
    const ns = h.nodesRef.current, top = topOf(ns, id);
    if (!top) return false;
    const ids = descendants(ns, top.id);
    if (!hasOverlap(ns, ids)) return false;
    const target = new Map(layoutAll(ns, h.sizesRef.current).filter(n => ids.has(n.id)).map(n => [n.id, n]));
    const from = new Map(ns.filter(n => ids.has(n.id)).map(n => [n.id, { x: n.x, y: n.y }]));
    await tween(420, e => h.applyNodes(h.nodesRef.current.map(n => {
      const t = target.get(n.id), f = from.get(n.id);
      return t && f ? { ...n, x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e } : n;
    })));
    h.sync();
    return true;
  };

  // campos opcionais comuns (devolve { patch } ou { error })
  const styleFields = i => {
    const p = {};
    for (const [k, f] of [['cor', 'color'], ['cor_fundo', 'bg'], ['cor_texto', 'fg'], ['cor_linha', 'lc']]) {
      if (i[k] === undefined) continue;
      const c = color(i[k]);
      if (c === undefined) return { error: `"${k}" precisa ser uma cor hexadecimal (ex.: #5b8def)` };
      p[f] = c;
    }
    if (i.negrito !== undefined) p.bold = !!i.negrito;
    if (i.tamanho !== undefined) { const t = Number(i.tamanho); if (!Number.isFinite(t)) return { error: '"tamanho" inválido' }; p.size = Math.min(64, Math.max(10, Math.round(t))); }
    if (i.largura !== undefined) { const w = Number(i.largura); p.w = !w ? null : Math.min(600, Math.max(60, Math.round(w))); }
    if (i.recolhido !== undefined) p.collapsed = !!i.recolhido;
    return { p };
  };

  /* ---------- ferramentas ---------- */
  const criar = async i => {
    const ref = String(i.ref ?? '').trim(), texto = clean(i.texto);
    if (!ref) return err('informe "ref" (um nome curto e único para o bloco)');
    if (!texto) return err('informe "texto"');
    if (refs.has(ref)) return err(`o ref "${ref}" já foi usado; escolha outro`);
    let parent = null;
    if (i.pai != null && i.pai !== '') { parent = need(i.pai); if (!parent) return err(notFound(i.pai)); }
    const st = styleFields(i); if (st.error) return err(st.error);

    if (parent) { await moveCursor(center(parent).x, center(parent).y); await click(); }
    else await sleep(200);

    // a partir daqui, sem awaits até inserir: o estado não pode mudar no meio do cálculo
    const ns = h.nodesRef.current, sz = h.sizesRef.current;
    const par = parent && ns.find(n => n.id === parent.id);
    if (parent && !par) return err(notFound(i.pai));
    let pos;
    if (par) pos = placeChild(ns, par.id, sz);
    else {
      let right = -Infinity, top = Infinity;
      for (const n of ns) if (n.x != null) { right = Math.max(right, n.x + (sz[n.id]?.w || 100)); top = Math.min(top, n.y); }
      pos = { x: Number.isFinite(right) ? right + 120 : 0, y: Number.isFinite(top) ? top : 0, color: null };
    }
    const x = Number.isFinite(Number(i.x)) && i.x !== undefined && i.x !== null ? Number(i.x) : pos.x;
    const y = Number.isFinite(Number(i.y)) && i.y !== undefined && i.y !== null ? Number(i.y) : pos.y;
    const id = uid();
    const node = { id, parent: par ? par.id : null, text: '', x, y, color: pos.color, size: null, bold: false, collapsed: false, w: null, bg: null, fg: null, lc: null, ...st.p };
    h.applyNodes([...ns.map(n => (par && n.id === par.id && n.collapsed ? { ...n, collapsed: false } : n)), node]);
    refs.set(ref, id);
    h.fx(id, 'new', 800);
    await moveCursor(x + 28, y + 14, 260);
    await typeText(id, texto);
    await waitFrames(2);   // o editor mede o bloco já com o texto final
    const fixedPos = (i.x !== undefined && i.x !== null) || (i.y !== undefined && i.y !== null);
    const cur = get(id), pn = par && get(par.id);
    if (cur && pn && !fixedPos && cur.x + sizeOf(cur).w / 2 < pn.x + sizeOf(pn).w / 2) {   // à esquerda do pai: encosta pela largura real
      h.applyNodes(h.nodesRef.current.map(n => (n.id === id ? { ...n, x: pn.x - GX - sizeOf(cur).w } : n)));
    }
    await settle(id);
    h.sync();
    return ok(`Bloco criado: id=${id} ref=${ref}`, `✚ ${short(texto, 60)}`);
  };

  const editar = async i => {
    const n = need(i.id); if (!n) return err(notFound(i.id));
    const st = styleFields(i); if (st.error) return err(st.error);
    const texto = i.texto !== undefined ? clean(i.texto) : undefined;
    if (i.texto !== undefined && !texto) return err('"texto" não pode ficar vazio');
    if (!Object.keys(st.p).length && texto === undefined) return err('nada para alterar');
    const c = center(n); await moveCursor(c.x, c.y); await click();
    h.fx(n.id, 'hl', 900);
    h.applyNodes(h.nodesRef.current.map(m => (m.id === n.id ? { ...m, ...st.p, ...(texto !== undefined ? { text: texto } : {}) } : m)));
    h.sync();
    await settle(n.id);
    await sleep(250);
    return ok(`Bloco ${n.id} alterado`, `✎ ${short(texto ?? n.text, 60)}`);
  };

  const mover = async i => {
    const n = need(i.id); if (!n) return err(notFound(i.id));
    const x = Number(i.x), y = Number(i.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return err('"x" e "y" precisam ser números');
    const ns0 = h.nodesRef.current, ids = i.com_ramo ? descendants(ns0, n.id) : new Set([n.id]);
    const c = center(n); await moveCursor(c.x, c.y, 380); h.cursor({ down: true });
    const orig = new Map(ns0.filter(m => ids.has(m.id)).map(m => [m.id, { x: m.x, y: m.y }]));
    const dx = x - n.x, dy = y - n.y;
    await ensureVisible(x + (c.x - n.x), y + (c.y - n.y));
    await tween(650, e => {
      h.applyNodes(h.nodesRef.current.map(m => (orig.has(m.id) ? { ...m, x: orig.get(m.id).x + dx * e, y: orig.get(m.id).y + dy * e } : m)));
      const p = toScreen(c.x + dx * e, c.y + dy * e); h.cursor({ x: p.x, y: p.y, vis: true });
    });
    h.cursor({ down: false }); h.sync();
    return ok(`Bloco ${n.id} movido para ${Math.round(x)},${Math.round(y)}`, `↔ ${short(n.text, 50)}`);
  };

  const ligar = async i => {
    const n = need(i.id); if (!n) return err(notFound(i.id));
    const pai = i.pai == null || i.pai === '' ? null : need(i.pai);
    if (i.pai != null && i.pai !== '' && !pai) return err(notFound(i.pai));
    const ns0 = h.nodesRef.current;
    if (pai) {
      if (pai.id === n.id) return err('um bloco não pode ser pai de si mesmo');
      if (descendants(ns0, n.id).has(pai.id)) return err('isso criaria um ciclo (o novo pai é descendente do bloco)');
      if (n.parent === pai.id) return err('o bloco já está ligado a esse pai');
      const a = center(n), b = center(pai);
      await moveCursor(a.x, a.y); h.cursor({ down: true });
      await ensureVisible(b.x, b.y);
      await tween(650, e => {
        const px = a.x + (b.x - a.x) * e, py = a.y + (b.y - a.y) * e;
        h.setLink({ x1: a.x, y1: a.y, x2: px, y2: py });
        const p = toScreen(px, py); h.cursor({ x: p.x, y: p.y, vis: true });
      });
      h.setLink(null); h.cursor({ down: false });
      h.applyNodes(h.nodesRef.current.map(m => {
        if (m.id === n.id) return { ...m, parent: pai.id, color: m.color || effColor(h.nodesRef.current, m) };
        if (m.id === pai.id) return { ...m, collapsed: false };
        return m;
      }));
      h.sync();
      await settle(n.id);
      return ok(`Bloco ${n.id} agora sai de ${pai.id}`, `🔗 ${short(n.text, 40)} → ${short(pai.text, 40)}`);
    }
    if (!n.parent) return err('o bloco já é independente (não tem linha de entrada)');
    const vis = visibleSet(ns0), g = edgeGeom(ns0, h.sizesRef.current, vis).find(e => e.id === n.id);
    if (g) { await moveCursor(g.mx, g.my); await click(); }
    h.applyNodes(h.nodesRef.current.map(m => (m.id === n.id ? { ...m, parent: null, color: m.color || effColor(h.nodesRef.current, m) } : m)));
    h.sync(); h.fx(n.id, 'hl', 900);
    return ok(`Linha do bloco ${n.id} desligada: agora é independente`, `✂ ${short(n.text, 50)}`);
  };

  const excluir = async i => {
    const n = need(i.id); if (!n) return err(notFound(i.id));
    const ns0 = h.nodesRef.current;
    if (!n.parent && ns0.filter(m => !m.parent).length < 2) return err('o único topo do mapa não pode ser excluído');
    const c = center(n); await moveCursor(c.x, c.y); await click();
    h.fx(n.id, 'del', 500); await sleep(420);
    const ids = descendants(h.nodesRef.current, n.id);
    h.applyNodes(h.nodesRef.current.filter(m => !ids.has(m.id)));
    h.select([]); h.sync();
    for (const [k, v] of refs) if (ids.has(v)) refs.delete(k);
    return ok(`Bloco ${n.id} excluído (${ids.size} bloco(s))`, `🗑 ${short(n.text, 50)}${ids.size > 1 ? ` (+${ids.size - 1})` : ''}`);
  };

  const organizar = async () => {
    const btn = [...document.querySelectorAll('.topbar button')].find(b => b.textContent.trim() === 'Organizar');
    if (btn) { await moveCursorToEl(btn); await click(); }
    const ns0 = h.nodesRef.current, target = new Map(layoutAll(ns0, h.sizesRef.current).map(n => [n.id, n]));
    const from = new Map(ns0.map(n => [n.id, { x: n.x, y: n.y }]));
    await tween(900, e => h.applyNodes(h.nodesRef.current.map(n => {
      const t = target.get(n.id), f = from.get(n.id);
      return t && f && f.x != null ? { ...n, x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e } : (t ? { ...n, x: t.x, y: t.y } : n);
    })));
    h.sync();
    return ok('Mapa reorganizado', '⎔ Mapa organizado');
  };

  const enquadrar = async i => {
    const ns = h.nodesRef.current, sz = h.sizesRef.current, vis = visibleSet(ns);
    let list = ns.filter(n => vis.has(n.id) && n.x != null && sz[n.id]);
    if (Array.isArray(i.ids) && i.ids.length) {
      const want = new Set(i.ids.map(res));
      list = list.filter(n => want.has(n.id));
      if (!list.length) return err('nenhum dos blocos informados existe/está visível');
    }
    if (!list.length) return err('o mapa está vazio');
    const x0 = Math.min(...list.map(n => n.x)), y0 = Math.min(...list.map(n => n.y));
    const x1 = Math.max(...list.map(n => n.x + sz[n.id].w)), y1 = Math.max(...list.map(n => n.y + sz[n.id].h));
    const fr = h.free(), pad = 40;
    const s = Math.min(Array.isArray(i.ids) && i.ids.length ? 1.6 : 1.2, Math.max(0.15, Math.min((fr.r - fr.l - pad * 2) / (x1 - x0 || 1), (fr.b - fr.t - pad * 2) / (y1 - y0 || 1))));
    await animateView({ s, x: (fr.l + fr.r) / 2 - ((x0 + x1) / 2) * s, y: (fr.t + fr.b) / 2 - ((y0 + y1) / 2) * s }, 700);
    h.saveView();
    return ok('Câmera ajustada', '⌖ Enquadrado');
  };

  const selecionar = async i => {
    const ids = (Array.isArray(i.ids) ? i.ids : []).map(res).filter(id => get(id));
    h.select(ids);
    await sleep(200);
    return ok(`${ids.length} bloco(s) selecionado(s)`, `▢ ${ids.length} selecionado(s)`);
  };

  const verTela = async i => {
    await sleep(150);
    const shot = h.screenshot(!!i.mapa_inteiro);
    return ok(`Print da tela (${shot.w}×${shot.h}px${i.mapa_inteiro ? ', mapa inteiro' : ', área visível'}).`, '👁 Olhou a tela', { image: shot });
  };

  const lerMapa = async () => ok(describeMap(h), '📄 Leu o mapa');

  const table = { criar_bloco: criar, editar_bloco: editar, mover_bloco: mover, ligar_bloco: ligar, excluir_bloco: excluir, organizar, enquadrar, selecionar, ver_tela: verTela, ler_mapa: lerMapa };

  return {
    reset: () => refs.clear(),
    // devolve { text, label?, image?, isError? }
    async exec(name, input, runtime) {
      rt = runtime;
      const fn = table[name];
      if (!fn) return err(`ferramenta desconhecida: ${name}`);
      if (h.readOnly) return err('este projeto é somente leitura');
      const i = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
      try { return await fn(i); }
      catch (e) {
        if (e?.stop) throw e;
        console.error(e);
        return err(`falha ao executar ${name}: ${e?.message || e}`);
      }
    },
  };
}
