// "Print" do mapa para a IA: desenha em um canvas exatamente o que está na área visível (ou o mapa inteiro),
// a partir dos mesmos dados que o editor usa (posições, tamanhos medidos, cores, linhas). Devolve PNG em base64.
import { visibleSet, effColor, edgeGeom } from '@/lib/mm-core';

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const word of para.split(/(\s+)/)) {
      const t = cur + word;
      if (cur && ctx.measureText(t).width > maxW) { lines.push(cur.trimEnd()); cur = word.trimStart(); } else cur = t;
    }
    lines.push(cur.trimEnd());
  }
  return lines;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// o: { nodes, sizes, view:{x,y,s}, box:{w,h}, selected:Set, full:boolean, maxDim }
export function renderShot(o) {
  const { nodes, sizes, box, selected = new Set(), maxDim = 1280 } = o;
  const vis = visibleSet(nodes);
  let view = o.view;
  if (o.full) {   // enquadra o mapa todo na imagem
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) if (vis.has(n.id) && sizes[n.id] && n.x != null) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + sizes[n.id].w); y1 = Math.max(y1, n.y + sizes[n.id].h);
    }
    if (x0 !== Infinity) {
      const pad = 50, s = Math.min(1.5, (box.w - pad * 2) / (x1 - x0 || 1), (box.h - pad * 2) / (y1 - y0 || 1));
      view = { s, x: box.w / 2 - ((x0 + x1) / 2) * s, y: box.h / 2 - ((y0 + y1) / 2) * s };
    }
  }
  const f = Math.min(1, maxDim / Math.max(box.w, box.h));
  const cw = Math.max(1, Math.round(box.w * f)), ch = Math.max(1, Math.round(box.h * f));
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.scale(f, f);

  // fundo + pontos da grade (como o palco)
  ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, box.w, box.h);
  const step = 24 * view.s;
  if (step > 6) {
    ctx.fillStyle = '#d4d4d4';
    for (let gx = ((view.x % step) + step) % step; gx < box.w; gx += step)
      for (let gy = ((view.y % step) + step) % step; gy < box.h; gy += step) { ctx.beginPath(); ctx.arc(gx, gy, 1.2, 0, 6.3); ctx.fill(); }
  }

  ctx.save();
  ctx.translate(view.x, view.y); ctx.scale(view.s, view.s);
  // linhas
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const e of edgeGeom(nodes, sizes, vis)) { ctx.strokeStyle = e.c; ctx.stroke(new Path2D(e.d)); }
  // blocos
  const rootId = nodes.find(n => !n.parent)?.id;
  for (const n of nodes) {
    const z = sizes[n.id];
    if (!vis.has(n.id) || !z || n.x == null) continue;
    const isRoot = n.id === rootId, color = effColor(nodes, n);
    const size = n.size || (isRoot ? 22 : 16);
    const fill = n.bg || (isRoot ? color : null);
    rrect(ctx, n.x, n.y, z.w, z.h, isRoot ? 12 : 8);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.lineWidth = 2;
    if (selected.has(n.id)) { ctx.strokeStyle = '#4f7cf7'; ctx.setLineDash([]); }
    else { ctx.strokeStyle = '#55555588'; ctx.setLineDash([5, 4]); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `${n.bold || isRoot ? 700 : 400} ${size}px ${FONT}`;
    ctx.fillStyle = n.fg || (isRoot ? '#fff' : '#222'); ctx.textBaseline = 'top';
    const padX = isRoot ? 20 : 12, padY = isRoot ? 10 : 6;
    const lines = n.w ? wrap(ctx, n.text, z.w - padX * 2 - 4) : [n.text];
    lines.forEach((ln, i) => ctx.fillText(ln, n.x + padX + 2, n.y + padY + 2 + i * size * 1.3));
    if (n.collapsed && nodes.some(m => m.parent === n.id)) {   // selo "+N" dos recolhidos
      ctx.fillStyle = color; rrect(ctx, n.x + z.w - 8, n.y - 8, 30, 18, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 11px ${FONT}`; ctx.fillText('+…', n.x + z.w - 1, n.y - 5);
    }
  }
  ctx.restore();

  const url = cv.toDataURL('image/png');
  return { data: url.split(',')[1], media_type: 'image/png', w: cw, h: ch, url };
}

// imagem enviada pelo usuário (colar/anexar): reduz para no máx. 1568px e devolve { data, media_type, url }
export async function fileToImage(file, maxDim = 1568) {
  const bmp = await createImageBitmap(file);
  const f = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * f); cv.height = Math.round(bmp.height * f);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL('image/jpeg', 0.88);
  return { data: url.split(',')[1], media_type: 'image/jpeg', w: cv.width, h: cv.height, url };
}
