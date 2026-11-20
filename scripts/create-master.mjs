// Cria (ou atualiza) o usuário master e vincula a ele os projetos que ainda não têm dono.
// Uso (dentro do container):
//   docker exec -e MASTER_PASSWORD='sua-senha' mindmap node scripts/create-master.mjs --nome Marcos --sobrenome Pereira --email voce@exemplo.com
// A senha vem da variável de ambiente MASTER_PASSWORD e é gravada apenas como hash (scrypt).
import { db } from '../lib/db.js';
import { createUser, findUserByEmail, setPassword, validatePassword } from '../lib/auth.js';

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const nome = arg('nome'), sobrenome = arg('sobrenome'), email = (arg('email') || '').toLowerCase(), senha = process.env.MASTER_PASSWORD;

if (!nome || !sobrenome || !email || !senha) {
  console.error('Uso: MASTER_PASSWORD=... node scripts/create-master.mjs --nome N --sobrenome S --email E');
  process.exit(1);
}
validatePassword(senha);

let u = findUserByEmail(email);
let id;
if (u) {
  id = u.id;
  setPassword(id, senha);
  db.prepare('UPDATE users SET nome = ?, sobrenome = ?, master = 1, readonly = 0, verificado = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nome, sobrenome, id);
  console.log(`Usuário existente atualizado como master: ${email}`);
} else {
  id = createUser({ nome, sobrenome, email, telefone: null, senha, verificado: true, master: true });
  console.log(`Usuário master criado: ${email}`);
}
const r = db.prepare('UPDATE projects SET user_id = ? WHERE user_id IS NULL').run(id);
console.log(`${r.changes} projeto(s) sem dono vinculados a este usuário.`);
