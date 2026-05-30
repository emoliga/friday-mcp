/**
 * result-formatter.js
 * Converts the FRIDAY webhook response (which contains HTML + metadata)
 * into an MCP tool result with:
 *   - content[0]: text  — human-readable summary for ChatGPT
 *   - content[1]: text  — raw JSON data (rows) as a fenced block
 */

// ── HTML → plain text ─────────────────────────────────────────────────
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Extract table rows from HTML ──────────────────────────────────────
// Parses <table><thead>/<tbody> if present, otherwise returns null.
function extractTableRows(html) {
  if (!html) return null;

  const theadMatch = html.match(/<thead[\s\S]*?<\/thead>/i);
  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/i);

  if (!theadMatch || !tbodyMatch) return null;

  function parseCells(rowHtml) {
    const cells = [];
    const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let m;
    while ((m = re.exec(rowHtml)) !== null) {
      cells.push(stripHtml(m[1]).trim());
    }
    return cells;
  }

  const headerRow = theadMatch[0].match(/<tr[\s\S]*?<\/tr>/i);
  const headers   = headerRow ? parseCells(headerRow[0]) : [];

  const bodyRows  = tbodyMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const rows = bodyRows
    .map(rowHtml => {
      const cells = parseCells(rowHtml);
      if (cells.length === 0) return null;
      if (headers.length > 0) {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cells[i] ?? null; });
        return obj;
      }
      return cells;
    })
    .filter(Boolean);

  return { headers, rows };
}

// ── Chart.js data → rows (bar/line charts) ───────────────────────────
// The HTML contains a Chart.js `data` object we can pull out.
function extractChartData(html) {
  if (!html) return null;

  try {
    // Pull labels
    const labelsMatch = html.match(/labels\s*:\s*(\[[\s\S]*?\])/);
    // Pull first dataset data array
    const dataMatch   = html.match(/\bdata\s*:\s*(\[[\s\S]*?\])/);
    // Pull label name
    const labelMatch  = html.match(/label\s*:\s*["']([^"']+)["']/);

    if (!labelsMatch || !dataMatch) return null;

    const labels   = JSON.parse(labelsMatch[1]);
    const values   = JSON.parse(dataMatch[1]);
    const colName  = labelMatch ? labelMatch[1] : 'valor';

    const rows = labels.map((lbl, i) => ({
      etiqueta: lbl,
      [colName]: values[i]
    }));

    return { headers: ['etiqueta', colName], rows };
  } catch {
    return null;
  }
}

// ── Rows → readable text summary ─────────────────────────────────────
function rowsToText(tableData, question) {
  if (!tableData || tableData.rows.length === 0) {
    return 'No se encontraron datos para esta consulta.';
  }

  const { headers, rows } = tableData;
  const lines = [`Resultados para: "${question}"`, `(${rows.length} fila${rows.length !== 1 ? 's' : ''})\n`];

  rows.forEach((row, i) => {
    if (Array.isArray(row)) {
      lines.push(`${i + 1}. ${row.join(' | ')}`);
    } else {
      const parts = Object.entries(row).map(([k, v]) => `${k}: ${v ?? '—'}`);
      lines.push(`${i + 1}. ${parts.join('  ·  ')}`);
    }
  });

  return lines.join('\n');
}

// ── Main export ───────────────────────────────────────────────────────
/**
 * Builds an MCP tool result from a FRIDAY webhook response.
 *
 * MCP content array:
 *   [0] type:text  — Human-readable answer (for ChatGPT to use in its reply)
 *   [1] type:text  — JSON data block (rows in structured form)
 *
 * @param {Object} fridayResponse  - Raw JSON from FRIDAY webhook
 * @param {string} question        - Original question (for display)
 * @returns {Object}               - MCP tool result
 */
export function buildToolResult(fridayResponse, question) {
  // ── Clarification request ─────────────────────────────────────────
  if (fridayResponse?.type === 'clarification') {
    const msg = fridayResponse.message ?? 'Necesito más información para responder.';
    return {
      content: [
        { type: 'text', text: `FRIDAY necesita una aclaración:\n\n${msg}` }
      ],
      isError: false
    };
  }

  // ── Error from FRIDAY ─────────────────────────────────────────────
  if (fridayResponse?.isError) {
    const errMsg = stripHtml(fridayResponse.html ?? '')
      || 'No se pudo obtener respuesta de FRIDAY.';
    return {
      content: [{ type: 'text', text: `Error de FRIDAY: ${errMsg}` }],
      isError: true
    };
  }

  // ── Normal result (HTML with table or chart) ──────────────────────
  const html = fridayResponse?.html ?? '';

  // Try to extract structured data
  const tableData = extractTableRows(html) ?? extractChartData(html);

  // Build readable summary
  const readableSummary = tableData
    ? rowsToText(tableData, question)
    : (stripHtml(html) || 'No se encontraron datos para esta consulta.');

  // Build JSON payload
  const jsonPayload = tableData
    ? { question, rows: tableData.rows, headers: tableData.headers, count: tableData.rows.length }
    : { question, rows: [], headers: [], count: 0, note: 'No se pudieron extraer datos estructurados.' };

  return {
    content: [
      {
        type: 'text',
        text: readableSummary
      },
      {
        type: 'text',
        text: '```json\n' + JSON.stringify(jsonPayload, null, 2) + '\n```'
      }
    ],
    isError: false
  };
}
