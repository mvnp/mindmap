'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const jsonHeaders = { 'Content-Type': 'application/json' };
const fmtExp = s => new Date(s * 1000).toLocaleDateString('pt-BR');

// Caixa de notificações: convites pendentes para o e-mail da conta, aceitos/recusados aqui mesmo (sem depender do e-mail).
export default function Notifications({ onAccepted }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState('');
  const boxRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notificacoes', { cache: 'no-store' });
      if (r.ok) setItems(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/notificacoes', { cache: 'no-store' });
        if (!alive || !r.ok) return;
        const list = await r.json();
        setItems(list);
        // ao entrar, abre sozinha uma vez por sessão do navegador se houver convite
        let seen = false;
        try { seen = sessionStorage.getItem('mm:notif:seen') === '1'; sessionStorage.setItem('mm:notif:seen', '1'); } catch {}
        if (list.length && !seen) setOpen(true);
      } catch {}
    })();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [load]);

  useEffect(() => {
    if (open) { setErr(''); boxRef.current?.focus(); load(); }
  }, [open, load]);

  const act = async (id, acao) => {
    setBusy(id); setErr('');
    try {
      const r = await fetch(`/api/notificacoes/${id}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ acao }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Não foi possível responder ao convite'); await load(); return; }
      setItems(a => a.filter(x => x.id !== id));
      if (acao === 'aceitar') onAccepted?.(d);
    } catch { setErr('Falha de conexão'); }
    finally { setBusy(0); }
  };

  return (
    <>
      <button className="notif-btn" title="Notificações e convites" aria-label={`Notificações${items.length ? `: ${items.length} convite(s) pendente(s)` : ''}`} onClick={() => setOpen(true)}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 1.8a3.7 3.7 0 0 0-3.7 3.7c0 3.4-1.5 4.4-1.5 4.4h10.4s-1.5-1-1.5-4.4A3.7 3.7 0 0 0 8 1.8zM6.6 12.4a1.5 1.5 0 0 0 2.8 0" /></svg>
        {items.length > 0 && <span className="notif-badge">{items.length}</span>}
      </button>
      {open && (
        <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="modal notif-modal" role="dialog" aria-modal="true" aria-label="Notificações" tabIndex={-1} ref={boxRef}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
            <h3>Notificações</h3>
            {items.length === 0 && <p className="notif-empty">Nenhum convite pendente.</p>}
            <ul className="notif-list">
              {items.map(n => (
                <li key={n.id}>
                  <div className="notif-txt">
                    <span><b>{n.convidadoPor}</b> convidou você para o projeto <b>{n.projeto}</b></span>
                    <small>Você entra como <b>leitor</b> (o dono pode liberar a edição) · vale até {fmtExp(n.expira)}</small>
                  </div>
                  <div className="notif-acts">
                    <button className="primary" disabled={busy === n.id} onClick={() => act(n.id, 'aceitar')}>Aceitar</button>
                    <button disabled={busy === n.id} onClick={() => act(n.id, 'recusar')}>Recusar</button>
                  </div>
                </li>
              ))}
            </ul>
            {err && <div className="notif-err" role="alert">{err}</div>}
            <div className="modal-actions"><button onClick={() => setOpen(false)}>Fechar</button></div>
          </div>
        </div>
      )}
    </>
  );
}
