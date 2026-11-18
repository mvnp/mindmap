'use client';
import { useState } from 'react';
import { AuthShell, Field, AuthLink, useSubmit } from '@/components/AuthShell';

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const { submit, busy, error } = useSubmit('/api/auth/forgot', () => setEnviado(true));

  return (
    <AuthShell title="Recuperar senha" subtitle="Enviaremos um link especial para você criar uma nova senha"
      footer={<AuthLink href="/login">Voltar ao login</AuthLink>}>
      {enviado ? (
        <div className="auth-ok">Caso exista um cadastro em nossa base de dados, você receberá convite para reiniciar sua senha. Obrigado.</div>
      ) : (
        <form className="auth-form" onSubmit={e => { e.preventDefault(); submit({ email }); }}>
          {error && <div className="auth-err" role="alert">{error}</div>}
          <Field label="E-mail" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
          <button className="auth-btn" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
        </form>
      )}
    </AuthShell>
  );
}
