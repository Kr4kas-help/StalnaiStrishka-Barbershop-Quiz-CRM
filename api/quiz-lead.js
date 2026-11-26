const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const AMO_BASE = 'https://skhoroltsev7.amocrm.ru';
const GIFT_URL = 'https://lidmagnit-barbershop-stalnaistrishk.vercel.app/';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function emailHtml({ fio, plan }) {
  const cards = Array.isArray(plan?.cards) ? plan.cards : [];
  const rows = cards.map((card) => `<tr><td style="padding:12px 0;border-bottom:1px solid #eadfc9"><div style="font:11px Arial,sans-serif;letter-spacing:2px;color:#b08a45">${escapeHtml(card.label)}</div><strong style="display:block;margin-top:4px;font:600 18px Georgia,serif;color:#241b11">${escapeHtml(card.title)}</strong><div style="margin-top:5px;font:14px/1.5 Arial,sans-serif;color:#6d6254">${escapeHtml(card.detail)}</div></td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f5f0e7;padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fffdf8;border:1px solid #e5d8bf"><tr><td style="padding:34px 34px 20px;background:#18120d;color:#f6eedf"><div style="font:11px Arial,sans-serif;letter-spacing:3px;color:#d8b66d">СТАЛЬНАЯ СТРИЖКА · ХИМКИ</div><h1 style="margin:18px 0 8px;font:600 34px Georgia,serif">Ваш подарок готов</h1><p style="margin:0;font:16px/1.5 Arial,sans-serif;color:#d9cdb9">Персональная схема ухода за волосами для ${escapeHtml(fio)}.</p></td></tr><tr><td style="padding:26px 34px"><table width="100%" cellspacing="0" cellpadding="0">${rows}</table><p style="font:15px/1.6 Arial,sans-serif;color:#6d6254">Откройте полный гид по уходу, ингредиентам и ежедневной рутине:</p><p><a href="${GIFT_URL}" style="display:inline-block;padding:14px 22px;background:#c9a45c;color:#21170b;text-decoration:none;font:600 14px Arial,sans-serif;border-radius:4px">Открыть мой гид</a></p><p style="margin:24px 0 0;font:12px/1.5 Arial,sans-serif;color:#8a7e6e">Материал носит информационный характер и не заменяет консультацию специалиста.</p></td></tr><tr><td style="padding:18px 34px;background:#f1eadc;color:#756956;font:12px Arial,sans-serif">Стальная стрижка · Барбершоп в Химках</td></tr></table></td></tr></table></body></html>`;
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

async function createAmoLead(payload) {
  const token = process.env.AMOCRM_TOKEN;
  if (!token) throw new Error('AMOCRM_TOKEN is not configured');
  const note = [`Email: ${payload.email}`, `Телефон: ${payload.phone}`, `Ответы квиза: ${JSON.stringify(payload.answers || {})}`, `План: ${JSON.stringify(payload.plan || {})}`].join('\n');
  const contact = await fetch(`${AMO_BASE}/api/v4/contacts`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify([{ name: payload.fio, custom_fields_values: [{ field_code:'PHONE', values:[{ value:payload.phone, enum_code:'WORK' }] }, { field_code:'EMAIL', values:[{ value:payload.email, enum_code:'WORK' }] }] }]) });
  if (!contact.ok) throw new Error(`amo contact ${contact.status}: ${await contact.text()}`);
  const contactData = await contact.json();
  const contactId = contactData?._embedded?.contacts?.[0]?.id;
  const lead = await fetch(`${AMO_BASE}/api/v4/leads`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify([{ name:`Подарок за квиз — ${payload.fio}`, pipeline_id:Number(process.env.AMOCRM_PIPELINE_ID || 11540878), price:0, _embedded:{ contacts: contactId ? [{ id: contactId }] : [] }, custom_fields_values:[] }]) });
  if (!lead.ok) throw new Error(`amo lead ${lead.status}: ${await lead.text()}`);
  const leadData = await lead.json();
  const leadId = leadData?._embedded?.leads?.[0]?.id;
  if (leadId) {
    await fetch(`${AMO_BASE}/api/v4/leads/${leadId}/notes`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify([{ note_type:'common', params:{ text:note } }]) });
  }
  return { contactId, leadId };
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error:'Method not allowed' }, 405);
  try {
    const payload = await request.json();
    if (!payload?.consent || !payload?.fio || !payload?.phone || !payload?.email) return json({ error:'Заполните обязательные поля и подтвердите согласие.' }, 400);
    const from = process.env.RESEND_FROM;
    if (!from || !process.env.RESEND_API_KEY) throw new Error('Resend is not configured');
    const amo = await createAmoLead(payload);
    const mail = await fetch(RESEND_ENDPOINT, { method:'POST', headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' }, body:JSON.stringify({ from, to:[payload.email], subject:'Ваш персональный гид от «Стальной стрижки»', html:emailHtml(payload) }) });
    if (!mail.ok) throw new Error(`resend ${mail.status}: ${await mail.text()}`);
    return json({ ok:true, amo });
  } catch (error) {
    console.error(error);
    return json({ error:'Не удалось обработать заявку. Попробуйте ещё раз.' }, 500);
  }
}

