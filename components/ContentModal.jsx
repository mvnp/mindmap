'use client';
// Conteúdo de um bloco: modal de edição (título, texto formatado, arquivos, botão de IA) e modal de visualização organizada.
import { useEffect, useRef, useState } from 'react';
import { clean, isEmptyHtml, fmtSize, TIPO_ICON } from '@/lib/rich';

const MAX_FILE = 25 * 1024 * 1024, MAX_FILES = 20;
const base = (p, nid) => `/api/projects/${p.id}/conteudo/${encodeURIComponent(nid)}`;
const fileUrl = (p, nid, f, dl) => `${base(p, nid)}/arquivo/${f.id}${dl ? '?dl=1' : ''}`;
const isHtml = f => /\.html?$/i.test(f.nome);
const viewUrl = (p, nid, f) => `${base(p, nid)}/arquivo/${f.id}?view=1`;   // página HTML renderizada (sem scripts)
const jsonHeaders = { 'Content-Type': 'application/json' };
const stopKeys = (e, onEsc) => { if (e.key === 'Escape') onEsc(); e.stopPropagation(); };   // atalhos do mapa não disparam enquanto o modal está aberto

/* ============================ EDITOR ============================ */
const TOOLS = [
  ['bold', 'Negrito', <b key="b">B</b>], ['italic', 'Itálico', <i key="i">I</i>], ['underline', 'Sublinhado', <u key="u">U</u>],
  ['h3', 'Subtítulo', <span key="h">H</span>], ['insertUnorderedList', 'Lista', <span key="ul">• ≡</span>], ['insertOrderedList', 'Lista numerada', <span key="ol">1.≡</span>],
  ['removeFormat', 'Limpar formatação', <span key="x">Tx</span>],
];

