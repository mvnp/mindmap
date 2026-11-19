// Assistente de IA (servidor): chave da API por usuário (criptografada), preferências, cliente Anthropic e limite de uso.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { db, getProjectByUuid, canEditProject } from './db.js';
import { AuthError, rateLimit } from './auth.js';

export const MODELS = [
  { id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5 — o mais rápido e barato' },
  { id: 'claude-sonnet-5-5', nome: 'Claude Sonnet 5.5 — equilibrado (recomendado)' },
  { id: 'claude-opus-5-5', nome: 'Claude Opus 5.5 — mais capaz' },
  { id: 'claude-fable-5-2', nome: 'Claude Fable 5.2 — o mais capaz (e o mais caro)' },
];
export const EFFORTS = [
  { id: 'low', nome: 'Rápido' },
  { id: 'medium', nome: 'Equilibrado' },
  { id: 'high', nome: 'Profundo' },
];
const MODEL_IDS = new Set(MODELS.map(m => m.id)), EFFORT_IDS = new Set(EFFORTS.map(e => e.id));
export const MAX_PROMPT = 6000;

/* ---------- criptografia da chave (AES-256-GCM) ---------- */
// Segredo: AI_ENC_SECRET (recomendado, fora do banco). Sem ele, um segredo aleatório é gerado e guardado na tabela app_secrets.
function secretKey() {
  const env = process.env.AI_ENC_SECRET;
  if (env && env.length >= 16) return crypto.createHash('sha256').update(env).digest();
  let row = db.prepare("SELECT secret_value FROM app_secrets WHERE name = 'ai_enc'").get();
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO app_secrets (name, secret_value) VALUES ('ai_enc', ?)").run(crypto.randomBytes(32).toString('hex'));
    row = db.prepare("SELECT secret_value FROM app_secrets WHERE name = 'ai_enc'").get();
  }
  return Buffer.from(row.secret_value, 'hex');
}
const encrypt = plain => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
};
const decrypt = b64 => {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
};

/* ---------- preferências ---------- */
const row = userId => db.prepare('SELECT * FROM ai_settings WHERE user_id = ?').get(userId);

// o que vai para o navegador: nunca a chave, só uma dica (últimos 4 caracteres)
export function publicSettings(userId) {
  const r = row(userId);
  return {
    temChave: !!r?.api_key_enc,
    dicaChave: r?.api_key_hint || null,
    model: r?.model || 'claude-sonnet-5-5',
    effort: r?.effort || 'medium',
    prompt: r?.prompt || '',
    models: MODELS, efforts: EFFORTS, maxPrompt: MAX_PROMPT,
  };
}

// b: { apiKey?: string (vazio/ausente = mantém), model?, effort?, prompt?, removerChave?: boolean }
export function saveSettings(userId, b) {
  const cur = row(userId);
  const model = b.model !== undefined ? String(b.model) : (cur?.model || 'claude-sonnet-5-5');
  const effort = b.effort !== undefined ? String(b.effort) : (cur?.effort || 'medium');
  const prompt = b.prompt !== undefined ? String(b.prompt) : (cur?.prompt || '');
  if (!MODEL_IDS.has(model)) throw new AuthError(400, 'Modelo inválido');
  if (!EFFORT_IDS.has(effort)) throw new AuthError(400, 'Nível de raciocínio inválido');
  if (prompt.length > MAX_PROMPT) throw new AuthError(400, `O prompt passa de ${MAX_PROMPT} caracteres`);
  let enc = cur?.api_key_enc ?? null, hint = cur?.api_key_hint ?? null;
  const key = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
  if (b.removerChave) { enc = null; hint = null; }
  if (key) {
    if (!/^sk-ant-[\w-]{10,300}$/.test(key)) throw new AuthError(400, 'Chave inválida: ela deve começar com "sk-ant-" e não ter espaços');
    enc = encrypt(key); hint = `sk-ant-…${key.slice(-4)}`;
  }
  db.prepare(`INSERT INTO ai_settings (user_id, api_key_enc, api_key_hint, model, effort, prompt) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET api_key_enc = excluded.api_key_enc, api_key_hint = excluded.api_key_hint, model = excluded.model,
      effort = excluded.effort, prompt = excluded.prompt, updated_at = CURRENT_TIMESTAMP`).run(userId, enc, hint, model, effort, prompt);
  return publicSettings(userId);
}

/* ---------- cliente ---------- */
export function clientFor(userId) {
  const r = row(userId);
  if (!r?.api_key_enc) throw new AuthError(400, 'Cadastre sua chave da API no Setup (⚙) do assistente.');
  let apiKey;
  try { apiKey = decrypt(r.api_key_enc); } catch { throw new AuthError(400, 'Não foi possível ler a chave salva. Cadastre-a de novo no Setup (⚙).'); }
  // ANTHROPIC_BASE_URL só existe para testes (servidor falso); em produção fica vazio
  return { client: new Anthropic({ apiKey, baseURL: process.env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1 }), settings: r };
}

// limite de uso por usuário (em memória): evita loop descontrolado gastando a chave
export const aiRateLimit = userId => rateLimit(`ai:${userId}`, 120, 600);

