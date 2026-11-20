// Autenticação: senhas (scrypt), sessões por cookie httpOnly, tokens de verificação/redefinição, proteção de rotas.
import crypto from 'node:crypto';
import { db } from './db.js';

export const COOKIE = 'mm_session';
const SESSION_SECONDS = 30 * 24 * 3600;
export const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

export class AuthError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export function fail(e) {
  if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof SyntaxError) return Response.json({ error: 'requisição inválida' }, { status: 400 });
  console.error(e);
  return Response.json({ error: 'erro interno' }, { status: 500 });
}

/* ---------- senhas ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, h);
}
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

/* ---------- validação ---------- */
export const onlyDigits = v => String(v ?? '').replace(/\D/g, '');

export function validatePassword(senha) {
  if (typeof senha !== 'string' || senha.length < 8) throw new AuthError(400, 'A senha precisa ter pelo menos 8 caracteres');
  if (senha.length > 128) throw new AuthError(400, 'Senha longa demais');
  return senha;
}

export function validateRegister(b) {
  const nome = String(b?.nome ?? '').trim(), sobrenome = String(b?.sobrenome ?? '').trim();
  if (!nome || nome.length > 60) throw new AuthError(400, 'Informe o nome');
  if (!sobrenome || sobrenome.length > 60) throw new AuthError(400, 'Informe o sobrenome');
  const email = String(b?.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AuthError(400, 'E-mail inválido');
  const telefone = onlyDigits(b?.telefone);   // salvo só com dígitos, sem máscara
  if (!/^[1-9][0-9]9?\d{8}$/.test(telefone) || (telefone.length === 11 && telefone[2] !== '9')) throw new AuthError(400, 'Telefone inválido (use DDD + número)');
  return { nome, sobrenome, email, telefone, senha: validatePassword(b?.senha) };
}

/* ---------- usuários ---------- */
export const publicUser = r => r && ({
  id: r.id, nome: r.nome, sobrenome: r.sobrenome, email: r.email, telefone: r.telefone,
  verificado: !!r.verificado, master: !!r.master,
});
export const findUserByEmail = email => db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());

export function createUser({ nome, sobrenome, email, telefone = null, senha, verificado = true, master = false }) {
  try {
    const r = db.prepare('INSERT INTO users (nome, sobrenome, email, telefone, senha_hash, verificado, master) VALUES (?,?,?,?,?,?,?)')
      .run(nome, sobrenome, email, telefone, hashPassword(senha), verificado ? 1 : 0, master ? 1 : 0);
    return Number(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new AuthError(409, 'E-mail já cadastrado');
    throw e;
  }
}
export function setPassword(userId, senha) {
  db.prepare('UPDATE users SET senha_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashPassword(senha), userId);
}

/* ---------- sessões ---------- */
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), userId, now() + SESSION_SECONDS);
  return { token, maxAge: SESSION_SECONDS };
}
export function userFromToken(token) {
  if (!token) return null;
  const r = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.verificado = 1').get(sha256(token), now());
  return publicUser(r) || null;
}
export const destroySession = token => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
export const destroyUserSessions = userId => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);

/* ---------- tokens de verificação / redefinição (uso único) ---------- */
export function createAuthToken(userId, tipo, ttlSeconds) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO auth_tokens (token_hash, user_id, tipo, expires_at) VALUES (?,?,?,?)').run(sha256(token), userId, tipo, now() + ttlSeconds);
  return token;
}
export function consumeAuthToken(token, tipo) {
  const h = sha256(String(token || ''));
  const r = db.prepare('SELECT user_id FROM auth_tokens WHERE token_hash = ? AND tipo = ? AND usado = 0 AND expires_at > ?').get(h, tipo, now());
  if (!r) return null;
  db.prepare('UPDATE auth_tokens SET usado = 1 WHERE token_hash = ?').run(h);
  return r.user_id;
}
export function markVerified(userId) {
  db.prepare('UPDATE users SET verificado = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
}

/* ---------- requisição ---------- */
export function getCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export const sessionTokenOf = req => getCookie(req.headers.get('cookie'), COOKIE);
export const userFromRequest = req => userFromToken(sessionTokenOf(req));

const isHttps = req => (req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '')) === 'https';
export const sessionCookie = (req, token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
export const clearCookie = req => sessionCookie(req, '', 0);

export function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  return `${proto}://${req.headers.get('x-forwarded-host') || req.headers.get('host')}`;
}
export const clientIp = req => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';

// limite simples em memória (tentativas por janela)
export function rateLimit(key, max, windowSec) {
  const store = (globalThis.__mmrl ??= new Map());
  const t = Date.now(), hit = store.get(key);
  if (!hit || hit.reset < t) { store.set(key, { n: 1, reset: t + windowSec * 1000 }); return; }
  if (++hit.n > max) throw new AuthError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
}

export function checkLogin(email, senha) {
  const u = findUserByEmail(email);
  const ok = verifyPassword(String(senha ?? ''), u ? u.senha_hash : DUMMY_HASH);   // tempo constante mesmo sem usuário
  if (!u || !ok) throw new AuthError(401, 'E-mail ou senha inválidos');
  if (!u.verificado) throw new AuthError(403, 'Confirme seu e-mail para entrar (verifique sua caixa de entrada)');
  return u;
}

