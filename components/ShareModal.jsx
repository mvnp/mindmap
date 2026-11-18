'use client';
import { useCallback, useEffect, useState } from 'react';

const OPCOES = [
  ['privado', 'Privado', 'Somente você enxerga este projeto (padrão).'],
  ['convidados', 'Convidados', 'Você e quem recebeu o convite e aceitou podem acessar e editar.'],
  ['publico', 'Público', 'Qualquer pessoa cadastrada na ferramenta, com o link, pode visualizar (somente leitura). Convidados continuam editando.'],
];
const json = { 'Content-Type': 'application/json' };

// Compartilhamento do projeto: URL única, visibilidade e convites por e-mail
export default function ShareModal({ projectId, onClose }) {
  const [info, setInfo] = useState(null);
  const [emails, setEmails] = useState(['']);   // um input[type=email] por convite
  const [focusIdx, setFocusIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/share`);
    if (r.ok) setInfo(await r.json()); else setMsg('Não foi possível carregar o compartilhamento');
  }, [projectId]);

  useEffect(() => {
    load();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [load, onClose]);

  const link = info ? `${window.location.origin}/p/${info.uuid}` : '';

  const setVis = async v => {
    const r = await fetch(`/api/projects/${projectId}/share`, { method: 'PATCH', headers: json, body: JSON.stringify({ visibilidade: v }) });
    if (r.ok) setInfo(await r.json());
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setMsg('Link copiado ✓'); } catch { setMsg('Não foi possível copiar'); }
    setTimeout(() => setMsg(''), 2000);
  };
  const convidar = async () => {
    setBusy(true); setRes(null);
    const r = await fetch(`/api/projects/${projectId}/invites`, { method: 'POST', headers: json, body: JSON.stringify({ emails: emails.map(e => e.trim()).filter(Boolean) }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setRes({ erro: d.error || 'Falha ao enviar os convites' });
    setRes(d);
    if (d.enviados.length) {   // mantém na lista só os que não foram enviados
      const falhos = emails.map(e => e.trim()).filter(e => e && !d.enviados.includes(e.toLowerCase()));
      setEmails(falhos.length ? falhos : ['']); setFocusIdx(0);
    }
    load();
  };
  const remover = async body => {
    const r = await fetch(`/api/projects/${projectId}/share`, { method: 'DELETE', headers: json, body: JSON.stringify(body) });
    if (r.ok) setInfo(await r.json());
  };

  return (
    <div className="modal-bg ui" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal share">
        <h3>Compartilhar projeto</h3>
        {!info ? <p className="msg">{msg || 'Carregando…'}</p> : (
          <>
            <section>
              <label className="sh-l">Quem pode acessar</label>
              <div className="sh-opts">
                {OPCOES.map(([v, t, d]) => (
                  <label key={v} className={`sh-opt${info.visibilidade === v ? ' on' : ''}`}>
                    <input type="radio" name="vis" checked={info.visibilidade === v} onChange={() => setVis(v)} />
                    <span><b>{t}</b><small>{d}</small></span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <label className="sh-l">Link do projeto (URL única)</label>
              <div className="sh-row">
                <input readOnly value={link} onFocus={e => e.target.select()} />
                <button onClick={copy}>Copiar</button>
              </div>
            </section>

            <section>
              <label className="sh-l">Convidar para editar</label>
              <form id="convite-form" onSubmit={e => { e.preventDefault(); convidar(); }}>
                <ul className="sh-emails">
                  {emails.map((v, i) => (
                    <li key={i}>
                      <input type="email" value={v} autoFocus={i === focusIdx} placeholder="email@exemplo.com" maxLength={254}
                        onChange={e => setEmails(list => list.map((x, j) => (j === i ? e.target.value : x)))}
                        onKeyDown={e => { if (e.key === 'Enter' && i === emails.length - 1 && v.trim() && emails.length < 20) { e.preventDefault(); setEmails(l => [...l, '']); setFocusIdx(i + 1); } }} />
                      {emails.length > 1 && <button type="button" className="sh-x" title="Remover este e-mail"
                        onClick={() => { setEmails(list => list.filter((_, j) => j !== i)); setFocusIdx(-1); }}>×</button>}
                    </li>
                  ))}
                </ul>
                <div className="sh-row">
                  <button type="button" className="sh-add" disabled={emails.length >= 20} onClick={() => { setEmails(l => [...l, '']); setFocusIdx(emails.length); }}>＋ Adicionar e-mail</button>
                </div>
              </form>
              {res?.erro && <p className="sh-err">{res.erro}</p>}
              {res && !res.erro && (
                <div className="sh-res">
                  {res.enviados.length > 0 && <p className="sh-ok">Convites enviados: {res.enviados.join(', ')}{info.visibilidade === 'convidados' ? '' : ''}</p>}
                  {res.ignorados.map(i => <p key={i.email} className="sh-err">{i.email}: {i.motivo}</p>)}
                </div>
              )}
            </section>

            {(info.membros.length > 0 || info.convites.length > 0) && (
              <section>
                <label className="sh-l">Pessoas</label>
                <ul className="sh-list">
                  {info.membros.map(m => (
                    <li key={m.user_id}><span>{m.nome} {m.sobrenome} <small>{m.email} · editor</small></span>
                      <button onClick={() => remover({ membro: m.user_id })}>Remover</button></li>
                  ))}
                  {info.convites.map(c => (
                    <li key={c.id}><span>{c.email} <small>{c.expirado ? 'convite expirado' : 'convite pendente'}</small></span>
                      <button onClick={() => remover({ convite: c.id })}>Revogar</button></li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <div className="modal-actions">
          <span className="msg">{info ? msg : ''}</span>
          {info && <button type="submit" form="convite-form" className="primary" disabled={busy || !emails.some(e => e.trim())}>{busy ? 'Enviando…' : 'Convidar'}</button>}
          <button onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
