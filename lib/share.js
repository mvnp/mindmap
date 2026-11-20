// Convites para editar projetos: envio, consulta, cadastro pelo convite e aceite.
import crypto from 'node:crypto';
import { db, createStarterProjects, HttpError } from './db.js';
import { AuthError, sha256, findUserByEmail, createUser, validateRegister, createAuthToken } from './auth.js';
import { sendMail, linkMail } from './mailer.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL = 7 * 24 * 3600;
const now = () => Math.floor(Date.now() / 1000);

// divide texto livre em e-mails (vírgula, ponto e vírgula, espaço ou quebra de linha)
export const parseEmails = v => [...new Set((Array.isArray(v) ? v.join(',') : String(v || '')).split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean))];

export async function createInvites({ project, inviter, emails, base }) {
  const enviados = [], ignorados = [];
  for (const email of emails.slice(0, 20)) {
    if (!EMAIL_RE.test(email) || email.length > 254) { ignorados.push({ email, motivo: 'e-mail inválido' }); continue; }
    if (email === String(inviter.email).toLowerCase()) { ignorados.push({ email, motivo: 'é o seu próprio e-mail' }); continue; }
    const u = findUserByEmail(email);
    if (u && (u.id === project.user_id || db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(project.id, u.id))) {
      ignorados.push({ email, motivo: 'já tem acesso' }); continue;
    }
    db.prepare("DELETE FROM project_invites WHERE project_id = ? AND email = ? AND status = 'pendente'").run(project.id, email);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO project_invites (project_id, email, token_hash, invited_by, expires_at) VALUES (?,?,?,?,?)')
      .run(project.id, email, sha256(token), inviter.id, now() + INVITE_TTL);
    const ok = await sendMail({ to: email, subject: `${inviter.nome} convidou você para um projeto no Mindmap`, ...linkMail({
      titulo: 'Você foi convidado(a) para um projeto',
      texto: `${inviter.nome} ${inviter.sobrenome} convidou você para acessar o projeto "${project.name}" no Mindmap (como leitor; o dono pode liberar a edição). O convite vale por 7 dias. Você também o encontra na caixa de notificações do painel.`,
      botao: 'Aceitar convite', link: `${base}/convite?token=${token}` }) });
    if (ok) enviados.push(email); else ignorados.push({ email, motivo: 'falha ao enviar o e-mail' });
  }
  return { enviados, ignorados };
}

function pendingInvite(token) {
  return db.prepare(`SELECT i.*, p.name AS projeto, p.uuid, u.nome AS inv_nome, u.sobrenome AS inv_sobrenome
    FROM project_invites i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.invited_by
    WHERE i.token_hash = ? AND i.status = 'pendente' AND i.expires_at > ?`).get(sha256(String(token || '')), now());
}

export function inviteInfo(token) {
  const i = pendingInvite(token);
  if (!i) throw new AuthError(404, 'Convite inválido, expirado ou já utilizado');
  return { email: i.email, projeto: i.projeto, convidadoPor: `${i.inv_nome} ${i.inv_sobrenome}`, contaExistente: !!findUserByEmail(i.email) };
}

function addMember(i, userId) {
  db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, papel) VALUES (?, ?, 'leitor')").run(i.project_id, userId);   // quem é convidado entra como LEITOR; o dono pode promover a editor
  db.prepare("UPDATE project_invites SET status = 'aceito', accepted_user_id = ? WHERE id = ?").run(userId, i.id);
}

// Cadastro a partir do convite: e-mail fixo (o do convite), conta nasce NÃO verificada e recebe o link de confirmação.
export async function registerViaInvite(token, body, base) {
  const i = pendingInvite(token);
  if (!i) throw new AuthError(404, 'Convite inválido, expirado ou já utilizado');
  if (findUserByEmail(i.email)) throw new AuthError(409, 'Já existe uma conta com este e-mail. Entre para aceitar o convite.');
  const v = validateRegister({ ...body, email: i.email });
  const id = createUser({ ...v, verificado: false, master: false });
  createStarterProjects(id);
  addMember(i, id);
  const vt = createAuthToken(id, 'verificacao', 7 * 24 * 3600);
  await sendMail({ to: v.email, subject: 'Confirme seu e-mail', ...linkMail({
    titulo: `Olá, ${v.nome}! Confirme seu e-mail`, texto: 'Seu cadastro foi criado. Clique no botão abaixo para confirmar o seu e-mail e poder entrar.',
    botao: 'Confirmar e-mail', link: `${base}/verificar?token=${vt}` }) });
}

// Usuário já cadastrado (logado) aceita o convite: o e-mail da conta precisa ser o do convite.
export function acceptInvite(token, user) {
  const i = pendingInvite(token);
  if (!i) throw new AuthError(404, 'Convite inválido, expirado ou já utilizado');
  if (String(user.email).toLowerCase() !== String(i.email).toLowerCase()) throw new AuthError(403, `Este convite é para ${i.email}. Entre com essa conta.`);
  addMember(i, user.id);
  return { uuid: i.uuid };
}

// ---- Caixa de notificações: convites pendentes endereçados ao e-mail da conta logada (não depende do e-mail enviado)
const ownInvite = (id, user) => db.prepare(`SELECT i.*, p.uuid FROM project_invites i JOIN projects p ON p.id = i.project_id
  WHERE i.id = ? AND i.status = 'pendente' AND i.expires_at > ? AND i.email = ?`).get(Number(id), now(), String(user.email));

export function listNotifications(user) {
  return db.prepare(`SELECT i.id, i.expires_at, p.name AS projeto, p.uuid, u.nome AS inv_nome, u.sobrenome AS inv_sobrenome
    FROM project_invites i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.invited_by
    WHERE i.email = ? AND i.status = 'pendente' AND i.expires_at > ? AND i.invited_by != ? ORDER BY i.id DESC`).all(String(user.email), now(), user.id)
    .map(r => ({ id: r.id, projeto: r.projeto, uuid: r.uuid, convidadoPor: `${r.inv_nome} ${r.inv_sobrenome}`, papel: 'leitor', expira: r.expires_at }));
}

export function acceptNotification(id, user) {
  const i = ownInvite(id, user);
  if (!i) throw new AuthError(404, 'Convite inválido, expirado ou já respondido');
  addMember(i, user.id);
  return { uuid: i.uuid };
}

export function declineNotification(id, user) {
  const i = ownInvite(id, user);
  if (!i) throw new AuthError(404, 'Convite inválido, expirado ou já respondido');
  db.prepare('DELETE FROM project_invites WHERE id = ?').run(i.id);
  return { ok: true };
}
