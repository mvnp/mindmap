// Conteúdo de cada bloco: título + texto formatado (HTML) + arquivos (textos, imagens, PDFs, áudios).
// Os arquivos ficam em disco, DENTRO do volume de dados (<pasta do banco>/uploads, ou MINDMAP_UPLOADS), e o caminho relativo
// de cada um é gravado na tabela conteudo_arquivos.caminho:  <projeto>/<conteudo>/<aleatório>.<ext>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, HttpError } from './db.js';

export const LIMITS = { arquivo: 25 * 1024 * 1024, porEnvio: 100 * 1024 * 1024, arquivosPorBloco: 20, titulo: 200, corpo: 200 * 1024 };

const EXT = {
  imagem: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'],
  pdf: ['pdf'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
};
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm',
};

db.exec(`
CREATE TABLE IF NOT EXISTS conteudos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  corpo TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, node_id)
);
CREATE TABLE IF NOT EXISTS conteudo_arquivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conteudo_id INTEGER NOT NULL REFERENCES conteudos(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  caminho TEXT NOT NULL,
  mime TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'imagem', 'pdf', 'audio')),
  tamanho INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conteudo_arquivos_c ON conteudo_arquivos(conteudo_id);`);

/* ---------- disco ---------- */
export function uploadsDir() {
  if (process.env.MINDMAP_UPLOADS) return path.resolve(process.env.MINDMAP_UPLOADS);
  const dbPath = process.env.MINDMAP_DB || path.join(process.cwd(), 'mindmap.db');
  return path.join(dbPath === ':memory:' ? process.cwd() : path.dirname(path.resolve(dbPath)), 'uploads');
}
// resolve um caminho relativo guardado no banco, garantindo que ele não escapa da pasta de uploads
function abs(rel) {
  const root = uploadsDir(), p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new HttpError(400, 'caminho inválido');
  return p;
}
const rm = rel => { try { fs.rmSync(abs(rel), { force: true }); } catch {} };
export function removeProjectFiles(pid) { try { fs.rmSync(abs(String(Number(pid))), { recursive: true, force: true }); } catch {} }

/* ---------- consultas ---------- */
const nodeExists = (pid, nid) => !!db.prepare('SELECT 1 FROM nodes WHERE project_id = ? AND id = ?').get(pid, String(nid));
const rowOf = (pid, nid) => db.prepare('SELECT * FROM conteudos WHERE project_id = ? AND node_id = ?').get(pid, String(nid));
const filesOf = cid => db.prepare('SELECT id, nome, caminho, mime, tipo, tamanho, created_at FROM conteudo_arquivos WHERE conteudo_id = ? ORDER BY id').all(cid);

// resumo para os selos dos blocos: só blocos que ainda existem
export const listContents = pid => db.prepare(`
  SELECT c.node_id, c.titulo, c.updated_at, (SELECT COUNT(*) FROM conteudo_arquivos a WHERE a.conteudo_id = c.id) AS arquivos
  FROM conteudos c JOIN nodes n ON n.project_id = c.project_id AND n.id = c.node_id WHERE c.project_id = ?`).all(pid);

export function getContent(pid, nid) {
  const c = rowOf(pid, nid);
  if (!c) return null;
  return { id: c.id, node_id: c.node_id, titulo: c.titulo, corpo: c.corpo, created_at: c.created_at, updated_at: c.updated_at, arquivos: filesOf(c.id) };
}
export const getFile = (pid, nid, fid) => db.prepare(`
  SELECT a.* FROM conteudo_arquivos a JOIN conteudos c ON c.id = a.conteudo_id WHERE c.project_id = ? AND c.node_id = ? AND a.id = ?`).get(pid, String(nid), Number(fid));
export const absPath = abs;

