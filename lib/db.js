// SQLite via node:sqlite (nativo no Node 22+). getBuiltinModule evita o bundler.
import path from 'node:path';
import { FEATURES } from './features-seed.js';
import { FEATURES_2 } from './features-seed-2.js';
import { explicacaoIA } from './features-ia.js';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

function open() {
  const db = new DatabaseSync(process.env.MINDMAP_DB || path.join(process.cwd(), 'mindmap.db'));
  db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    view TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS nodes (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    parent_id TEXT,
    text TEXT NOT NULL DEFAULT '',
    x REAL, y REAL,
    color TEXT,
    size INTEGER,
    bold INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0,
    pos REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, id)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descricao TEXT NOT NULL,
    importancia INTEGER NOT NULL CHECK (importancia BETWEEN 1 AND 10),
    checked INTEGER NOT NULL DEFAULT 0
  );`);
  try { db.exec('ALTER TABLE features ADD COLUMN explicacao_ia TEXT'); } catch {}  // texto bruto para IA
  // migrações: largura (w), cor do bloco (bg), cor do texto (fg), cor da linha que liga ao pai (lc)
  for (const c of ['w REAL', 'bg TEXT', 'fg TEXT', 'lc TEXT']) { try { db.exec(`ALTER TABLE nodes ADD COLUMN ${c}`); } catch {} }
  return db;
}

const hex = v => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null);

const db = (globalThis.__mmdb ??= open());

const q = (globalThis.__mmq ??= {
  list: db.prepare('SELECT id, name FROM projects ORDER BY id'),
  get: db.prepare('SELECT id, name, view FROM projects WHERE id = ?'),
  add: db.prepare('INSERT INTO projects (name) VALUES (?)'),
  rename: db.prepare('UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
  del: db.prepare('DELETE FROM projects WHERE id = ?'),
  nodes: db.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY pos'),
  delNodes: db.prepare('DELETE FROM nodes WHERE project_id = ?'),
  addNode: db.prepare('INSERT INTO nodes (project_id,id,parent_id,text,x,y,color,size,bold,collapsed,pos,w,bg,fg,lc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
  saveView: db.prepare('UPDATE projects SET view = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
});

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function saveNodes(pid, nodes, view) {
  tx(() => {
    q.delNodes.run(pid);
    nodes.forEach((n, i) => q.addNode.run(
      pid, String(n.id), n.parent ? String(n.parent) : null, String(n.text ?? ''),
      n.x ?? null, n.y ?? null, n.color || null, n.size || null,
      n.bold ? 1 : 0, n.collapsed ? 1 : 0, i, n.w || null, hex(n.bg), hex(n.fg), hex(n.lc)));
    q.saveView.run(view ? JSON.stringify(view) : null, pid);
  });
}

export function createProject(name, nodes) {
  const pid = Number(q.add.run(name).lastInsertRowid);
  saveNodes(pid, nodes || [{ id: 'r', parent: null, text: name, color: '#ff7b7b' }], null);
  return pid;
}

function seed() {
  if (q.list.all().length) return;
  createProject('Projeto 1', [
    { id: 'r', parent: null, text: 'Canais de vendas', color: '#ff7b7b' },
    { id: 'a', parent: 'r', text: 'Vendas diretas', color: '#ff7b7b' },
    { id: 'b', parent: 'r', text: 'Vendas online', color: '#5b8def' },
    { id: 'c', parent: 'r', text: 'Vendas offline', color: '#3fbf8f' },
    { id: 'b1', parent: 'b', text: 'Loja virtual' },
    { id: 'b2', parent: 'b', text: 'Marketplaces' },
  ]);
  createProject('Projeto 2');
  createProject('Projeto 3');
}
seed();

export const listProjects = () => q.list.all();
export const renameProject = (id, name) => q.rename.run(name, id);
export const deleteProject = id => q.del.run(id);
export function getProject(id) {
  const p = q.get.get(id);
  if (!p) return null;
  return {
    project: { id: p.id, name: p.name },
    view: p.view ? JSON.parse(p.view) : null,
    nodes: q.nodes.all(id).map(r => ({
      id: r.id, parent: r.parent_id, text: r.text, x: r.x, y: r.y,
      color: r.color, size: r.size, bold: !!r.bold, collapsed: !!r.collapsed, w: r.w ?? null, bg: r.bg ?? null, fg: r.fg ?? null, lc: r.lc ?? null,
    })),
  };
}

/* ---------- CRUD de nós (tudo descende do nó raiz, que é único) ---------- */
const nq = (globalThis.__mmnq ??= {
  one: db.prepare('SELECT parent_id, pos FROM nodes WHERE project_id = ? AND id = ?'),
  nextPos: db.prepare('SELECT MIN(pos) AS p FROM nodes WHERE project_id = ? AND pos > ?'),
  maxPos: db.prepare('SELECT COALESCE(MAX(pos), 0) AS p FROM nodes WHERE project_id = ?'),
  hasRoot: db.prepare('SELECT 1 FROM nodes WHERE project_id = ? AND parent_id IS NULL'),
  subtree: db.prepare(`WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT n.id FROM nodes n JOIN t ON n.parent_id = t.id WHERE n.project_id = ?)
    SELECT id FROM t`),
  delOne: db.prepare('DELETE FROM nodes WHERE project_id = ? AND id = ?'),
  touch: db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
});

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export { HttpError };

export function createNode(pid, n, after) {
  return tx(() => {
    if (!n?.id) throw new HttpError(400, 'id obrigatório');
    if (!n.parent) throw new HttpError(400, 'todo nó precisa de um pai: tudo parte do nó raiz');
    if (!nq.one.get(pid, String(n.parent))) throw new HttpError(400, 'pai inexistente');
    if (nq.one.get(pid, String(n.id))) throw new HttpError(409, 'nó já existe');
    let pos;
    const a = after && nq.one.get(pid, String(after));
    if (a) { const nx = nq.nextPos.get(pid, a.pos).p; pos = nx == null ? a.pos + 1 : (a.pos + nx) / 2; }
    else pos = nq.maxPos.get(pid).p + 1;
    q.addNode.run(pid, String(n.id), String(n.parent), String(n.text ?? ''), n.x ?? null, n.y ?? null,
      n.color || null, n.size || null, n.bold ? 1 : 0, n.collapsed ? 1 : 0, pos, n.w || null, hex(n.bg), hex(n.fg), hex(n.lc));
    nq.touch.run(pid);
  });
}

const COLS = { text: v => String(v ?? ''), x: v => v ?? null, y: v => v ?? null, color: v => v || null, size: v => v || null, bold: v => (v ? 1 : 0), collapsed: v => (v ? 1 : 0), w: v => (v ? Math.round(v) : null), bg: hex, fg: hex, lc: hex };

export function updateNodes(pid, patches) {
  tx(() => {
    for (const p of patches) {
      const row = nq.one.get(pid, String(p.id));
      if (!row) throw new HttpError(404, `nó ${p.id} não encontrado`);
      const sets = [], vals = [];
      for (const [k, f] of Object.entries(COLS)) if (k in p) { sets.push(`${k} = ?`); vals.push(f(p[k])); }
      if ('parent' in p) {
        if (!row.parent_id) throw new HttpError(400, 'o nó raiz não pode ter pai');
        if (!p.parent) throw new HttpError(400, 'todo nó (exceto a raiz) precisa de um pai');
        const sub = nq.subtree.all(String(p.id), pid).map(r => r.id);
        if (sub.includes(String(p.parent))) throw new HttpError(400, 'ciclo: pai não pode ser descendente');
        if (!nq.one.get(pid, String(p.parent))) throw new HttpError(400, 'pai inexistente');
        sets.push('parent_id = ?'); vals.push(String(p.parent));
      }
      if (sets.length) db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE project_id = ? AND id = ?`).run(...vals, pid, String(p.id));
    }
    nq.touch.run(pid);
  });
}