// erro do SDK → mensagem em português para a tela
export function friendlyError(e) {
  const status = e?.status;
  const msg = String(e?.error?.error?.message || e?.message || e);
  // atenção: nunca devolver 401 ao navegador por erro da Anthropic — 401 significa "sessão do app expirada" e leva ao login
  if (status === 401) return { status: 422, error: 'A Anthropic recusou a chave (401). Confira a chave no Setup (⚙).' };
  if (status === 403) return { status: 422, error: 'A chave não tem permissão para usar este modelo (403). Troque o modelo no Setup (⚙).' };
  if (status === 404) return { status: 422, error: `Modelo não encontrado para esta chave. Troque o modelo no Setup (⚙). (${msg})` };
  if (status === 429) return { status: 429, error: 'Limite de uso da API atingido (429). Aguarde um pouco e tente de novo.' };
  if (status === 400 && /credit balance/i.test(msg)) return { status: 402, error: 'Sua conta da Anthropic está sem créditos. Adicione créditos em console.anthropic.com.' };
  if (status >= 500) return { status: 502, error: `A API da Anthropic está instável (${status}). Tente de novo em instantes.` };
  if (status) return { status: 400, error: `A API recusou o pedido: ${msg}` };
  return { status: 502, error: `Não foi possível falar com a API da Anthropic: ${msg}` };
}

/* ---------- consumo de tokens (tabela ai_usage: um registro por prompt) ---------- */
// US$ por milhão de tokens (entrada / saída / leitura de cache). ESTIMATIVA: confira os preços atuais em anthropic.com/pricing.
// Escrita no cache = 1,25 × entrada. (Haiku acima de 100 mil tokens de prompt custa mais; não considerado.)
const PRICES = {
  'claude-haiku-5-5': { i: 0.10, o: 0.50, cr: 0.01 },
  'claude-sonnet-5-5': { i: 2, o: 10, cr: 0.10 },
  'claude-opus-5-5': { i: 4, o: 20, cr: 0.20 },
  'claude-fable-5-2': { i: 8, o: 40, cr: 0.20 },
};
// u: { input (só os novos), cw (escrita no cache), cr (leitura do cache), out }
export function estimateCost(model, u) {
  const p = PRICES[model]; if (!p) return 0;
  return (u.input * p.i + u.cw * p.i * 1.25 + u.cr * p.cr + u.out * p.o) / 1e6;
}

const projectIdOf = (userId, projectUuid) => {
  try { const p = projectUuid ? getProjectByUuid(projectUuid) : null; return p && canEditProject(userId, p.id) ? p.id : null; } catch { return null; }
};
const validRun = runId => /^[\w-]{8,64}$/.test(String(runId || ''));

// soma os tokens de UMA chamada à API ao registro do prompt (cria o registro na primeira chamada).
// UPDATE primeiro e INSERT só se não existir: um INSERT ... ON CONFLICT gastaria um número de id a cada atualização.
export function recordUsage({ userId, runId, projectUuid, prompt, model, effort, usage }) {
  if (!validRun(runId)) return;
  const u = { input: usage.in || 0, cw: usage.cw || 0, cr: usage.cr || 0, out: usage.out || 0 };
  const total = u.input + u.cw + u.cr, cost = estimateCost(model, u);
  const r = db.prepare(`UPDATE ai_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_write_tokens = cache_write_tokens + ?,
      cache_read_tokens = cache_read_tokens + ?, calls = calls + 1, cost_usd = cost_usd + ?, updated_at = CURRENT_TIMESTAMP WHERE run_id = ? AND user_id = ?`)
    .run(total, u.out, u.cw, u.cr, cost, String(runId), userId);
  if (Number(r.changes) > 0) return;
  db.prepare(`INSERT OR IGNORE INTO ai_usage (run_id, user_id, project_id, prompt, model, effort, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, calls, cost_usd)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`)
    .run(String(runId), userId, projectIdOf(userId, projectUuid), String(prompt || '').slice(0, 2000), model, effort || null, total, u.out, u.cw, u.cr, cost);
}

const STATUSES = new Set(['concluido', 'parado', 'erro', 'limite']);
// o navegador informa como o prompt terminou. Pode chegar ANTES de o servidor terminar de registrar a chamada que acabou de ser
// cancelada (parar no meio): por isso, se o registro ainda não existe, ele é criado aqui (e a chamada atrasada soma depois).
export function endRun(userId, runId, { status, error, tools, project, prompt }) {
  if (!STATUSES.has(status)) throw new AuthError(400, 'status inválido');
  if (!validRun(runId)) return false;
  const err = error ? String(error).slice(0, 500) : null, nt = Math.max(0, Math.min(100000, Number(tools) || 0));
  const r = db.prepare('UPDATE ai_usage SET status = ?, error = ?, tool_calls = ?, updated_at = CURRENT_TIMESTAMP WHERE run_id = ? AND user_id = ?')
    .run(status, err, nt, String(runId), userId);
  if (Number(r.changes) > 0) return true;
  const st = row(userId);
  const ins = db.prepare(`INSERT OR IGNORE INTO ai_usage (run_id, user_id, project_id, prompt, model, effort, status, error, tool_calls, calls)
    VALUES (?,?,?,?,?,?,?,?,?,0)`)
    .run(String(runId), userId, projectIdOf(userId, project), String(prompt || '').slice(0, 2000), st?.model || 'claude-sonnet-5-5', st?.effort || null, status, err, nt);
  return Number(ins.changes) > 0;
}

// resumo e últimos prompts do próprio usuário (a tela de Setup)
export function usageSummary(userId) {
  const agg = since => db.prepare(`SELECT COUNT(*) AS prompts, COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output,
      COALESCE(SUM(cache_read_tokens),0) AS cache_read, COALESCE(SUM(cost_usd),0) AS cost FROM ai_usage WHERE user_id = ? AND created_at >= datetime('now', ?)`).get(userId, since);
  const ultimos = db.prepare(`SELECT u.id, u.prompt, u.model, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.calls, u.tool_calls, u.status, u.cost_usd, u.created_at, u.updated_at, p.name AS projeto
      FROM ai_usage u LEFT JOIN projects p ON p.id = u.project_id WHERE u.user_id = ? ORDER BY u.id DESC LIMIT 12`).all(userId);
  return { h24: agg('-1 day'), d30: agg('-30 day'), ultimos };
}
