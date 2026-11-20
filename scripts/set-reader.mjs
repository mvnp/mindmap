// Transforma um usuário em LEITOR (somente leitura: vê mapas e conteúdos, não edita NADA) ou volta ao normal.
// Uso (dentro do container):
//   docker exec mindmap node scripts/set-reader.mjs --email pessoa@exemplo.com        (vira leitor)
//   docker exec mindmap node scripts/set-reader.mjs --email pessoa@exemplo.com --off   (volta a poder editar)
// O master também pode alterar a coluna users.readonly (0/1) direto na tela "Banco de dados".
import { db } from '../lib/db.js';
import { findUserByEmail, destroyUserSessions } from '../lib/auth.js';

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const email = (arg('email') || '').toLowerCase(), off = process.argv.includes('--off');
if (!email) { console.error('Uso: node scripts/set-reader.mjs --email E [--off]'); process.exit(1); }
const u = findUserByEmail(email);
if (!u) { console.error('Usuário não encontrado: ' + email); process.exit(1); }
if (u.master && !off) { console.error('Um usuário master não pode ser leitor.'); process.exit(1); }
db.prepare('UPDATE users SET readonly = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(off ? 0 : 1, u.id);
console.log(off ? `${email} voltou a poder editar.` : `${email} agora é LEITOR (somente leitura).`);
