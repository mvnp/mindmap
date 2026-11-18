import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { userFromToken, COOKIE } from '@/lib/auth';
import { listProjects, createProject, getProjectUuid } from '@/lib/db';

export const dynamic = 'force-dynamic';

// "Meus mapas": sem sessão vai para o login; com sessão abre o primeiro projeto (cada projeto tem URL única /p/<uuid>)
export default async function Page() {
  const user = userFromToken((await cookies()).get(COOKIE)?.value);
  if (!user) redirect('/login?next=%2Fmeus-mapas');
  const mine = listProjects(user.id).find(p => p.papel === 'owner');
  const uuid = mine ? mine.uuid : getProjectUuid(createProject('Meu primeiro projeto', null, user.id));
  redirect(`/p/${uuid}`);
}