export function deleteNode(pid, id) {
  tx(() => {
    const row = nq.one.get(pid, String(id));
    if (!row) return; // idempotente
    if (!row.parent_id) throw new HttpError(400, 'o nó raiz não pode ser excluído');
    for (const r of nq.subtree.all(String(id), pid)) nq.delOne.run(pid, r.id);
    nq.touch.run(pid);
  });
}

export const saveView = (pid, view) => q.saveView.run(view ? JSON.stringify(view) : null, pid);

/* ---------- validação / importação de mapas inteiros ---------- */
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function validateMap(b) {
  if (!b || !Array.isArray(b.nodes) || !b.nodes.length) throw new HttpError(400, 'o JSON precisa de uma lista "nodes" não vazia');
  if (b.nodes.length > 5000) throw new HttpError(400, 'mapa grande demais (máx. 5000 nós)');
  const seen = new Set(), nodes = [];
  for (const n of b.nodes) {
    const id = n && n.id != null ? String(n.id) : '';
    if (!id) throw new HttpError(400, 'nó sem id');
    if (seen.has(id)) throw new HttpError(400, `id duplicado: ${id}`);
    seen.add(id);
    const size = Math.round(Number(n.size));
    nodes.push({
      id, parent: n.parent != null && n.parent !== '' ? String(n.parent) : null,
      text: String(n.text ?? '').slice(0, 2000), x: num(n.x), y: num(n.y),
      color: typeof n.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(n.color) ? n.color : null,
      size: size >= 8 && size <= 96 ? size : null, bold: !!n.bold, collapsed: !!n.collapsed,
      bg: hex(n.bg), fg: hex(n.fg), lc: hex(n.lc),
      w: Number.isFinite(n.w) && n.w >= 40 && n.w <= 2000 ? Math.round(n.w) : null,
    });
  }
  const roots = nodes.filter(n => !n.parent);
  if (roots.length !== 1) throw new HttpError(400, `precisa haver exatamente 1 nó raiz (encontrados ${roots.length})`);
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) {
    if (n.parent && !byId.has(n.parent)) throw new HttpError(400, `pai inexistente para o nó ${n.id}`);
    let cur = n, hops = 0;
    while (cur.parent) { cur = byId.get(cur.parent); if (++hops > nodes.length) throw new HttpError(400, 'o mapa contém um ciclo'); }
  }
  const v = b.view;
  const view = v && num(v.x) != null && num(v.y) != null && num(v.s) != null && v.s > 0 ? { x: v.x, y: v.y, s: v.s } : null;
  return { nodes, view };
}

