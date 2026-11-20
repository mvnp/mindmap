// Motor do agente (navegador): conversa em streaming com /api/ai/chat e executa as ferramentas assim que cada
// chamada chega completa — o mapa vai sendo montado ENQUANTO o modelo ainda está escrevendo.
import { StopError } from './executor';

const MAX_STEPS = 30;   // voltas de ferramenta por pedido

/* ---------- histórico sempre válido ----------
   A API exige: todo tool_use de uma mensagem do assistente tem o tool_result correspondente na mensagem SEGUINTE,
   os tool_result vêm antes de qualquer texto, e não pode haver tool_result sem o tool_use antes dele.
   repairHistory conserta o que estiver fora disso (stream cortado, aba fechada no meio, versão antiga do chat…). */
const asArray = c => (typeof c === 'string' ? [{ type: 'text', text: c }] : (c || []));
const synthResult = id => ({ type: 'tool_result', tool_use_id: id, is_error: true, content: 'Não executada: a resposta foi interrompida antes de esta ação terminar (conexão, tempo esgotado ou parada).' });

export function repairHistory(messages) {
  let fixed = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant') {
      const ids = asArray(m.content).filter(b => b.type === 'tool_use').map(b => b.id);
      if (!ids.length) continue;
      const next = messages[i + 1];
      if (!next || next.role !== 'user') { messages.splice(i + 1, 0, { role: 'user', content: ids.map(synthResult) }); fixed++; continue; }
      const blocks = asArray(next.content), have = new Set(blocks.filter(b => b.type === 'tool_result').map(b => b.tool_use_id));
      const missing = ids.filter(id => !have.has(id));
      if (missing.length) { next.content = [...missing.map(synthResult), ...blocks]; fixed++; }
    } else if (m.role === 'user') {
      const prev = messages[i - 1];
      const pids = new Set(asArray(prev?.role === 'assistant' ? prev.content : []).filter(b => b.type === 'tool_use').map(b => b.id));
      const blocks = asArray(m.content);
      // tool_result órfão sai; os válidos vão para o início (antes de qualquer texto)
      const results = blocks.filter(b => b.type === 'tool_result' && pids.has(b.tool_use_id));
      const others = blocks.filter(b => b.type !== 'tool_result');
      const orphan = blocks.length - results.length - others.length;
      const misordered = blocks.slice(0, results.length).some(b => b.type !== 'tool_result');
      if (orphan || misordered) {
        const next = [...results, ...others];
        m.content = next.length ? next : [{ type: 'text', text: '(mensagem antiga removida)' }];
        fixed++;
      }
    }
  }
  return fixed;
}

// lê o SSE de um passo. Devolve { content, stop_reason, truncated, error }.
// content = só os blocos COMPLETOS (um tool_use que não terminou jamais entra: a API exigiria o resultado dele).
// truncated = o stream acabou antes do message_stop (timeout de proxy, conexão caiu, erro no meio): o que já chegou é aproveitado.
async function streamTurn({ messages, run, scope, signal, onText, onThinking, onToolBlock }) {
  const r = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, run, scope }), signal });
  if (r.status === 401) { window.location.href = '/login'; throw new Error('sessão expirada'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `erro ${r.status}`);

  const blocks = [], json = {}, finished = new Set();
  let stop_reason = null, buf = '', gotStop = false, streamError = null;
  const dec = new TextDecoder(), reader = r.body.getReader();

  const handle = (type, d) => {
    if (type === 'content_block_start') {
      blocks[d.index] = { ...d.content_block };
      if (d.content_block.type === 'tool_use') json[d.index] = '';
      if (d.content_block.type === 'thinking') onThinking?.(true);
    } else if (type === 'content_block_delta') {
      const b = blocks[d.index]; if (!b) return;
      const x = d.delta;
      if (x.type === 'text_delta') { b.text = (b.text || '') + x.text; onText?.(x.text); }
      else if (x.type === 'input_json_delta') json[d.index] += x.partial_json;
      else if (x.type === 'thinking_delta') b.thinking = (b.thinking || '') + x.thinking;
      else if (x.type === 'signature_delta') b.signature = x.signature;
    } else if (type === 'content_block_stop') {
      const b = blocks[d.index]; if (!b) return;
      finished.add(d.index);
      if (b.type === 'tool_use') {
        try { b.input = json[d.index] ? JSON.parse(json[d.index]) : {}; } catch { b.input = {}; b._invalid = true; }
        onToolBlock?.(b);
      }
      if (b.type === 'thinking') onThinking?.(false);
    } else if (type === 'message_delta') {
      if (d.delta?.stop_reason) stop_reason = d.delta.stop_reason;
    } else if (type === 'message_stop') {
      gotStop = true;
    } else if (type === 'error') {
      throw new Error(d.error?.message || 'erro na API');
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        let ev = '', data = '';
        for (const line of raw.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
        if (!data) continue;
        handle(ev, JSON.parse(data));
      }
    }
  } catch (e) {
    if (signal.aborted || e?.name === 'AbortError') throw e;   // parada do usuário: tratada por quem chamou
    streamError = e?.message || String(e);                       // queda/erro no meio: aproveita o que já chegou
  }

  // só blocos completos voltam ao histórico (texto parcial é válido; tool_use/thinking incompletos não)
  const content = [];
  blocks.forEach((b, idx) => {
    if (!b) return;
    if (b.type === 'text') { if (b.text) content.push(b); return; }
    if (!finished.has(idx)) return;
    const { _invalid, ...rest } = b;
    content.push(rest);
  });
  return { content, stop_reason, truncated: !gotStop, error: streamError };
}

