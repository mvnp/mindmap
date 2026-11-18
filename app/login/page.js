'use client';
import { useEffect, useState } from 'react';
import { AuthShell, Field, AuthLink, useSubmit } from '@/components/AuthShell';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [aviso, setAviso] = useState('');
  const [reenvio, setReenvio] = useState('');
  const { submit, busy, error, status } = useSubmit('/api/auth/login', () => {
    // volta para a página pedida (?next=), só caminhos do próprio site
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/meus-mapas';
  });

  useEffect(() => {
    const ok = new URLSearchParams(window.location.search).get('ok');
    if (ok === 'cadastro') setAviso('Cadastro realizado! Enviamos um link de confirmação para o seu e-mail. Confirme-o para poder entrar.');
    if (ok === 'reset') setAviso('Senha redefinida. Entre com a nova senha.');
    if (ok === 'verificado') setAviso('E-mail verificado com sucesso! Entre com seu e-mail e senha.');
  }, []);

  return (
    <AuthShell title="Entrar" subtitle="Acesse seus projetos e mapas mentais"
      footer={<>Ainda não tem conta? <AuthLink href="/cadastro">Cadastre-se</AuthLink></>}>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); submit({ email, senha }); }}>
        {aviso && <div className="auth-ok">{aviso}</div>}
        {error && <div className="auth-err" role="alert">{error}</div>}
        {status === 403 && !reenvio && (
          <button type="button" className="auth-link-btn" onClick={async () => {
            await fetch('/api/auth/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
            setReenvio('Se este e-mail estiver pendente de confirmação, enviamos um novo link.');
          }}>Reenviar e-mail de confirmação</button>
        )}
        {reenvio && <div className="auth-ok">{reenvio}</div>}
        <Field label="E-mail" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} autoFocus />
        <Field label="Senha" type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} />
        <button className="auth-btn" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <AuthLink href="/recuperar-senha">Esqueci minha senha</AuthLink>
      </form>
    </AuthShell>
  );
}