export function ContentEditor({ project, node, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [titulo, setTitulo] = useState('');
  const [existing, setExisting] = useState([]);          // arquivos já salvos
  const [drop, setDrop] = useState(new Set());           // ids marcados para remover
  const [added, setAdded] = useState([]);                // File[] novos
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);                  // { t, ok }
  const [hasContent, setHasContent] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAsk, setAiAsk] = useState('');
  const [undoAi, setUndoAi] = useState(null);            // HTML de antes da proposta da IA
  const ed = useRef(null), fileIn = useRef(null), box = useRef(null), titleIn = useRef(null);
  useEffect(() => { box.current?.focus(); }, []);   // o foco fica DENTRO do modal: Esc fecha e Tab/Del não chegam ao mapa

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await fetch(base(project, node.id)); if (!r.ok) throw new Error();
        const c = await r.json(); if (off) return;
        setTitulo(c.titulo || ''); setExisting(c.arquivos || []); setHasContent(!!c.id);
        if (ed.current) ed.current.innerHTML = clean(c.corpo || '');
      } catch { if (!off) setMsg({ t: 'Não foi possível carregar o conteúdo.', ok: false }); }
      if (!off) { setLoading(false); setTimeout(() => titleIn.current?.focus(), 0); }
    })();
    return () => { off = true; };
  }, [project, node.id]);

  const exec = cmd => {
    ed.current?.focus();
    if (cmd === 'h3') document.execCommand('formatBlock', false, document.queryCommandValue('formatBlock').toLowerCase() === 'h3' ? 'p' : 'h3');
    else document.execCommand(cmd, false, null);
  };
  const onPaste = e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); };

  const addFiles = list => {
    const errs = []; let n = existing.length - drop.size + added.length;
    const ok = [];
    for (const f of list) {
      if (n >= MAX_FILES) { errs.push(`Máximo de ${MAX_FILES} arquivos por bloco.`); break; }
      if (f.size > MAX_FILE) { errs.push(`“${f.name}” passa de 25 MB.`); continue; }
      if (!f.size) { errs.push(`“${f.name}” está vazio.`); continue; }
      ok.push(f); n++;
    }
    setAdded(a => [...a, ...ok]);
    setMsg(errs.length ? { t: errs.join(' '), ok: false } : null);
  };

  const proposeAI = async () => {
    const el = ed.current; if (!el || aiBusy) return;
    const rascunho = el.innerText.trim();
    if (!rascunho && !titulo.trim()) return setMsg({ t: 'Escreva algo no texto (ou um título) para a IA partir dele.', ok: false });
    setAiBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/ai/conteudo', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ project: project.uuid, node: node.id, titulo, rascunho, pedido: aiAsk }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'A IA não respondeu.');
      setUndoAi(el.innerHTML);
      const html = clean(d.html);
      el.innerHTML = isEmptyHtml(el.innerHTML) ? html : `${el.innerHTML}<p><br></p>${html}`;   // mantém o rascunho e acrescenta a proposta
      el.scrollTop = el.scrollHeight;
      setMsg({ t: 'Proposta da IA adicionada ao final do texto. Revise e edite à vontade.', ok: true });
    } catch (e) { setMsg({ t: e.message, ok: false }); }
    setAiBusy(false);
  };

  const save = async () => {
    if (busy) return;
    const html = clean(ed.current?.innerHTML || '');
    if (!titulo.trim() && isEmptyHtml(html) && !added.length && existing.length === drop.size) return setMsg({ t: 'Preencha o título, o texto ou anexe um arquivo.', ok: false });
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('titulo', titulo); fd.append('corpo', isEmptyHtml(html) ? '' : html); fd.append('remover', JSON.stringify([...drop]));
      added.forEach(f => fd.append('arquivos', f, f.name));
      const r = await fetch(base(project, node.id), { method: 'PUT', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || (r.status === 413 ? 'Os arquivos são grandes demais.' : 'Não foi possível salvar.'));
      onSaved(d);
    } catch (e) { setMsg({ t: e.message, ok: false }); setBusy(false); }
  };

  const del = async () => {
    setBusy(true);
    try { const r = await fetch(base(project, node.id), { method: 'DELETE' }); if (!r.ok) throw new Error(); onSaved(null); }
    catch { setMsg({ t: 'Não foi possível excluir.', ok: false }); setBusy(false); }
  };

  const total = existing.length - drop.size + added.length;
  return (
    <div className="modal-bg ui" onPointerDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={box} tabIndex={-1} className="modal ct-modal" role="dialog" aria-modal="true" aria-label="Conteúdo do bloco" onKeyDown={e => stopKeys(e, () => !busy && onClose())}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles([...e.dataTransfer.files]); }}>
        <div className="ct-head">
          <h3>Conteúdo do bloco <span className="ct-node">“{node.text || 'sem texto'}”</span></h3>
          <button className="ct-x" title="Fechar" onClick={onClose} disabled={busy}>×</button>
        </div>

        <div className="ct-body">
          <label className="ct-l">Título
            <input ref={titleIn} value={titulo} maxLength={200} disabled={loading} placeholder="Título do conteúdo" onChange={e => setTitulo(e.target.value)} />
          </label>

          <div className="ct-l">Conteúdo
            <div className="ct-tools">
              {TOOLS.map(([cmd, tt, ic]) => <button key={cmd} type="button" title={tt} onMouseDown={e => e.preventDefault()} onClick={() => exec(cmd)}>{ic}</button>)}
              <span className="ct-sp" />
              <input className="ct-ask" value={aiAsk} maxLength={1000} placeholder="Pedido extra para a IA (opcional)" onChange={e => setAiAsk(e.target.value)} disabled={aiBusy} />
              <button type="button" className="ct-ai" onClick={proposeAI} disabled={aiBusy || loading} title="A IA lê o que você escreveu (e o contexto do bloco) e propõe um conteúdo">
                {aiBusy ? 'Pensando…' : '✦ IA'}
              </button>
              {undoAi !== null && !aiBusy && <button type="button" title="Voltar ao texto de antes da IA" onClick={() => { ed.current.innerHTML = undoAi; setUndoAi(null); setMsg(null); }}>↶ Desfazer IA</button>}
            </div>
            <div ref={ed} className="ct-rich" contentEditable={!loading && !aiBusy} suppressContentEditableWarning spellCheck data-ph="Escreva aqui o conteúdo deste bloco… (depois, se quiser, peça para a IA propor um texto a partir dele)" onPaste={onPaste} />
          </div>

          <div className="ct-l">Arquivos <small>textos, imagens, PDFs e áudios · até 25 MB cada · {total}/{MAX_FILES}</small>
            <div className="ct-files">
              {existing.map(f => (
                <span key={f.id} className={`ct-chip${drop.has(f.id) ? ' off' : ''}`} title={f.nome}>
                  {TIPO_ICON[f.tipo]} <em>{f.nome}</em><small>{fmtSize(f.tamanho)}</small>
                  <button type="button" title={drop.has(f.id) ? 'Manter' : 'Remover'} onClick={() => setDrop(s => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })}>{drop.has(f.id) ? '↶' : '×'}</button>
                </span>
              ))}
              {added.map((f, i) => (
                <span key={f.name + i} className="ct-chip new" title={f.name}>⬆ <em>{f.name}</em><small>{fmtSize(f.size)}</small>
                  <button type="button" title="Remover" onClick={() => setAdded(a => a.filter((_, j) => j !== i))}>×</button></span>
              ))}
              <button type="button" className="ct-add" onClick={() => fileIn.current?.click()} disabled={busy}>＋ Adicionar arquivos</button>
              <input ref={fileIn} type="file" multiple hidden onChange={e => { addFiles([...e.target.files]); e.target.value = ''; }} />
            </div>
            <span className="ct-hint">Dica: arraste arquivos para cima desta janela.</span>
          </div>
        </div>

        <div className="modal-actions ct-foot">
          {hasContent && (confirmDel
            ? <><span className="msg" style={{ color: '#b3402a' }}>Excluir todo o conteúdo e arquivos deste bloco?</span><button type="button" onClick={() => setConfirmDel(false)}>Não</button><button type="button" className="danger" onClick={del} disabled={busy}>Sim, excluir</button></>
            : <button type="button" className="ct-del" onClick={() => setConfirmDel(true)} disabled={busy}>Excluir conteúdo</button>)}
          {!confirmDel && <>
            <span className="msg" style={{ color: msg ? (msg.ok ? '#2a7a45' : '#b3402a') : undefined }}>{msg?.t || ''}</span>
            <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="button" className="primary" onClick={save} disabled={busy || loading}>{busy ? 'Salvando…' : 'Salvar'}</button>
          </>}
        </div>
      </div>
    </div>
  );
}

