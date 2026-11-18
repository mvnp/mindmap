'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Field, useSubmit, maskPhone } from '@/components/AuthShell';

// Valores, limites e avaliações abaixo são texto de apresentação: ajuste livremente.
const PLANOS = [
  {
    id: 'starter', nome: 'Starter', preco: 'R$ 29', desc: 'Para quem está começando a organizar ideias.',
    itens: ['Até 5 projetos', 'Zoom, arrastar e tela cheia (F12)', 'Exportar e importar em JSON', 'Cores de blocos, textos e linhas'],
  },
  {
    id: 'operator', nome: 'Operator', preco: 'R$ 79', desc: 'Para quem trabalha em mapas todos os dias.', destaque: true,
    itens: ['Projetos ilimitados', 'Seleção em massa e “Padrão vertical”', 'Compartilhamento por link e convites por e-mail', 'Visibilidade privada, convidados ou pública'],
  },
  {
    id: 'enterprise', nome: 'Enterprise', preco: 'R$ 199', desc: 'Para times que mapeiam processos juntos.',
    itens: ['Tudo do Operator', 'Editores ilimitados por projeto', 'Suporte prioritário', 'Onboarding do time'],
  },
];

const RECURSOS = [
  ['Tudo parte de um nó', 'Cada mapa nasce de uma ideia central e se ramifica sem perder a organização.'],
  ['Salva a cada ação', 'Criou, moveu, recolorou: já está gravado. Recarregar a página nunca perde nada.'],
  ['Guias de alinhamento', 'Guias tracejadas estilo CAD e bordas dos blocos para alinhar com precisão.'],
  ['Seleção em massa', 'Selecione vários blocos ou linhas, mude cores e arraste todos juntos.'],
  ['Projetos com link único', 'Cada projeto tem sua URL. Compartilhe com convidados ou deixe público.'],
  ['Exportar e importar', 'Leve seu mapa em JSON e restaure em um projeto novo quando quiser.'],
];

// Exemplos de depoimento: troque pelos de clientes reais antes de divulgar.
const AVALIACOES = [
  { nome: 'Camila R.', cargo: 'Product Manager', nota: 5, texto: 'Substituí três ferramentas por uma. Montar o roadmap em mapa mental ficou muito mais rápido.' },
  { nome: 'Rafael T.', cargo: 'Consultor de processos', nota: 5, texto: 'Mando o link do projeto para o cliente e ele já abre o mapa. Sem reunião só para explicar.' },
  { nome: 'Juliana M.', cargo: 'Professora', nota: 4, texto: 'Uso nas aulas para resumir conteúdos. Os alunos entendem a estrutura de relance.' },
];