const toolResultBlock = (id, res) => {
  const content = res.image
    ? [{ type: 'image', source: { type: 'base64', media_type: res.image.media_type, data: res.image.data } }, { type: 'text', text: res.text }]
    : res.text;
  return { type: 'tool_result', tool_use_id: id, content, ...(res.isError ? { is_error: true } : {}) };
};

// h: { messages (array mutável), run: { id, project, prompt } (registro de consumo), signal, exec(name,input) → resultado, gate(), onText, onThinking, onAction(label,res), onNote(texto) }
// Retorna { status: 'done'|'stopped'|'error'|'max_steps', error? }
export async function runAgent(h) {
  const { messages, signal } = h;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // antes de CADA chamada: o histórico precisa estar válido (conserta o que vier quebrado de versões/sessões antigas)
      if (repairHistory(messages)) h.onNote?.('Histórico da conversa consertado automaticamente.');
      const results = new Map();
      let queue = Promise.resolve();
      h.onTextReset?.();
      let turn;
      try {
        turn = await streamTurn({
          messages, run: h.run, scope: h.scope, signal, onText: h.onText, onThinking: h.onThinking,
          // cada ferramenta entra numa fila e roda na ordem, já durante o streaming
          onToolBlock: b => {
            const p = queue.then(async () => {
              if (b._invalid) return { text: 'Erro: os argumentos da chamada chegaram incompletos (JSON inválido). Refaça a chamada.', isError: true };
              try {
                await h.gate();
                const res = await h.exec(b.name, b.input);
                h.onAction?.(res.label || b.name, res);   // aparece no chat assim que a ação termina
                return res;
              } catch (e) { if (e?.stop || signal.aborted) return { cancelled: true }; return { text: `Erro: ${e?.message || e}`, isError: true }; }
            });
            queue = p.catch(() => {});
            results.set(b.id, p);
          },
        });
      } catch (e) {
        if (signal.aborted || e?.name === 'AbortError') { await Promise.allSettled(results.values()); return { status: 'stopped', partial: true }; }
        throw e;
      }
      h.onThinking?.(false);
      await Promise.allSettled(results.values());   // espera o fim das animações deste passo

      const toolCalls = turn.content.filter(b => b.type === 'tool_use');
      // os resultados são montados ANTES de gravar qualquer mensagem: o par assistente + tool_results entra junto ou não entra
      const out = [];
      let stopped = signal.aborted;
      for (const b of toolCalls) {
        const res = await (results.get(b.id) ?? Promise.resolve({ text: 'Não executada: a chamada não chegou completa.', isError: true }));
        if (res?.cancelled) { stopped = true; out.push(toolResultBlock(b.id, { text: 'Cancelado: o usuário parou o trabalho antes desta ação.', isError: true })); continue; }
        out.push(toolResultBlock(b.id, res || { text: 'Sem resultado.', isError: true }));
      }
      if (turn.content.length) messages.push({ role: 'assistant', content: turn.content });
      if (out.length) messages.push({ role: 'user', content: out });

      if (turn.truncated && !stopped) {
        h.onNote?.(turn.error ? `A conexão com a IA caiu no meio da resposta (${turn.error}).` : 'A resposta da IA foi interrompida no meio (conexão encerrada ou tempo esgotado).');
        if (!toolCalls.length) return { status: 'error', error: 'A resposta foi interrompida antes de terminar. Use ▶ Retomar para continuar.' };
        // houve ações completas: segue em frente, o modelo vê os resultados e continua o trabalho
      }
      if (!toolCalls.length) {
        if (turn.stop_reason === 'refusal') h.onNote?.('A IA recusou este pedido.');
        else if (turn.stop_reason === 'max_tokens') h.onNote?.('A resposta foi cortada por tamanho. Peça para continuar.');
        return { status: 'done' };
      }
      if (stopped) return { status: 'stopped' };
    }
    return { status: 'max_steps' };
  } catch (e) {
    return { status: 'error', error: e?.message || String(e) };
  }
}

export { StopError };
