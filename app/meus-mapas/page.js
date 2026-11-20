import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { userFromToken, COOKIE } from '@/lib/auth';
import { listProjects, createProject, getProjectUuid } from '@/lib/db';

export const dynamic = 'force-dynamic';

// "Meus mapas": sem sessão vai para o login; com sessão abre o primeiro projeto (cada projeto tem URL única /p/<uuid>)
export default async function Page() {
  const user = userFromToken((await cookies()).get(COOKIE)?.value);
  if (!user) redirect('/login?next=%2Fmeus-mapas');
  const all = listProjects(user.id);
  const mine = all.find(p => p.papel === 'owner');
  if (!mine && user.readonly) {   // leitor não cria projetos: abre o primeiro que foi compartilhado com ele
    if (all[0]) redirect(`/p/${all[0].uuid}`);
    return (
      <div className="auth-wrap"><div className="auth-card">
        <div className="auth-logo">mind<b>map</b></div>
        <h1>Conta somente leitura</h1>
        <p className="auth-sub">Você ainda não tem mapas para visualizar. Peça a alguém para compartilhar um mapa com você.</p>
      </div></div>
    );
  }
  const uuid = mine ? mine.uuid : getProjectUuid(createProject('Meu primeiro projeto', null, user.id));
  redirect(`/p/${uuid}`);
}
