'use client';
import { useEffect, useState } from 'react';
import { AuthShell, AuthLink } from '@/components/AuthShell';

// Link especial de verificação de e-mail: /verificar?token=...
export default function VerificarPage() {
  const [estado, setEstado] = useState('carregando');   // carregando | ok | erro
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) { setEstado('erro'); setMsg('Link inválido.'); return; }
    fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async r => { const d = await r.json().catch(() => ({})); if (r.ok) { setEstado('ok'); window.location.replace('/login?ok=verificado'); } else { setEstado('erro'); setMsg(d.error || 'Link inválido ou expirado.'); } })
      .catch(() => { setEstado('erro'); setMsg('Sem conexão com o servidor.'); });
  }, []);

  return (
    <AuthShell title="Verificação de e-mail" footer={<AuthLink href="/login">Ir para o login</AuthLink>}>
      {estado === 'carregando' && <p className="auth-sub">Verificando…</p>}
      {estado === 'ok' && <div className="auth-ok">E-mail verificado! Redirecionando para o login…</div>}
      {estado === 'erro' && <div className="auth-err">{msg}</div>}
    </AuthShell>
  );
}