export function replaceMap(pid, body) {
  const { nodes, view } = validateMap(body);
  saveNodes(pid, nodes, view);
}

// importação só é permitida em projeto novo/zerado (apenas o nó raiz, sem ramificações)
export function importMap(pid, body) {
  const { nodes, view } = validateMap(body);
  const count = db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE project_id = ?').get(pid).c;
  if (count > 1) throw new HttpError(409, 'a importação só é permitida em um projeto zerado (apenas o nó central)');
  saveNodes(pid, nodes, view);
}

/* ---------- funcionalidades do Miro (checklist de desenvolvimento) ---------- */
// insere só as funcionalidades que ainda não existem (por título); nunca altera o "checked" já gravado
function seedFeatures() {
  const has = db.prepare('SELECT 1 FROM features WHERE titulo = ?');
  const ins = db.prepare('INSERT INTO features (titulo, descricao, importancia, checked) VALUES (?,?,?,?)');
  tx(() => { for (const [t, d, i, c] of [...FEATURES, ...FEATURES_2]) if (!has.get(t)) ins.run(t, d, i, c ? 1 : 0); });
  // preenche explicacao_ia onde ainda não existe (não sobrescreve textos já editados)
  const todo = db.prepare('SELECT id, titulo, descricao, importancia FROM features WHERE explicacao_ia IS NULL').all();
  const upd = db.prepare('UPDATE features SET explicacao_ia = ? WHERE id = ?');
  tx(() => { for (const f of todo) upd.run(explicacaoIA(f), f.id); });
}
seedFeatures();

export const listFeatures = () =>
  db.prepare('SELECT id, titulo, descricao, importancia, checked, explicacao_ia FROM features ORDER BY importancia DESC, id').all()
    .map(f => ({ ...f, checked: !!f.checked }));

export function setFeatureChecked(id, checked) {
  const r = db.prepare('UPDATE features SET checked = ? WHERE id = ?').run(checked ? 1 : 0, id);
  if (!r.changes) throw new HttpError(404, 'funcionalidade não encontrada');
}
