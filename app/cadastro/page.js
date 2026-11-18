'use client';
import { useState } from 'react';
import { AuthShell, Field, AuthLink, useSubmit, maskPhone } from '@/components/AuthShell';

export default function CadastroPage() {
  const [f, setF] = useState({ nome: '', sobrenome: '', email: '', telefone: '', senha: '', confirmar: '' });
  const [localErr, setLocalErr] = useState('');
  const { submit, busy, error } = useSubmit('/api/auth/register', () => { window.location.href = '/login?ok=cadastro'; });
  const set = k => e => setF(s => ({ ...s, [k]: k === 'telefone' ? maskPhone(e.target.value) : e.target.value }));

  const onSubmit = e => {
    e.preventDefault();
    if (f.senha !== f.confirmar) return setLocalErr('As senhas não conferem');
    setLocalErr('');
    // o telefone vai somente com dígitos (a máscara existe só na tela)
    submit({ nome: f.nome, sobrenome: f.sobrenome, email: f.email, telefone: f.telefone.replace(/\D/g, ''), senha: f.senha });
  };

  return (
    <AuthShell title="Criar conta" subtitle="Seus projetos ficam vinculados ao seu login"
      footer={<>Já tem conta? <AuthLink href="/login">Entrar</AuthLink></>}>
      <form className="auth-form" onSubmit={onSubmit}>
        {(localErr || error) && <div className="auth-err" role="alert">{localErr || error}</div>}
        <div className="auth-row">
          <Field label="Nome" required maxLength={60} autoComplete="given-name" value={f.nome} onChange={set('nome')} autoFocus />
          <Field label="Sobrenome" required maxLength={60} autoComplete="family-name" value={f.sobrenome} onChange={set('sobrenome')} />
        </div>
        <Field label="E-mail" type="email" required autoComplete="email" value={f.email} onChange={set('email')} />
        <Field label="Telefone" type="tel" required inputMode="numeric" autoComplete="tel-national" placeholder="(11) 91234-5678" value={f.telefone} onChange={set('telefone')} />
        <Field label="Senha (mín. 8 caracteres)" type="password" required minLength={8} autoComplete="new-password" value={f.senha} onChange={set('senha')} />
        <Field label="Confirmar senha" type="password" required minLength={8} autoComplete="new-password" value={f.confirmar} onChange={set('confirmar')} />
        <button className="auth-btn" disabled={busy}>{busy ? 'Criando…' : 'Cadastrar'}</button>
      </form>
    </AuthShell>
  );
}
