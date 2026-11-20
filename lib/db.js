// SQLite via node:sqlite (nativo no Node 22+). getBuiltinModule evita o bundler.
import path from 'node:path';
import crypto from 'node:crypto';
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
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    sobrenome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    telefone TEXT,                              -- somente dígitos, ex.: 11912345678
    senha_hash TEXT NOT NULL,                   -- scrypt (nunca a senha em texto)
    verificado INTEGER NOT NULL DEFAULT 1,
    master INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,                -- sha256 do token do cookie
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,                -- epoch em segundos
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('verificacao', 'redefinicao')),
    expires_at INTEGER NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  try { db.exec('ALTER TABLE projects ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE'); } catch {}
  // usuário LEITOR: readonly = 1 → só visualiza (mapas e conteúdos); nada é editável (a trava fica no servidor: ver withAuth e projectRole)
  try { db.exec('ALTER TABLE users ADD COLUMN readonly INTEGER NOT NULL DEFAULT 0'); } catch {}
  // compartilhamento: URL única (uuid), visibilidade, colaboradores e convites
  try { db.exec('ALTER TABLE projects ADD COLUMN uuid TEXT'); } catch {}
  try { db.exec('ALTER TABLE projects ADD COLUMN descricao TEXT'); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN visibilidade TEXT NOT NULL DEFAULT 'privado'"); } catch {}
  for (const r of db.prepare('SELECT id FROM projects WHERE uuid IS NULL').all()) db.prepare('UPDATE projects SET uuid = ? WHERE id = ?').run(crypto.randomUUID(), r.id);
  db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_uuid ON projects(uuid);
  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    papel TEXT NOT NULL DEFAULT 'editor',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS project_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    token_hash TEXT NOT NULL UNIQUE,
    invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aceito')),
    expires_at INTEGER NOT NULL,
    accepted_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  // migrações: largura (w), cor do bloco (bg), cor do texto (fg), cor da linha que liga ao pai (lc)
  for (const c of ['w REAL', 'bg TEXT', 'fg TEXT', 'lc TEXT']) { try { db.exec(`ALTER TABLE nodes ADD COLUMN ${c}`); } catch {} }
  // assistente de IA: chave da API por usuário (criptografada, AES-256-GCM) + preferências; app_secrets guarda o segredo de criptografia quando AI_ENC_SECRET não é definido
  db.exec(`
  CREATE TABLE IF NOT EXISTS ai_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    api_key_enc TEXT,
    api_key_hint TEXT,
    model TEXT NOT NULL DEFAULT 'claude-sonnet-5-5',
    effort TEXT NOT NULL DEFAULT 'medium',
    prompt TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS app_secrets (
    name TEXT PRIMARY KEY,
    secret_value TEXT NOT NULL
  );
  -- consumo de tokens: UM registro por prompt (um prompt pode virar várias chamadas à API; os tokens são somados)
  CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,                  -- identifica o prompt (gerado no navegador)
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    prompt TEXT NOT NULL DEFAULT '',              -- o que o usuário pediu (até 2000 caracteres)
    model TEXT NOT NULL,
    effort TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,      -- TOTAL de entrada = novos + cache (escrita) + cache (leitura)
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,  -- parte da entrada gravada no cache do prompt
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,   -- parte da entrada lida do cache (bem mais barata)
    calls INTEGER NOT NULL DEFAULT 0,             -- chamadas à API neste prompt
    tool_calls INTEGER NOT NULL DEFAULT 0,        -- ações (ferramentas) executadas no mapa
    status TEXT NOT NULL DEFAULT 'em_andamento',  -- em_andamento | concluido | parado | erro | limite
    error TEXT,
    cost_usd REAL NOT NULL DEFAULT 0,             -- ESTIMATIVA em dólares (tabela de preços em lib/ai.js)
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at);`);
  return db;
}

const hex = v => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null);

const db = (globalThis.__mmdb ??= open());
export { db };

