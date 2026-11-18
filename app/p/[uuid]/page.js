import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import MindMap from '@/components/MindMap';
import { userFromToken, COOKIE } from '@/lib/auth';
import { getProjectByUuid, projectRole, getProject } from '@/lib/db';

export const dynamic = 'force-dynamic';

// URL única do projeto: /p/<uuid>
// privado: só o dono · convidados: dono + quem aceitou convite (edita) · público: qualquer usuário cadastrado visualiza
export default async function ProjectPage({ params }) {
  const { uuid } = await params;
  const user = userFromToken((await cookies()).get(COOKIE)?.value);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/p/${uuid}`)}`);

  const proj = getProjectByUuid(uuid);
  const papel = proj ? projectRole(user.id, proj.id) : null;
  if (!proj || !papel) {
    // não revela se o projeto existe
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-logo">mind<b>map</b></div>
          <h1>Sem acesso a este projeto</h1>
          <p className="auth-sub">O projeto não existe ou o dono não compartilhou com você. Se recebeu um convite por e-mail, abra o link do convite.</p>
          <div className="auth-foot"><Link href="/meus-mapas">Ir para os meus projetos</Link></div>
        </div>
      </div>
    );
  }
  const current = { id: proj.id, uuid: proj.uuid, name: proj.name, papel, visibilidade: proj.visibilidade };
  // visualizador (somente leitura) recebe os dados direto do servidor; dono/editor carregam pela API
  const initialData = papel === 'viewer' ? getProject(proj.id) : null;
  return <MindMap user={user} current={current} initialData={initialData} />;
}
