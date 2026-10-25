// Vercel serverless function: validates the request and sends it via Resend.
const hits = new Map(), done = new Set(); // in-memory, best-effort (resets on cold start)
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail = (res, code) => res.status(code).json({ ok: false });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return fail(res, 405);
  const { RESEND_API_KEY: key, ORDER_NOTIFICATION_EMAIL: to, ORDER_FROM_EMAIL: from, ALLOWED_ORIGIN: origin } = process.env;
  if (!key || !to || !from) return fail(res, 500);
  if (origin && req.headers.origin !== origin) return fail(res, 403);

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 600000);
  if (recent.length >= 5) return fail(res, 429);
  hits.set(ip, [...recent, now]);

  let b = req.body;
  try { if (typeof b === 'string') b = JSON.parse(b); } catch { return fail(res, 400); }
  if (!b || typeof b !== 'object' || JSON.stringify(b).length > 12000) return fail(res, 400);
  if (b.website) return res.status(200).json({ ok: true }); // honeypot: silently drop bots

  const tg = String(b.telegram || '').trim(), ds = String(b.description || '').trim();
  const refs = Array.isArray(b.references) ? b.references.map(String) : [];
  const id = String(b.requestId || '');
  if (!/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(tg) || tg.endsWith('_')) return fail(res, 400);
  if (!ds || ds.length > 3000 || refs.length > 5 || !/^[\w-]{8,64}$/.test(id)) return fail(res, 400);
  for (const u of refs) { try { if (!/^https?:$/.test(new URL(u).protocol) || u.length > 200) throw 0; } catch { return fail(res, 400); } }
  if (done.has(id)) return res.status(200).json({ ok: true, duplicate: true });

  const user = tg.startsWith('@') ? tg : '@' + tg;
  const date = new Date().toLocaleString('ru-RU', { timeZone: 'UTC' }) + ' (UTC)';
  const text = `Новая заявка на создание сайта (отправлена с сайта)\n\nTelegram: ${user}\nДата: ${date}\n\nОписание:\n${ds}\n\nПримеры сайтов:\n${refs.join('\n') || 'не указаны'}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px"><h2>Новая заявка на создание сайта</h2><p style="color:#666">Заявка отправлена с сайта · ${esc(date)}</p><p><b>Telegram:</b> ${esc(user)}</p><p><b>Описание проекта:</b></p><p style="white-space:pre-wrap">${esc(ds)}</p><p><b>Примеры сайтов:</b></p><p style="white-space:pre-wrap">${esc(refs.join('\n') || 'не указаны')}</p></div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': id },
      body: JSON.stringify({ from, to: [to], subject: 'Новая заявка на создание сайта', html, text })
    });
    if (!r.ok) return fail(res, 502);
    done.add(id);
    return res.status(200).json({ ok: true });
  } catch { return fail(res, 502); }
}
