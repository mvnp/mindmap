'use client';
import { useEffect, useState } from 'react';
import { AuthShell, Field, AuthLink, useSubmit, maskPhone } from '@/components/AuthShell';

// Página de destino do convite: formulário de cadastro (e-mail fixo, o do convite).
// Quem já tem conta entra e aceita o convite.
export default function ConvitePage() {
  const [token, setToken] = useState(null);
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState(false);
  const [f, setF] = useState({ nome: '', sobrenome: '', telefone: '', senha: '', confirmar: '' });
  const [localErr, setLocalErr] = useState('');
  const { submit, busy, error } = useSubmit(`/api/invites/${token}/register`, () => setFeito(true));
  const set = k => e => setF(s => ({ ...s, [k]: k === 'telefone' ? maskPhone(e.target.value) : e.target.value }));

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    setToken(t);
    if (!t) { setErro('Link de convite inválido.'); return; }
    (async () => {
      const r = await fetch(`/api/invites/${t}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.error || 'Convite inválido.'); return; }
      setInfo(d);
      if (d.contaExistente) {   // já tem conta: se já estiver logado com o e-mail do convite, aceita direto
        const me = await fetch('/api/auth/me');
        if (me.ok) {
          const a = await fetch(`/api/invites/${t}/accept`, { method: 'POST' });
          const ad = await a.json().catch(() => ({}));
          if (a.ok) window.location.replace(`/p/${ad.uuid}`); else setErro(ad.error || 'Não foi possível aceitar o convite.');
        }
      }
    })().catch(() => setErro('Sem conexão com o servidor.'));
  }, []);

  const onSubmit = e => {
    e.preventDefault();
    if (f.senha !== f.confirmar) return setLocalErr('As senhas não conferem');
    setLocalErr('');
    submit({ nome: f.nome, sobrenome: f.sobrenome, telefone: f.telefone.replace(/\D/g, ''), senha: f.senha });
  };

  if (erro) return <AuthShell title="Convite" footer={<AuthLink href="/login">Ir para o login</AuthLink>}><div className="auth-err">{erro}</div></AuthShell>;
  if (!info) return <AuthShell title="Convite"><p className="auth-sub">Carregando…</p></AuthShell>;

  if (feito) {
    return (
      <AuthShell title="Quase lá!" footer={<AuthLink href="/login">Ir para o login</AuthLink>}>
        <div className="auth-ok">Cadastro realizado! Enviamos um link de confirmação para <b>{info.email}</b>. Clique nele para verificar o e-mail; em seguida você será levado(a) ao login.</div>
      </AuthShell>
    );
  }

  if (info.contaExistente) {
    const next = encodeURIComponent(`/convite?token=${token}`);
    return (
      <AuthShell title="Convite para editar" subtitle={`${info.convidadoPor} convidou você para o projeto “${info.projeto}”.`}>
        <p className="auth-sub">Já existe uma conta para <b>{info.email}</b>. Entre para aceitar o convite.</p>
        <a className="auth-btn auth-btn-link" href={`/login?next=${next}`}>Entrar e aceitar</a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Você foi convidado(a)" subtitle={`${info.convidadoPor} convidou você para editar o projeto “${info.projeto}”. Crie sua conta para aceitar.`}
      footer={<>Já tem conta? <AuthLink href={`/login?next=${encodeURIComponent(`/convite?token=${token}`)}`}>Entrar</AuthLink></>}>
      <form className="auth-form" onSubmit={onSubmit}>
        {(localErr || error) && <div className="auth-err" role="alert">{localErr || error}</div>}
        <div className="auth-row">
          <Field label="Nome" required maxLength={60} autoComplete="given-name" value={f.nome} onChange={set('nome')} autoFocus />
          <Field label="Sobrenome" required maxLength={60} autoComplete="family-name" value={f.sobrenome} onChange={set('sobrenome')} />
        </div>
        <Field label="E-mail (do convite)" type="email" value={info.email} readOnly />
        <Field label="Telefone" type="tel" required inputMode="numeric" autoComplete="tel-national" placeholder="(11) 91234-5678" value={f.telefone} onChange={set('telefone')} />
        <Field label="Senha (mín. 8 caracteres)" type="password" required minLength={8} autoComplete="new-password" value={f.senha} onChange={set('senha')} />
        <Field label="Confirmar senha" type="password" required minLength={8} autoComplete="new-password" value={f.confirmar} onChange={set('confirmar')} />
        <button className="auth-btn" disabled={busy}>{busy ? 'Criando…' : 'Cadastrar e aceitar convite'}</button>
      </form>
    </AuthShell>
  );
}
