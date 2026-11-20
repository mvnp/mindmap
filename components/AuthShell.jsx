'use client';
import Link from 'next/link';
import { useState } from 'react';

// Moldura comum das telas de login / cadastro / recuperação
export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">mind<b>map</b></div>
        <h1>{title}</h1>
        {subtitle && <p className="auth-sub">{subtitle}</p>}
        {children}
        {footer && <div className="auth-foot">{footer}</div>}
      </div>
    </div>
  );
}

const EYE = <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
const EYE_OFF = <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5.6 19 2 12 2 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.8 9.8 0 0 1 12 4c6.4 0 10 8 10 8a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22" /><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" /></svg>;

// campo de formulário; campos de senha ganham o botão "olho" para mostrar/ocultar
export function Field({ label, error, type, ...props }) {
  const [show, setShow] = useState(false);
  if (type !== 'password') return (
    <label className="auth-field">
      <span>{label}</span>
      <input type={type} {...props} />
    </label>
  );
  return (
    <label className="auth-field">
      <span>{label}</span>
      <div className="auth-pw">
        <input type={show ? 'text' : 'password'} {...props} />
        <button type="button" className="auth-eye" tabIndex={-1} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} title={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show}
          onMouseDown={e => e.preventDefault()} onClick={() => setShow(s => !s)}>{show ? EYE_OFF : EYE}</button>
      </div>
    </label>
  );
}

export const AuthLink = ({ href, children }) => <Link href={href}>{children}</Link>;

// POST JSON com tratamento de erro/estado de envio
export function useSubmit(url, onOk) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(0);
  const submit = async body => {
    setBusy(true); setError(''); setStatus(0);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setStatus(r.status); setError(d.error || 'Não foi possível concluir. Tente novamente.'); }
      else onOk(d);
    } catch { setError('Sem conexão com o servidor.'); }
    setBusy(false);
  };
  return { submit, busy, error, status, setError };
}

// máscara de telefone brasileiro: (11) 91234-5678 ou (11) 1234-5678
export function maskPhone(v) {
  const d = String(v).replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
