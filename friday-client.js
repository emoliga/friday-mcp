const FRIDAY_WEBHOOK_URL =
  process.env.FRIDAY_WEBHOOK_URL ||
  'https://transformacioncefa.app.n8n.cloud/webhook/TextToSQL';

const TIMEOUT_MS = 45_000;

export async function callFriday({ question, chart_type = 'table', history = [] }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(FRIDAY_WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question, chart_type, history }),
      signal:  controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`FRIDAY webhook returned HTTP ${res.status}`);
  }

  const rawText = await res.text();
  console.log('[friday-client] Raw response length:', rawText.length);
  console.log('[friday-client] Raw response preview:', rawText.substring(0, 300));

  if (!rawText || rawText.trim() === '') {
    throw new Error('FRIDAY devolvió una respuesta vacía');
  }

  try {
    return JSON.parse(rawText);
  } catch (e) {
    console.error('[friday-client] JSON parse error:', e.message);
    console.error('[friday-client] Full raw response:', rawText);
    throw new Error(`Respuesta inválida de FRIDAY: ${e.message}`);
  }
}