const Stars = ({ n }) => <span className="lp-stars" aria-label={`${n} de 5 estrelas`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;

function SignupModal({ plano, onClose }) {
  const [f, setF] = useState({ nome: '', sobrenome: '', email: '', telefone: '', senha: '', confirmar: '' });
  const [localErr, setLocalErr] = useState('');
  const { submit, busy, error } = useSubmit('/api/auth/register', () => { window.location.href = '/login?ok=cadastro'; });
  const set = k => e => setF(s => ({ ...s, [k]: k === 'telefone' ? maskPhone(e.target.value) : e.target.value }));

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSubmit = e => {
    e.preventDefault();
    if (f.senha !== f.confirmar) return setLocalErr('As senhas não conferem');
    setLocalErr('');
    submit({ nome: f.nome, sobrenome: f.sobrenome, email: f.email, telefone: f.telefone.replace(/\D/g, ''), senha: f.senha });
  };

  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal lp-signup" role="dialog" aria-modal="true" aria-label="Criar conta">
        <h3>Comece grátis · plano {plano.nome}</h3>
        <p className="auth-sub" style={{ margin: 0 }}>Crie sua conta. Depois do cadastro você vai para o login.</p>
        <form className="auth-form" onSubmit={onSubmit} style={{ marginTop: 4 }}>
          {(localErr || error) && <div className="auth-err" role="alert">{localErr || error}</div>}
          <div className="auth-row">
            <Field label="Nome" required maxLength={60} autoComplete="given-name" value={f.nome} onChange={set('nome')} autoFocus />
            <Field label="Sobrenome" required maxLength={60} autoComplete="family-name" value={f.sobrenome} onChange={set('sobrenome')} />
          </div>
          <Field label="E-mail" type="email" required autoComplete="email" value={f.email} onChange={set('email')} />
          <Field label="Telefone" type="tel" required inputMode="numeric" autoComplete="tel-national" placeholder="(11) 91234-5678" value={f.telefone} onChange={set('telefone')} />
          <Field label="Senha (mín. 8 caracteres)" type="password" required minLength={8} autoComplete="new-password" value={f.senha} onChange={set('senha')} />
          <Field label="Confirmar senha" type="password" required minLength={8} autoComplete="new-password" value={f.confirmar} onChange={set('confirmar')} />
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Fechar</button>
            <button className="primary" disabled={busy}>{busy ? 'Criando…' : 'Cadastrar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Landing() {
  const [plano, setPlano] = useState(null);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <div className="auth-logo" style={{ margin: 0 }}>mind<b>map</b></div>
          <nav>
            <a href="#planos">Planos</a>
            <a href="#avaliacoes">Avaliações</a>
            <Link href="/meus-mapas" className="lp-btn lp-btn-ghost">Meus mapas</Link>
          </nav>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap">
          <h1>Transforme ideias em <span>mapas mentais</span> que todo mundo entende</h1>
          <p>Um quadro infinito, organizado por projetos. Crie ramificações, alinhe com precisão, compartilhe por link e nunca perca uma alteração.</p>
          <div className="lp-cta">
            <a href="#planos" className="lp-btn lp-btn-primary">Ver planos</a>
            <Link href="/meus-mapas" className="lp-btn lp-btn-ghost">Meus mapas</Link>
          </div>
        </div>
      </section>

      <section className="lp-wrap lp-sec">
        <h2>Feito para pensar rápido</h2>
        <div className="lp-grid3">
          {RECURSOS.map(([t, d]) => (
            <div className="lp-card" key={t}><h3>{t}</h3><p>{d}</p></div>
          ))}
        </div>
      </section>

      <section className="lp-wrap lp-sec" id="planos">
        <h2>Planos</h2>
        <p className="lp-lead">Todos começam grátis. Escolha o que cabe no seu momento.</p>
        <div className="lp-grid3">
          {PLANOS.map(p => (
            <div className={`lp-card lp-plan${p.destaque ? ' lp-plan-hl' : ''}`} key={p.id}>
              {p.destaque && <span className="lp-badge">Mais escolhido</span>}
              <h3>{p.nome}</h3>
              <p className="lp-desc">{p.desc}</p>
              <div className="lp-price">{p.preco}<small>/mês</small></div>
              <ul>{p.itens.map(i => <li key={i}>{i}</li>)}</ul>
              <button className="lp-btn lp-btn-primary" onClick={() => setPlano(p)}>Comece grátis</button>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-wrap lp-sec" id="avaliacoes">
        <h2>Quem usa, recomenda</h2>
        <div className="lp-grid3">
          {AVALIACOES.map(a => (
            <figure className="lp-card lp-quote" key={a.nome}>
              <Stars n={a.nota} />
              <blockquote>“{a.texto}”</blockquote>
              <figcaption><b>{a.nome}</b><span>{a.cargo}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <span>© {new Date().getFullYear()} mindmap</span>
          <span><Link href="/login">Entrar</Link> · <Link href="/meus-mapas">Meus mapas</Link></span>
        </div>
      </footer>

      {plano && <SignupModal plano={plano} onClose={() => setPlano(null)} />}
    </div>
  );
}