// protege uma rota: exige sessão válida (e, opcionalmente, usuário master)
export function withAuth(handler, { master = false } = {}) {
  return async (req, ctx) => {
    const user = userFromRequest(req);
    if (!user) return Response.json({ error: 'não autenticado' }, { status: 401 });
    if (master && !user.master) return Response.json({ error: 'acesso restrito ao master' }, { status: 403 });
    return handler(req, ctx, user);
  };
}

/* ---------- visualizador do banco (master) ---------- */
const SECRET_COLS = new Set(['senha_hash', 'token_hash', 'api_key_enc', 'secret_value']);

export function listTables() {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  return names.map(name => ({ name, rows: db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c }));
}
export function readTable(name, limit = 100, offset = 0) {
  const t = listTables().find(x => x.name === name);
  if (!t) throw new AuthError(404, 'tabela não encontrada');
  const info = db.prepare(`PRAGMA table_info("${name}")`).all();
  const columns = info.map(c => c.name);
  const meta = info.map(c => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk }));
  const rows = db.prepare(`SELECT rowid AS "_rowid", * FROM "${name}" ORDER BY rowid LIMIT ? OFFSET ?`).all(limit, offset)
    .map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, SECRET_COLS.has(k) && v != null ? '••••••••' : v])));
  return { name, columns, meta, rows, total: t.rows, limit, offset };
}

// Edita uma célula (somente master). A linha é identificada pelo rowid do SQLite.
//  - users.senha_hash: o valor informado é a NOVA SENHA; é gravada com hash e as sessões do usuário são encerradas
//  - token_hash: não editável (é só o hash de um token que existe fora do banco)
export function updateCell(name, rowid, column, value) {
  if (!listTables().some(x => x.name === name)) throw new AuthError(404, 'tabela não encontrada');
  const col = db.prepare(`PRAGMA table_info("${name}")`).all().find(c => c.name === column);
  if (!col) throw new AuthError(400, 'coluna inexistente');
  if (!Number.isInteger(rowid)) throw new AuthError(400, 'linha inválida');
  if (column === 'token_hash') throw new AuthError(400, 'token_hash não pode ser editado');

  let v = value;
  const type = String(col.type).toUpperCase();
  if (name === 'users' && column === 'senha_hash') {
    if (v === null) throw new AuthError(400, 'A senha não pode ser vazia');
    v = hashPassword(validatePassword(String(v)));
  } else if (v !== null) {
    if (/INT/.test(type) || /REAL|FLOA|DOUB/.test(type)) {
      const n = Number(v);
      if (String(v).trim() === '' || !Number.isFinite(n)) throw new AuthError(400, `"${column}" espera um número`);
      if (/INT/.test(type) && !Number.isInteger(n)) throw new AuthError(400, `"${column}" espera um número inteiro`);
      v = n;
    } else v = String(v);
  }
  if (name === 'users' && column === 'master' && v !== null && Number(v) !== 0 && Number(v) !== 1) throw new AuthError(400, `"${column}" aceita só 0 ou 1`);
  if (name === 'users' && column === 'master' && !Number(v)) {
    const row = db.prepare('SELECT master FROM users WHERE rowid = ?').get(rowid);
    if (row?.master && db.prepare('SELECT COUNT(*) AS c FROM users WHERE master = 1').get().c <= 1) throw new AuthError(400, 'Não é possível remover o último usuário master');
  }
  try {
    const r = db.prepare(`UPDATE "${name}" SET "${column}" = ? WHERE rowid = ?`).run(v, rowid);
    if (!r.changes) throw new AuthError(404, 'linha não encontrada');
  } catch (e) {
    if (e instanceof AuthError) throw e;
    const msg = String(e.message || e);   // restrição violada (UNIQUE, CHECK, NOT NULL, FK…)
    if (/NOT NULL/.test(msg)) throw new AuthError(400, `"${column}" não pode ficar vazio (NULL)`);
    if (/UNIQUE/.test(msg)) throw new AuthError(400, `Já existe outra linha com esse valor em "${column}"`);
    if (/CHECK/.test(msg)) throw new AuthError(400, `Valor recusado pela regra da coluna "${column}": ${msg.replace(/^.*constraint failed:\s*/, '')}`);
    if (/FOREIGN KEY/.test(msg)) throw new AuthError(400, 'O valor viola uma chave estrangeira (referência a outra tabela)');
    throw new AuthError(400, msg);
  }
  if (name === 'users' && column === 'senha_hash') {
    const u = db.prepare('SELECT id FROM users WHERE rowid = ?').get(rowid);
    if (u) destroyUserSessions(u.id);
  }
  const row = db.prepare(`SELECT rowid AS "_rowid", * FROM "${name}" WHERE rowid = ?`).get(rowid);
  return Object.fromEntries(Object.entries(row).map(([k, val]) => [k, SECRET_COLS.has(k) && val != null ? '••••••••' : val]));
}
