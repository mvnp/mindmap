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

export function Field({ label, error, ...props }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input {...props} />
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
