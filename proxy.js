import { NextResponse } from 'next/server';

// Primeira barreira: tudo exige sessão, exceto login, cadastro, recuperação/redefinição de senha e verificação.
// (A validação real da sessão é feita no banco, nas rotas de API e na página inicial.)
const PUBLIC_PAGES = ['/login', '/cadastro', '/recuperar-senha', '/redefinir-senha', '/verificar', '/convite'];
// /api/invites: convite por token (o aceite exige login na própria rota). /p/<uuid> exige login (cadastro na ferramenta)
const PUBLIC_PREFIXES = ['/api/invites/'];
const PUBLIC_API = ['/api/auth/login', '/api/auth/register', '/api/auth/forgot', '/api/auth/reset', '/api/auth/verify', '/api/auth/resend', '/api/auth/logout'];

export function proxy(req) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // proteção CSRF: requisições que alteram dados só valem do mesmo site
  if (isApi && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === host; } catch {}
      if (!ok) return NextResponse.json({ error: 'origem não permitida' }, { status: 403 });
    }
  }

  if (PUBLIC_PAGES.includes(pathname) || PUBLIC_API.includes(pathname) || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return NextResponse.next();

  if (!req.cookies.get('mm_session')?.value) {
    if (isApi) return NextResponse.json({ error: 'não autenticado' }, { status: 401 });
    const url = req.nextUrl.clone();
    const dest = pathname + req.nextUrl.search;
    url.pathname = '/login'; url.search = '';
    if (pathname !== '/') url.searchParams.set('next', dest);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };
