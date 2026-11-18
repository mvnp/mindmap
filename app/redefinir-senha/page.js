'use client';
import { useEffect, useState } from 'react';
import { AuthShell, Field, AuthLink, useSubmit } from '@/components/AuthShell';

export default function RedefinirSenhaPage() {
  const [token, setToken] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [localErr, setLocalErr] = useState('');
  const { submit, busy, error } = useSubmit('/api/auth/reset', () => { window.location.href = '/login?ok=reset'; });

  useEffect(() => { setToken(new URLSearchParams(window.location.search).get('token') || ''); }, []);

  const onSubmit = e => {
    e.preventDefault();
    if (senha !== confirmar) return setLocalErr('As senhas não conferem');
    setLocalErr(''); submit({ token, senha });
  };

  return (
    <AuthShell title="Nova senha" subtitle="Escolha uma nova senha para a sua conta"
      footer={<AuthLink href="/login">Voltar ao login</AuthLink>}>
      <form className="auth-form" onSubmit={onSubmit}>
        {(localErr || error) && <div className="auth-err" role="alert">{localErr || error}</div>}
        {!token && <div className="auth-err">Link inválido. Peça um novo em “Esqueci minha senha”.</div>}
        <Field label="Nova senha (mín. 8 caracteres)" type="password" required minLength={8} autoComplete="new-password" value={senha} onChange={e => setSenha(e.target.value)} autoFocus />
        <Field label="Confirmar senha" type="password" required minLength={8} autoComplete="new-password" value={confirmar} onChange={e => setConfirmar(e.target.value)} />
        <button className="auth-btn" disabled={busy || !token}>{busy ? 'Salvando…' : 'Redefinir senha'}</button>
      </form>
    </AuthShell>
  );
}
