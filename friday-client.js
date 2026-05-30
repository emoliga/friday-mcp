/**
 * friday-client.js
 * Calls the FRIDAY/SPES TextToSQL webhook in n8n and returns the raw response.
 */

const FRIDAY_WEBHOOK_URL =
  process.env.FRIDAY_WEBHOOK_URL ||
  'https://transformacioncefa.app.n8n.cloud/webhook/TextToSQL';

const TIMEOUT_MS = 30_000; // 30 s — LLM calls can be slow

/**
 * @param {Object} params
 * @param {string} params.question     - Pregunta en lenguaje natural
 * @param {string} params.chart_type   - 'bar' | 'line' | 'pie' | 'doughnut' | 'table'
 * @param {Array}  params.history      - [{role, content}]
 * @returns {Promise<Object>}          - Raw JSON from FRIDAY
 */
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

  const data = await res.json();
  return data;
}