const q = (globalThis.__mmq ??= {
  list: db.prepare('SELECT id, name FROM projects WHERE user_id = ? ORDER BY id'),
  get: db.prepare('SELECT id, name, view FROM projects WHERE id = ?'),
  add: db.prepare('INSERT INTO projects (name, user_id, uuid) VALUES (?, ?, ?)'),
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

export function createProject(name, nodes, userId) {
  const pid = Number(q.add.run(name, userId, crypto.randomUUID()).lastInsertRowid);
  saveNodes(pid, nodes || [{ id: 'r', parent: null, text: name, color: '#ff7b7b' }], null);
  return pid;
}

// projetos iniciais de um usuário novo (Projeto 1 com exemplo, 2 e 3 vazios)
export function createStarterProjects(userId) {
  createProject('Projeto 1', [
    { id: 'r', parent: null, text: 'Canais de vendas', color: '#ff7b7b' },
    { id: 'a', parent: 'r', text: 'Vendas diretas', color: '#ff7b7b' },
    { id: 'b', parent: 'r', text: 'Vendas online', color: '#5b8def' },
    { id: 'c', parent: 'r', text: 'Vendas offline', color: '#3fbf8f' },
    { id: 'b1', parent: 'b', text: 'Loja virtual' },
    { id: 'b2', parent: 'b', text: 'Marketplaces' },
  ], userId);
  createProject('Projeto 2', null, userId);
  createProject('Projeto 3', null, userId);
}

// projetos próprios + compartilhados comigo (papel 'leitor' ou 'editor')
export const listProjects = userId => db.prepare(`
  SELECT p.id, p.name, p.descricao, p.uuid, p.visibilidade, 'owner' AS papel, NULL AS dono FROM projects p WHERE p.user_id = ?
  UNION ALL
  SELECT p.id, p.name, p.descricao, p.uuid, p.visibilidade, m.papel AS papel, u.nome || ' ' || u.sobrenome AS dono
    FROM project_members m JOIN projects p ON p.id = m.project_id JOIN users u ON u.id = p.user_id WHERE m.user_id = ? AND p.visibilidade != 'privado'
  ORDER BY papel DESC, id`).all(userId, userId);
export const getProjectByUuid = uuid => db.prepare('SELECT id, name, uuid, visibilidade, user_id FROM projects WHERE uuid = ?').get(String(uuid));
export const getProjectUuid = pid => db.prepare('SELECT uuid FROM projects WHERE id = ?').get(pid)?.uuid;
// Acesso: privado = só o dono · convidados = dono + quem aceitou convite (edita) · publico = igual a convidados,
// e qualquer usuário cadastrado (logado) pode visualizar. Retorna 'owner' | 'editor' | 'viewer' | null
// Usuário LEITOR (users.readonly = 1) nunca passa de 'viewer', nem no próprio projeto. Membro convidado entra como 'leitor' (viewer) até o dono promovê-lo a 'editor'.
export const isReader = userId => !!db.prepare('SELECT 1 FROM users WHERE id = ? AND readonly = 1').get(userId);
export function projectRole(userId, pid) {
  const pr = db.prepare('SELECT user_id, visibilidade FROM projects WHERE id = ?').get(pid);
  if (!pr) return null;
  const reader = isReader(userId);
  if (pr.user_id === userId) return reader ? 'viewer' : 'owner';
  if (pr.visibilidade === 'privado') return null;
  const m = db.prepare('SELECT papel FROM project_members WHERE project_id = ? AND user_id = ?').get(pid, userId);
  if (m) return reader || m.papel === 'leitor' ? 'viewer' : 'editor';
  return pr.visibilidade === 'publico' ? 'viewer' : null;
}
export const canEditProject = (userId, pid) => ['owner', 'editor'].includes(projectRole(userId, pid));
export const VISIBILIDADES = ['privado', 'publico', 'convidados'];
export function setVisibility(pid, v) {
  if (!VISIBILIDADES.includes(v)) throw new HttpError(400, 'visibilidade inválida');
  db.prepare('UPDATE projects SET visibilidade = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(v, pid);
}
export function shareInfo(pid) {
  const pr = db.prepare('SELECT uuid, visibilidade FROM projects WHERE id = ?').get(pid);
  const membros = db.prepare('SELECT u.id AS user_id, u.nome, u.sobrenome, u.email, m.papel FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY m.created_at').all(pid);
  const convites = db.prepare("SELECT id, email, expires_at FROM project_invites WHERE project_id = ? AND status = 'pendente' ORDER BY id DESC").all(pid)
    .map(c => ({ ...c, expirado: c.expires_at < Math.floor(Date.now() / 1000) }));
  return { ...pr, membros, convites };
}
export function setMemberRole(pid, userId, papel) {
  if (!['leitor', 'editor'].includes(papel)) throw new HttpError(400, 'papel inválido');
  db.prepare('UPDATE project_members SET papel = ? WHERE project_id = ? AND user_id = ?').run(papel, pid, userId);
}
export const removeMember = (pid, userId) => db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(pid, userId);
export const removeInvite = (pid, inviteId) => db.prepare("DELETE FROM project_invites WHERE project_id = ? AND id = ? AND status = 'pendente'").run(pid, inviteId);
export const ownsProject = (userId, pid) => !isReader(userId) && !!db.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(pid, userId);
export const renameProject = (id, name) => q.rename.run(name, id);
export const updateProject = (id, name, descricao) => db.prepare('UPDATE projects SET name = ?, descricao = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, descricao || null, id);
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
  countTops: db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE project_id = ? AND parent_id IS NULL'),
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
        // pai nulo = linha desligada: o bloco (com o seu ramo) passa a ser independente
        if (!p.parent) { sets.push('parent_id = ?'); vals.push(null); }
        else {
          const sub = nq.subtree.all(String(p.id), pid).map(r => r.id);
          if (sub.includes(String(p.parent))) throw new HttpError(400, 'ciclo: pai não pode ser descendente');
          if (!nq.one.get(pid, String(p.parent))) throw new HttpError(400, 'pai inexistente');
          sets.push('parent_id = ?'); vals.push(String(p.parent));
        }
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
    // só não pode apagar o único bloco de topo (o mapa nunca fica vazio)
    if (!row.parent_id && nq.countTops.get(pid).c < 2) throw new HttpError(400, 'o nó raiz não pode ser excluído');
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
  // blocos sem pai = topos (o principal + os que tiveram a linha desligada); sem topo só se houver ciclo
  if (roots.length < 1) throw new HttpError(400, 'o mapa precisa de ao menos um nó raiz (sem pai)');
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