/* ---------- validação dos arquivos ---------- */
const extOf = name => (String(name).match(/\.([A-Za-z0-9]{1,8})$/)?.[1] || '').toLowerCase();
const startsWith = (buf, sig, off = 0) => sig.every((b, i) => buf[off + i] === b);
function magicOk(ext, b) {
  if (ext === 'png') return startsWith(b, [0x89, 0x50, 0x4e, 0x47]);
  if (ext === 'jpg' || ext === 'jpeg') return startsWith(b, [0xff, 0xd8, 0xff]);
  if (ext === 'gif') return startsWith(b, [0x47, 0x49, 0x46, 0x38]);
  if (ext === 'webp') return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8);
  if (ext === 'bmp') return startsWith(b, [0x42, 0x4d]);
  if (ext === 'pdf') return b.subarray(0, 1024).includes('%PDF');
  return true;   // áudio e avif: confiamos na extensão (são servidos com Content-Type fixo e nosniff)
}
// decide o tipo: imagem/pdf/áudio pela extensão (e assinatura); qualquer outra coisa só entra se for texto
export function classify(nome, buf) {
  const ext = extOf(nome);
  for (const t of Object.keys(EXT)) {
    if (EXT[t].includes(ext)) {
      if (!magicOk(ext, buf)) throw new HttpError(400, `“${nome}” não é um ${t === 'pdf' ? 'PDF' : t} válido`);
      return { tipo: t, mime: MIME[ext] };
    }
  }
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) throw new HttpError(400, `“${nome}”: tipo não aceito (envie textos, imagens, PDFs ou áudios)`);
  return { tipo: 'texto', mime: 'text/plain; charset=utf-8' };
}
const safeName = n => String(n || 'arquivo').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 150) || 'arquivo';

/* ---------- salvar ---------- */
// files: [{ name, buf }] · remover: ids de arquivos a excluir · devolve o conteúdo completo
export function saveContent(pid, nid, userId, { titulo, corpo, files = [], remover = [] }) {
  if (!nodeExists(pid, nid)) throw new HttpError(404, 'bloco não encontrado');
  const t = String(titulo ?? '').trim().slice(0, LIMITS.titulo);
  const html = String(corpo ?? '');
  if (html.length > LIMITS.corpo) throw new HttpError(400, `O texto passa de ${LIMITS.corpo / 1024} KB`);

  let c = rowOf(pid, nid);
  const drop = new Set((remover || []).map(Number));
  const keep = c ? filesOf(c.id).filter(f => !drop.has(f.id)).length : 0;
  if (keep + files.length > LIMITS.arquivosPorBloco) throw new HttpError(400, `No máximo ${LIMITS.arquivosPorBloco} arquivos por bloco`);

  // valida tudo ANTES de gravar qualquer coisa
  const ready = files.map(f => {
    if (f.buf.length > LIMITS.arquivo) throw new HttpError(400, `“${f.name}” passa de ${LIMITS.arquivo / 1024 / 1024} MB`);
    if (!f.buf.length) throw new HttpError(400, `“${f.name}” está vazio`);
    return { ...f, ...classify(f.name, f.buf) };
  });

  if (!c) {
    const r = db.prepare('INSERT INTO conteudos (project_id, node_id, titulo, corpo, created_by) VALUES (?,?,?,?,?)').run(pid, String(nid), t, html, userId);
    c = { id: Number(r.lastInsertRowid) };
  } else {
    db.prepare('UPDATE conteudos SET titulo = ?, corpo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(t, html, c.id);
  }

  for (const f of filesOf(c.id).filter(x => drop.has(x.id))) {
    db.prepare('DELETE FROM conteudo_arquivos WHERE id = ?').run(f.id); rm(f.caminho);
  }
  const written = [];
  try {
    for (const f of ready) {
      const ext = extOf(f.name);
      const rel = path.posix.join(String(pid), String(c.id), crypto.randomBytes(12).toString('hex') + (ext ? '.' + ext : ''));
      fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
      fs.writeFileSync(abs(rel), f.buf); written.push(rel);
      db.prepare('INSERT INTO conteudo_arquivos (conteudo_id, project_id, nome, caminho, mime, tipo, tamanho) VALUES (?,?,?,?,?,?,?)')
        .run(c.id, pid, safeName(f.name), rel, f.mime, f.tipo, f.buf.length);
    }
  } catch (e) { written.forEach(rm); throw e; }
  return getContent(pid, nid);
}

export function deleteContent(pid, nid) {
  const c = rowOf(pid, nid);
  if (!c) return false;
  for (const f of filesOf(c.id)) rm(f.caminho);
  db.prepare('DELETE FROM conteudos WHERE id = ?').run(c.id);
  return true;
}