/* ============================ VISUALIZAÇÃO ============================ */
function TextPreview({ url }) {
  const [t, setT] = useState(null);
  useEffect(() => { let off = false; fetch(url).then(r => r.text()).then(x => !off && setT(x.length > 40000 ? x.slice(0, 40000) + '\n… (trecho inicial; baixe o arquivo para ver tudo)' : x)).catch(() => !off && setT('Não foi possível carregar.')); return () => { off = true; }; }, [url]);
  return <pre className="ct-pre">{t ?? 'Carregando…'}</pre>;
}

export function ContentViewer({ project, node, canEdit, onEdit, onClose }) {
  const [c, setC] = useState(undefined);
  const [open, setOpen] = useState(null);   // id do texto com a prévia aberta
  const box = useRef(null);
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    let off = false;
    fetch(base(project, node.id)).then(r => r.ok ? r.json() : null).then(d => !off && setC(d)).catch(() => !off && setC(null));
    return () => { off = true; };
  }, [project, node.id]);

  const by = t => (c?.arquivos || []).filter(f => f.tipo === t);
  const empty = c && !c.titulo && isEmptyHtml(c.corpo) && !c.arquivos?.length;
  return (
    <div className="modal-bg ui" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="modal ct-modal ct-view" role="dialog" aria-modal="true" aria-label="Conteúdo do bloco" onKeyDown={e => stopKeys(e, onClose)} tabIndex={-1}>
        <div className="ct-head">
          <div>
            <div className="ct-crumb">{node.path || node.text}</div>
            <h3 className="ct-title">{c?.titulo || node.text || 'Conteúdo'}</h3>
          </div>
          <button className="ct-x" title="Fechar" onClick={onClose}>×</button>
        </div>
        <div className="ct-body">
          {c === undefined && <p className="ct-hint">Carregando…</p>}
          {c === null && <p className="ct-hint">Não foi possível carregar o conteúdo.</p>}
          {empty && <p className="ct-hint">Este bloco ainda não tem conteúdo.{canEdit && ' Clique em “Editar” para adicionar.'}</p>}
          {c && !isEmptyHtml(c.corpo) && <section><h4>Conteúdo</h4><div className="ct-text" dangerouslySetInnerHTML={{ __html: clean(c.corpo) }} /></section>}

          {by('imagem').length > 0 && <section><h4>Imagens <small>{by('imagem').length}</small></h4>
            <div className="ct-gal">{by('imagem').map(f => <a key={f.id} href={fileUrl(project, node.id, f)} target="_blank" rel="noopener noreferrer" title={f.nome}><img src={fileUrl(project, node.id, f)} alt={f.nome} loading="lazy" /><span>{f.nome}</span></a>)}</div></section>}
          {by('audio').length > 0 && <section><h4>Áudios <small>{by('audio').length}</small></h4>
            {by('audio').map(f => <div key={f.id} className="ct-aud"><span title={f.nome}>🎧 {f.nome} <small>{fmtSize(f.tamanho)}</small></span><audio controls preload="none" src={fileUrl(project, node.id, f)} /></div>)}</section>}
          {by('pdf').length > 0 && <section><h4>PDFs <small>{by('pdf').length}</small></h4>
            {by('pdf').map(f => <div key={f.id} className="ct-row"><span title={f.nome}>📕 {f.nome} <small>{fmtSize(f.tamanho)}</small></span>
              <a className="ct-btn" href={fileUrl(project, node.id, f)} target="_blank" rel="noopener noreferrer">Abrir</a><a className="ct-btn" href={fileUrl(project, node.id, f, true)}>Baixar</a></div>)}</section>}
          {by('texto').length > 0 && <section><h4>Textos <small>{by('texto').length}</small></h4>
            {by('texto').map(f => <div key={f.id}><div className="ct-row"><span title={f.nome}>📄 {f.nome} <small>{fmtSize(f.tamanho)}</small></span>
              {isHtml(f)
                ? <a className="ct-btn" href={viewUrl(project, node.id, f)} target="_blank" rel="noopener noreferrer">Ver</a>
                : <button className="ct-btn" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? 'Ocultar' : 'Ver'}</button>}<a className="ct-btn" href={fileUrl(project, node.id, f, true)}>Baixar</a></div>
              {open === f.id && <TextPreview url={fileUrl(project, node.id, f)} />}</div>)}</section>}
        </div>
        <div className="modal-actions ct-foot">
          {canEdit && <button type="button" onClick={onEdit}>Editar</button>}
          <button type="button" className="primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
