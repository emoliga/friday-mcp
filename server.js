/**
 * FRIDAY MCP Server
 * Wraps the FRIDAY/SPES TextToSQL webhook and exposes it as an MCP tool
 * for ChatGPT (and any other MCP-compatible client).
 *
 * Protocol: MCP over HTTP (JSON-RPC 2.0)
 * Transport: Streamable HTTP  (/mcp endpoint) + SSE legacy (/sse)
 */

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { callFriday } from './friday-client.js';
import { buildToolResult } from './result-formatter.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS (ChatGPT origin) ────────────────────────────────────────────
app.use(cors({
  origin: ['https://chatgpt.com', 'https://chat.openai.com', '*'],
  allowedHeaders: ['Content-Type', 'Authorization', 'MCP-Protocol-Version'],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));

// ── MCP metadata ─────────────────────────────────────────────────────
const SERVER_INFO = {
  name:    'friday-spes',
  version: '1.0.0',
  title:   'FRIDAY — SPES Quality Analytics',
  description:
    'Accede a los KPIs de calidad de proveedores de CEFA: ' +
    'scorecards, PPMs, incidencias 8D y retrasos de entrega. ' +
    'Usa lenguaje natural en español.'
};

const PROTOCOL_VERSION = '2025-03-26';

// ── Tool definition ───────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'consultar_calidad_proveedores',
    description:
      'Consulta en lenguaje natural los datos de calidad de proveedores de CEFA. ' +
      'Puedes preguntar por scorecards mensuales o anuales, PPMs (partes por millón defectuosas), ' +
      'incidencias 8D y retrasos de entrega. Ejemplos: ' +
      '"¿Cuáles son los 5 peores proveedores por PPMs este año?", ' +
      '"Muéstrame el scorecard de Acero SA por mes en 2025", ' +
      '"¿Cuántos retrasos ha tenido el proveedor 12345 este trimestre?"',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            'Pregunta en lenguaje natural sobre los datos de calidad de proveedores. ' +
            'Escribe en español con el máximo detalle posible: proveedor, métrica y período.'
        },
        chart_type: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'doughnut', 'table'],
          description:
            'Tipo de visualización deseada. Usa "table" para ver los datos en bruto. ' +
            'Default: "bar".',
          default: 'table'
        },
        history: {
          type: 'array',
          description:
            'Historial de la conversación previa para resolver referencias como ' +
            '"ese proveedor", "la misma métrica", etc. ' +
            'Cada elemento tiene {role: "user"|"assistant", content: "..."}.',
          items: {
            type: 'object',
            properties: {
              role:    { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' }
            },
            required: ['role', 'content']
          },
          default: []
        }
      },
      required: ['question']
    }
  }
];

// ── JSON-RPC dispatcher ───────────────────────────────────────────────
async function handleRpc(req, sessionId) {
  const { jsonrpc, method, params = {}, id } = req;

  if (jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC version' } };
  }

  // ── initialize ──────────────────────────────────────────────────────
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: { listChanged: false } }
      }
    };
  }

  // ── notifications/initialized (no response needed) ──────────────────
  if (method === 'notifications/initialized') {
    return null;
  }

  // ── tools/list ──────────────────────────────────────────────────────
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  // ── tools/call ──────────────────────────────────────────────────────
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;

    if (name !== 'consultar_calidad_proveedores') {
      return {
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Unknown tool: ${name}` }
      };
    }

    const { question, chart_type = 'table', history = [] } = args;

    if (!question || !question.trim()) {
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: 'Error: el parámetro "question" es obligatorio.' }],
          isError: true
        }
      };
    }

    // Call FRIDAY webhook
    let fridayResponse;
    try {
      fridayResponse = await callFriday({ question, chart_type, history });
    } catch (err) {
      console.error('[friday-mcp] Error calling FRIDAY webhook:', err.message);
      return {
        jsonrpc: '2.0', id,
        result: {
          content: [{
            type: 'text',
            text: `Error al conectar con FRIDAY: ${err.message}`
          }],
          isError: true
        }
      };
    }

    // Format result for MCP
    const mcpResult = buildToolResult(fridayResponse, question);

    return { jsonrpc: '2.0', id, result: mcpResult };
  }

  // ── ping ────────────────────────────────────────────────────────────
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  return {
    jsonrpc: '2.0', id,
    error: { code: -32601, message: `Method not found: ${method}` }
  };
}

// ── Streamable HTTP endpoint (/mcp) ───────────────────────────────────
// Handles both single requests and batches.
app.post('/mcp', async (req, res) => {
  const body       = req.body;
  const sessionId  = req.headers['mcp-session-id'] ?? randomUUID();

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('MCP-Session-Id', sessionId);

  const isArray = Array.isArray(body);
  const requests = isArray ? body : [body];

  const responses = (
    await Promise.all(requests.map(r => handleRpc(r, sessionId)))
  ).filter(Boolean); // remove nulls (notifications)

  if (responses.length === 0) {
    return res.status(204).end();
  }

  res.json(isArray ? responses : responses[0]);
});

// ── Legacy SSE endpoint (/sse) ────────────────────────────────────────
// Some older MCP clients (and ChatGPT Developer Mode beta) still probe /sse.
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send endpoint info immediately
  const endpointEvent = JSON.stringify({
    jsonrpc: '2.0',
    method:  'endpoint',
    params:  { uri: '/mcp' }
  });
  res.write(`data: ${endpointEvent}\n\n`);

  // Keep alive ping every 25 s (Render closes idle SSE after 30 s)
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => clearInterval(keepAlive));
});

// ── Health check ──────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    server: SERVER_INFO.name,
    version: SERVER_INFO.version,
    endpoints: { mcp: '/mcp', sse: '/sse' }
  });
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[friday-mcp] Server running on port ${PORT}`);
  console.log(`[friday-mcp] MCP endpoint: http://localhost:${PORT}/mcp`);
});
