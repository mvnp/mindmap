import { withAuth, fail } from '@/lib/auth';
import { clientFor, friendlyError, aiRateLimit, recordUsage } from '@/lib/ai';
import { TOOLS, systemPrompt } from '@/lib/ai-tools';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_BODY = 14 * 1024 * 1024;   // capturas de tela em base64
const MAX_MESSAGES = 500;

// Um passo do agente: repassa para a API da Anthropic (com a chave do usuário, guardada no servidor) e devolve os eventos
// de streaming como SSE. As ferramentas são executadas no navegador, que chama esta rota de novo com os resultados.
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    aiRateLimit(user.id);
    const raw = await req.text();
    if (raw.length > MAX_BODY) return Response.json({ error: 'A conversa ficou grande demais. Limpe-a e tente de novo.' }, { status: 413 });
    const { messages, run } = JSON.parse(raw);
    if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES
      || !messages.every(m => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)))) {
      return Response.json({ error: 'mensagens inválidas' }, { status: 400 });
    }
    const { client, settings } = clientFor(user.id);

    // consumo: um registro por prompt (run.id); cada chamada soma os seus tokens
    const usage = { in: 0, cw: 0, cr: 0, out: 0 };
    const record = () => {
      try { recordUsage({ userId: user.id, runId: run?.id, projectUuid: run?.project, prompt: run?.prompt, model: settings.model, effort: settings.effort, usage }); }
      catch (e) { console.error('ai_usage:', e); }
    };
    const readUsage = (type, ev) => {   // message_start traz a entrada; message_delta traz a saída acumulada
      const u = type === 'message_start' ? ev.message?.usage : ev.usage;
      if (!u) return;
      if (u.input_tokens != null) usage.in = u.input_tokens;
      if (u.cache_creation_input_tokens != null) usage.cw = u.cache_creation_input_tokens;
      if (u.cache_read_input_tokens != null) usage.cr = u.cache_read_input_tokens;
      if (u.output_tokens != null) usage.out = u.output_tokens;
    };

    let stream;
    try {
      stream = await client.messages.create({
        model: settings.model,
        max_tokens: 32000,
        system: systemPrompt(settings.prompt),
        tools: TOOLS,
        messages,
        output_config: { effort: settings.effort },
        cache_control: { type: 'ephemeral' },   // cache automático do prefixo: a conversa só cresce, então os turnos seguintes ficam bem mais baratos
        stream: true,
      }, { signal: req.signal });
    } catch (e) {
      record();   // a tentativa conta como uma chamada (sem tokens)
      const f = friendlyError(e);
      return Response.json({ error: f.error }, { status: f.status });
    }

    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(ctrl) {
        const send = (event, data) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          for await (const ev of stream) {
            if (ev.type === 'message_start' || ev.type === 'message_delta') readUsage(ev.type, ev);
            send(ev.type, ev);
          }
        } catch (e) {
          if (!req.signal.aborted) send('error', { type: 'error', error: { message: friendlyError(e).error } });
        }
        record();   // também quando o usuário para no meio: os tokens já gastos são cobrados
        try { ctrl.close(); } catch {}
      },
      cancel() { try { stream.controller?.abort(); } catch {} },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch (e) { return fail(e); }
});
