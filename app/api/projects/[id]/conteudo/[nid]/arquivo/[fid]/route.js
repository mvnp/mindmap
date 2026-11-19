import fs from 'node:fs';
import { Readable } from 'node:stream';
import { projectRole } from '@/lib/db';
import { getFile, absPath } from '@/lib/conteudo';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// serve um arquivo anexado (só para quem tem acesso ao projeto), com suporte a Range (áudio/PDF) e cabeçalhos que impedem execução
export const GET = withAuth(async (req, { params }, user) => {
  const { id, nid, fid } = await params; const pid = Number(id);
  if (!projectRole(user.id, pid)) return Response.json({ error: 'não encontrado' }, { status: 404 });
  const f = getFile(pid, decodeURIComponent(nid), fid);
  let size;
  try { if (f) size = fs.statSync(absPath(f.caminho)).size; } catch {}
  if (!f || size == null) return Response.json({ error: 'arquivo não encontrado' }, { status: 404 });

  const dl = new URL(req.url).searchParams.get('dl') === '1';
  const headers = {
    'Content-Type': f.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff', 
    'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.nome)}`,
  };
  if (f.tipo !== 'pdf') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";   // PDF precisa do visualizador do navegador
  let start = 0, end = size - 1, status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
    else { start = Math.max(0, size - Number(m[2])); }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  return new Response(Readable.toWeb(fs.createReadStream(absPath(f.caminho), { start, end })), { status, headers });
});
