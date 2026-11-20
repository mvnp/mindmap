'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runAgent, repairHistory, StopError } from './ai/agent';
import { fileToImage } from './ai/screenshot';

const MAX_DOCS = 5, MAX_DOC_BYTES = 200 * 1024, MAX_DOCS_TOTAL = 400 * 1024;
const SPEEDS = [
  { id: 'slow', nome: 'Lento', m: 1.5 },
  { id: 'normal', nome: 'Normal', m: 0.55 },
  { id: 'fast', nome: 'Rápido', m: 0.2 },
  { id: 'instant', nome: 'Instantâneo', m: 0 },
];
const jsonHeaders = { 'Content-Type': 'application/json' };
const imgBlock = s => ({ type: 'image', source: { type: 'base64', media_type: s.media_type, data: s.data } });
const asBlocks = c => (typeof c === 'string' ? [{ type: 'text', text: c }] : c);
const OMIT = { type: 'text', text: '[imagem omitida]' };
const fmt = n => Number(n || 0).toLocaleString('pt-BR');
const usd = n => `US$ ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 0.1 ? 4 : 2 })}`;
const when = t => { try { return new Date(String(t).replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return t; } };

// histórico guardado no navegador: sem imagens e sem blocos de raciocínio, e só o final da conversa
function sanitize(msgs) {
  const clean = c => (typeof c === 'string' ? c : c.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking').map(b => (
    b.type === 'image' ? OMIT
      : b.type === 'tool_result' && Array.isArray(b.content) ? { ...b, content: b.content.map(x => (x.type === 'image' ? OMIT : x)) }
        : b)));
  return msgs.map(m => ({ role: m.role, content: clean(m.content) })).filter(m => (typeof m.content === 'string' ? m.content : m.content.length));
}
function trimHistory(msgs, max) {
  if (msgs.length <= max) return msgs;
  for (let i = msgs.length - max; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'user' && !(Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'))) return msgs.slice(i);
  }
  return msgs;
}

/* ---------- setup: chave da API, modelo, raciocínio e prompt ---------- */
function Setup({ settings, onClose, onSaved }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(settings.model);
  const [effort, setEffort] = useState(settings.effort);
  const [prompt, setPrompt] = useState(settings.prompt || '');
  const [msg, setMsg] = useState(null);   // { t, ok }
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState(null);
  useEffect(() => { fetch('/api/ai/usage').then(r => r.json()).then(setUsage).catch(() => {}); }, []);

  const save = async extra => {
    const r = await fetch('/api/ai/settings', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ apiKey: key, model, effort, prompt, ...extra }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Falha ao salvar');
    setKey(''); onSaved(d); return d;
  };
  const run = async fn => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ t: e.message, ok: false }); } setBusy(false); };

  return (
    <div className="modal-bg ui" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal ai-setup">
        <h3>⚙ Setup do assistente de IA</h3>
        <label className="ai-f">Chave da API (API key) da Anthropic
          <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)}
            placeholder={settings.temChave ? `Salva: ${settings.dicaChave} — deixe em branco para manter` : 'sk-ant-…'} />
          <small>Guardada criptografada no servidor e usada só por você. Nunca volta ao navegador. Crie uma em console.anthropic.com.</small>
        </label>
        <div className="ai-row">
          <label className="ai-f">Modelo
            <select value={model} onChange={e => setModel(e.target.value)}>{settings.models.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
          </label>
          <label className="ai-f">Raciocínio
            <select value={effort} onChange={e => setEffort(e.target.value)}>{settings.efforts.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
          </label>
        </div>
        <label className="ai-f">Prompt (instruções permanentes)
          <textarea value={prompt} maxLength={settings.maxPrompt} onChange={e => setPrompt(e.target.value)}
            placeholder={'Ex.: Escreva sempre em português do Brasil. Use no máximo 5 ramos principais. Prefira verbos no infinitivo.'} />
          <small>Entra no prompt de sistema de toda conversa, junto com as regras do mapa. {prompt.length}/{settings.maxPrompt}</small>
        </label>
        {usage && (
          <div className="ai-usage">
            <b>Consumo de tokens</b>
            <div className="ai-uh"><span>Últimas 24 h</span><span>{fmt(usage.h24.prompts)} prompts · entrada {fmt(usage.h24.input)} · saída {fmt(usage.h24.output)} · ~{usd(usage.h24.cost)}</span></div>
            <div className="ai-uh"><span>Últimos 30 dias</span><span>{fmt(usage.d30.prompts)} prompts · entrada {fmt(usage.d30.input)} · saída {fmt(usage.d30.output)} · ~{usd(usage.d30.cost)}</span></div>
            {usage.ultimos.length > 0 && (
              <div className="ai-ut">
                {usage.ultimos.map(u => (
                  <div key={u.id} title={`${u.prompt}

Chamadas: ${u.calls} · ações: ${u.tool_calls} · cache lido: ${fmt(u.cache_read_tokens)} · ${u.status}`}>
                    <span className="ai-up">{u.prompt || '—'}</span>
                    <span>{fmt(u.input_tokens)} → {fmt(u.output_tokens)}</span>
                    <small>{when(u.created_at)}</small>
                  </div>
                ))}
              </div>
            )}
            <small>Entrada inclui o que veio do cache. O valor em dólar é uma estimativa; vale a cobrança da sua conta Anthropic.</small>
          </div>
        )}
        <div className="modal-actions">
          <span className="msg" style={msg ? { color: msg.ok ? '#1d7a4f' : '#b3402a' } : undefined}>{msg?.t}</span>
          {settings.temChave && <button disabled={busy} onClick={() => run(async () => { await save({ removerChave: true, apiKey: '' }); setMsg({ t: 'Chave removida', ok: true }); })}>Remover chave</button>}
          <button disabled={busy} onClick={() => run(async () => {
            await save();
            const d = await (await fetch('/api/ai/test', { method: 'POST' })).json();
            setMsg(d.ok ? { t: `Conectado ✓ (${d.modelo})`, ok: true } : { t: d.error || 'Falha na conexão', ok: false });
          })}>Salvar e testar</button>
          <button className="primary" disabled={busy} onClick={() => run(async () => { await save(); onClose(); })}>Salvar</button>
          <button disabled={busy} onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- chat ---------- */
// api: ref para { readOnly, context(), screenshot(full), exec(name,input,rt), begin(), end(), reset() } (fornecido pelo MindMap)
export default function AiAssistant({ api, storageKey, panelOpen, onExpandedChange, scope = 'map' }) {
  const isDb = scope === 'db';                       // chat do banco de dados (master): mesmas regras, ferramentas e tela diferentes
  const K = isDb ? 'mm:ai:db:' : 'mm:ai:';
  const [undoable, setUndoable] = useState(false);   // a missão atual alterou o banco e ainda pode ser desfeita
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem('mm:ai:wide') === '1'; } catch { return false; } });
  const toggleWide = () => setWide(w => { const v = !w; try { localStorage.setItem('mm:ai:wide', v ? '1' : '0'); } catch {} return v; });
  const [settings, setSettings] = useState(null);
  const [setup, setSetup] = useState(false);
  const [log, setLog] = useState([]);
  const [input, setInput] = useState('');
  const [atts, setAtts] = useState([]);
  const [docs, setDocs] = useState([]);      // arquivos de texto anexados: { name, text, size }
  const [attMsg, setAttMsg] = useState('');
  const [autoShot, setAutoShot] = useState(true);
  const [speed, setSpeed] = useState('normal');
  const [status, setStatus] = useState('idle');     // idle | running | paused
  const [thinking, setThinking] = useState(false);
  const [interrupted, setInterrupted] = useState(false);

  const messages = useRef([]);
  const abortRef = useRef(null);
  const pausedRef = useRef(false), stoppedRef = useRef(false), waiters = useRef([]);
  const speedRef = useRef('normal'); speedRef.current = speed;
  const acts = useRef([]);
  const runRef = useRef({ id: null, prompt: '' });   // prompt em andamento (registro de consumo no servidor)
  const seq = useRef(1);
  const logEnd = useRef(null), fileIn = useRef(null);

  const push = useCallback(item => setLog(l => [...l, { id: seq.current++, ...item }].slice(-300)), []);
  const appendAi = useCallback(delta => setLog(l => {
    const last = l[l.length - 1];
    if (last && last.k === 'ai' && last.live) return [...l.slice(0, -1), { ...last, t: last.t + delta }];
    return [...l, { id: seq.current++, k: 'ai', live: true, t: delta }].slice(-300);
  }), []);
  const closeAi = useCallback(() => setLog(l => (l.length && l[l.length - 1].live ? [...l.slice(0, -1), { ...l[l.length - 1], live: false }] : l)), []);

  /* carregar preferências e conversa guardada */
  useEffect(() => {
    fetch('/api/ai/settings').then(r => r.json()).then(setSettings).catch(() => {});
    try {
      setOpen(localStorage.getItem(K + 'open') === '1');
      setAutoShot(localStorage.getItem('mm:ai:shot') !== '0');
      const sp = localStorage.getItem('mm:ai:speed'); if (SPEEDS.some(s => s.id === sp)) setSpeed(sp);
      const d = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (d?.v === 1) { messages.current = sanitize(d.messages || []); repairHistory(messages.current); setLog(d.log || []); seq.current = (d.log?.at(-1)?.id || 0) + 1; }
    } catch {}
  }, [storageKey, K]);
  useEffect(() => { onExpandedChange?.(open); try { localStorage.setItem(K + 'open', open ? '1' : '0'); } catch {} }, [open, onExpandedChange, K]);
  useEffect(() => { try { localStorage.setItem('mm:ai:shot', autoShot ? '1' : '0'); localStorage.setItem('mm:ai:speed', speed); } catch {} }, [autoShot, speed]);
  // guarda a conversa (sem imagens) quando o chat fica parado
  useEffect(() => {
    if (status !== 'idle') return;
    try {
      const saved = sanitize(trimHistory(messages.current, 40)); repairHistory(saved);   // nunca guarda um histórico que a API recusaria
      localStorage.setItem(storageKey, JSON.stringify({ v: 1, messages: saved, log: log.slice(-100).map(({ img, ...r }) => ({ ...r, live: false })) }));
    } catch {}
  }, [log, status, storageKey]);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }); }, [log, thinking, open]);

  /* pausar / parar / continuar */
  const releaseWaiters = () => { waiters.current.splice(0).forEach(r => r()); };
  const gate = async () => {
    while (pausedRef.current && !stoppedRef.current) await new Promise(r => waiters.current.push(r));
    if (stoppedRef.current) throw new StopError();
  };
  const pause = () => { pausedRef.current = true; setStatus('paused'); };
  const unpause = () => { pausedRef.current = false; setStatus('running'); releaseWaiters(); };
  const stop = () => { stoppedRef.current = true; pausedRef.current = false; abortRef.current?.abort(); releaseWaiters(); };

  /* enviar */
  const send = async (text, resume = false) => {
    if (status !== 'idle' || !api.current || api.current.readOnly) return;
    if (!settings?.temChave) { setSetup(true); return; }
    const t = text.trim() || (!resume && docs.length ? (isDb ? 'Use o conteúdo dos arquivos anexados para executar a missão.' : 'Monte o mapa mental a partir do conteúdo dos arquivos anexados.') : '');
    if (!t && !resume) return;

    // conteúdo da mensagem: print da tela + anexos + estado do mapa + o pedido
    const blocks = []; let shotUrl = null;
    if (autoShot && !isDb) { try { const s = api.current.screenshot(false); blocks.push(imgBlock(s)); shotUrl = s.url; } catch (e) { console.error(e); } }
    for (const a of atts) blocks.push(imgBlock(a));
    for (const d of docs) blocks.push({ type: 'text', text: `<arquivo nome="${d.name.replace(/["<>\r\n]/g, '_')}">\n${d.text}\n</arquivo>` });
    blocks.push({ type: 'text', text: isDb ? `<estado_da_tela>\n${api.current.context()}\n</estado_da_tela>` : `<estado_do_mapa>\n${api.current.context()}\n</estado_do_mapa>` });
    blocks.push({ type: 'text', text: resume
      ? `Continue de onde parou. O trabalho foi interrompido antes de terminar. Ações já executadas desde o meu pedido: ${acts.current.length ? acts.current.join(' | ') : 'nenhuma'}. ${isDb ? 'Confira o estado atual do banco (consultar).' : 'O estado atual do mapa está acima;'} Complete o que faltava do pedido original, sem refazer o que já existe.`
      : t });

    messages.current = trimHistory(messages.current, 160);
    const last = messages.current[messages.current.length - 1];
    if (last && last.role === 'user') last.content = [...asBlocks(last.content), ...blocks];
    else messages.current.push({ role: 'user', content: blocks });

    if (resume) push({ k: 'note', t: '▶ Retomando…' });
    else { acts.current = []; setUndoable(false); runRef.current = { id: crypto.randomUUID(), prompt: t }; push({ k: 'user', t, imgs: [shotUrl && { url: shotUrl, label: 'tela' }, ...atts.map(a => ({ url: a.url, label: 'anexo' }))].filter(Boolean), files: docs.map(d => d.name) }); setInput(''); setAtts([]); setDocs([]); setAttMsg(''); api.current.begin(); }

    stoppedRef.current = false; pausedRef.current = false;
    const ac = new AbortController(); abortRef.current = ac;
    setStatus('running'); setInterrupted(false); setThinking(false);

    const rt = { run: runRef.current.id, gate, speed: () => SPEEDS.find(s => s.id === speedRef.current).m };
    const res = await runAgent({
      scope: isDb ? 'db' : undefined,
      messages: messages.current, signal: ac.signal, gate, run: { id: runRef.current.id, project: storageKey.replace(/^mm:ai:/, ''), prompt: runRef.current.prompt },
      exec: (name, inp) => api.current.exec(name, inp, rt),
      onText: appendAi, onTextReset: closeAi, onThinking: setThinking,
      onAction: (label, r) => { if (r.undoable) setUndoable(true); acts.current.push(label); push({ k: 'act', t: label, err: !!r.isError }); },
      onNote: n => push({ k: 'note', t: n }),
    });
    closeAi(); setThinking(false); api.current.end();
    // informa ao servidor como o prompt terminou (o consumo de tokens já foi somado a cada chamada)
    fetch('/api/ai/run-end', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ run: runRef.current.id, status: ({ done: 'concluido', stopped: 'parado', error: 'erro', max_steps: 'limite' })[res.status] || 'erro', error: res.error, tools: acts.current.length, project: storageKey.replace(/^mm:ai:/, ''), prompt: runRef.current.prompt }) }).catch(() => {});
    abortRef.current = null; pausedRef.current = false;
    setStatus('idle');
    if (res.status === 'stopped') { setInterrupted(true); push({ k: 'note', t: '■ Parado. Use ▶ Retomar para continuar de onde parou.' }); }
    else if (res.status === 'error') { setInterrupted(true); push({ k: 'err', t: res.error }); }
    else if (res.status === 'max_steps') { setInterrupted(true); push({ k: 'note', t: 'Cheguei ao limite de passos deste pedido. Use ▶ Retomar para continuar.' }); }
  };

  const undoMission = async () => {
    if (status !== 'idle' || !runRef.current.id) return;
    try {
      const r = await fetch('/api/admin/ai/undo', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ run: runRef.current.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { push({ k: 'err', t: d.error || 'Não foi possível desfazer' }); return; }
      setUndoable(false); push({ k: 'note', t: `↶ Missão desfeita (${d.desfeitas} linha(s)).` });
      api.current?.afterUndo?.(d);
      messages.current.push({ role: 'user', content: [{ type: 'text', text: '(O usuário desfez a missão anterior: as alterações feitas por você foram revertidas no banco.)' }] });
    } catch { push({ k: 'err', t: 'Falha de conexão ao desfazer' }); }
  };

  const clearChat = () => {
    if (status !== 'idle') return;
    messages.current = []; acts.current = []; setLog([]); setInterrupted(false); api.current?.reset();
    try { localStorage.removeItem(storageKey); } catch {}
  };

  // imagens vão como imagem; QUALQUER outro arquivo é aceito se for texto (qualquer extensão): lido como UTF-8, binários são recusados
  const addFiles = async files => {
    const msgs = []; let room = MAX_DOCS - docs.length, total = docs.reduce((n, d) => n + d.size, 0);
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        try { const img = await fileToImage(f); setAtts(a => (a.length >= 3 ? a : [...a, img])); } catch {}
        continue;
      }
      if (room <= 0) { msgs.push(`Máximo de ${MAX_DOCS} arquivos de texto por mensagem.`); break; }
      if (f.size > MAX_DOC_BYTES) { msgs.push(`“${f.name}” passa de ${MAX_DOC_BYTES / 1024} KB.`); continue; }
      if (total + f.size > MAX_DOCS_TOTAL) { msgs.push(`“${f.name}”: o total dos arquivos passaria de ${MAX_DOCS_TOTAL / 1024} KB.`); continue; }
      let text;
      try { text = await f.text(); } catch { msgs.push(`Não consegui ler “${f.name}”.`); continue; }
      if (text.includes('\u0000') || (text.match(/\uFFFD/g) || []).length > Math.max(3, text.length * 0.01)) { msgs.push(`“${f.name}” não parece um arquivo de texto.`); continue; }
      if (!text.trim()) { msgs.push(`“${f.name}” está vazio.`); continue; }
      room--; total += f.size;
      setDocs(d => [...d, { name: f.name, text, size: f.size }]);
    }
    setAttMsg(msgs.join(' '));
  };
  const onPaste = e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  const onDrop = e => { const files = [...(e.dataTransfer?.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } };

  if (api.current?.readOnly) return null;
  const running = status !== 'idle';
  const controls = (
    <>
      {status === 'running' && <button className="ai-b" title="Pausa o trabalho exatamente onde está" onClick={pause}>⏸ Pausar</button>}
      {status === 'paused' && <button className="ai-b go" title="Continua do ponto em que pausou" onClick={unpause}>▶ Continuar</button>}
      {running && <button className="ai-b stop" title="Para tudo e cancela a resposta em andamento (o que já foi feito fica)" onClick={stop}>■ Parar</button>}
      {!running && undoable && <button className="ai-b" title="Reverte tudo o que a IA alterou no banco neste pedido" onClick={undoMission}>↶ Desfazer missão</button>}
      {!running && interrupted && <button className="ai-b go" title="Continua o trabalho de onde parou" onClick={() => send('', true)}>▶ Retomar</button>}
    </>
  );

  return (
    <>
      {!open && (running
        ? <div className={`ai-pill ui${panelOpen ? ' po' : ''}`}>
            <button className="ai-pill-open" title="Abrir o chat" onClick={() => setOpen(true)}><span className={`ai-dot ${status}`} />{status === 'paused' ? 'IA pausada' : thinking ? 'IA pensando…' : 'IA trabalhando…'}</button>
            {controls}
          </div>
        : <button className={`ai-fab ui${panelOpen ? ' po' : ''}`} title="Assistente de IA" onClick={() => setOpen(true)}>✦ IA{interrupted && <span className="ai-badge">!</span>}</button>)}

      {open && (
        <section className={`ai-dock ui${panelOpen ? ' po' : ''}${wide ? ' wide' : ''}`} onPointerDown={e => e.stopPropagation()} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
          <header className="ai-head">
            <span className={`ai-dot ${status}`} />
            <b style={{ whiteSpace: 'nowrap' }}>{isDb ? 'Assistente do banco' : 'Assistente IA'}</b>
            <span className="ai-sp" />
            <button className="ai-ic" title={wide ? 'Recolher o chat' : 'Expandir o chat (+50% para a esquerda, +25% para cima)'} onClick={toggleWide}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {wide ? <path d="M9 2v5h5M7 14V9H2M14 2L9 7M2 14l5-5" /> : <path d="M9 7l5-5M10 2h4v4M7 9l-5 5M6 14H2v-4" />}
              </svg>
            </button>
            <button className="ai-ic" title="Limpar conversa" disabled={running || !log.length} onClick={clearChat}>🗑</button>
            <button className="ai-ic" title="Setup: chave da API, modelo e prompt" onClick={() => setSetup(true)}>⚙</button>
            <button className="ai-ic" title="Minimizar" onClick={() => setOpen(false)}>—</button>
          </header>

          <div className="ai-log">
            {!log.length && (
              <div className="ai-empty">
                {isDb
                  ? <p><b>Passe a missão e eu executo no banco, na sua frente.</b> Eu conheço todas as tabelas e colunas, abro a tabela e destaco as linhas. Cada missão pode ser desfeita.</p>
                  : <p><b>Peça e eu monto o mapa na sua frente.</b> Eu vejo o mapa, a seleção e (se ativado) o print da tela.</p>}
                {!settings?.temChave && settings && <button className="ai-cta" onClick={() => setSetup(true)}>⚙ Cadastrar chave da API</button>}
                {(isDb ? ['Crie 5 usuários não master', 'Quantos projetos cada usuário tem?', 'Mostre os convites pendentes'] : ['Monte um mapa mental sobre planejamento de marketing para uma clínica', 'Expanda o bloco selecionado em 5 subtópicos', 'Organize o mapa e enquadre tudo na tela']).map(s => (
                  <button key={s} className="ai-chip" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            )}
            {log.map(m => (
              <div key={m.id} className={`ai-m ${m.k}${m.err ? ' bad' : ''}`}>
                {m.k === 'user' && m.imgs?.length > 0 && <div className="ai-imgs">{m.imgs.map((im, i) => <img key={i} src={im.url} alt={im.label} title={im.label} />)}</div>}
                {m.k === 'user' && m.files?.length > 0 && <div className="ai-files">{m.files.map((n, i) => <span key={i}>📄 {n}</span>)}</div>}
                {m.t}
              </div>
            ))}
            {thinking && <div className="ai-m note">pensando…</div>}
            <div ref={logEnd} />
          </div>

          <div className="ai-foot">
            <div className="ai-ctl">
              {controls}
              <span className="ai-sp" />
              <select className="ai-speed" title="Velocidade da animação do cursor" value={speed} onChange={e => setSpeed(e.target.value)}>
                {SPEEDS.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
              {!isDb && <button className={`ai-ic${autoShot ? ' on' : ''}`} title={autoShot ? 'A IA recebe um print da tela a cada mensagem (clique para desligar)' : 'Enviar print da tela com cada mensagem (desligado)'} onClick={() => setAutoShot(v => !v)}>👁</button>}
              <button className="ai-ic" title="Anexar imagem ou arquivo de texto (qualquer extensão) — também dá para colar ou soltar aqui" disabled={running} onClick={() => fileIn.current?.click()}>📎</button>
              <input ref={fileIn} type="file" multiple hidden onChange={e => { addFiles([...e.target.files]); e.target.value = ''; }} />
            </div>
            {docs.length > 0 && <div className="ai-docs">{docs.map((d, i) => <span key={i} title={`${d.name} · ${(d.size / 1024).toFixed(1)} KB`}>📄 <em>{d.name}</em><small>{(d.size / 1024).toFixed(1)} KB</small><button title="Remover" onClick={() => setDocs(x => x.filter((_, j) => j !== i))}>×</button></span>)}</div>}
            {attMsg && <div className="ai-attmsg">{attMsg}</div>}
            {atts.length > 0 && <div className="ai-atts">{atts.map((a, i) => <span key={i}><img src={a.url} alt="" /><button title="Remover" onClick={() => setAtts(x => x.filter((_, j) => j !== i))}>×</button></span>)}</div>}
            <div className="ai-inrow">
              <textarea rows={2} value={input} placeholder={running ? 'Trabalhando… use ■ Parar para interromper' : (isDb ? 'Passe uma missão ao banco… (Enter envia · Shift+Enter quebra linha)' : 'Peça algo ao mapa… (Enter envia · Shift+Enter quebra linha · cole imagens)')}
                onChange={e => setInput(e.target.value)} onPaste={onPaste} disabled={running}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } e.stopPropagation(); }} />
              <div className="ai-side">
                <button className="ai-send" title="Enviar" disabled={running || (!input.trim() && !docs.length)} onClick={() => send(input)}>➤</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {setup && settings && <Setup settings={settings} onClose={() => setSetup(false)} onSaved={setSettings} />}
    </>
  );
}
