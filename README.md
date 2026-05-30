# FRIDAY MCP Server

Servidor MCP que expone el módulo NLP/TextToSQL de FRIDAY (SPES) como herramienta
para ChatGPT y otros clientes MCP compatibles.

## Arquitectura

```
ChatGPT (MCP client)
    │  POST /mcp  (JSON-RPC 2.0)
    ▼
friday-mcp (este servidor, en Render)
    │  POST /webhook/TextToSQL
    ▼
n8n Cloud (FRIDAY workflow)
    │
    ▼
GPT-4o mini → Supabase RPC → HTML/JSON
```

## Deploy en Render

### 1. Subir a GitHub

```bash
git init
git add .
git commit -m "feat: FRIDAY MCP server"
git remote add origin https://github.com/TU_USUARIO/friday-mcp.git
git push -u origin main
```

### 2. Crear Web Service en Render

1. Ve a [render.com](https://render.com) → **New → Web Service**
2. Conecta el repositorio `friday-mcp`
3. Configura:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free (suficiente para empezar)

### 3. Variables de entorno (opcional)

Si quieres cambiar la URL del webhook sin tocar código:

| Variable             | Valor por defecto                                                    |
|----------------------|----------------------------------------------------------------------|
| `FRIDAY_WEBHOOK_URL` | `https://transformacioncefa.app.n8n.cloud/webhook/TextToSQL`        |
| `PORT`               | `3000` (Render lo sobreescribe automáticamente)                     |

### 4. URL final

Una vez deployed, Render te dará una URL tipo:
```
https://friday-mcp.onrender.com
```

El endpoint MCP será:
```
https://friday-mcp.onrender.com/mcp
```

---

## Conectar en ChatGPT

1. Ve a **ChatGPT → Settings → Apps** (antes "Connectors")
2. **Add app → Custom**
3. Introduce la URL: `https://friday-mcp.onrender.com/mcp`
4. Nombre: `FRIDAY SPES`
5. Guarda

Desde ese momento puedes preguntar en cualquier chat:
> "Usa FRIDAY para ver los 5 peores proveedores por PPMs este año"

---

## Herramienta expuesta

### `consultar_calidad_proveedores`

**Parámetros:**

| Parámetro    | Tipo     | Requerido | Descripción                                    |
|--------------|----------|-----------|------------------------------------------------|
| `question`   | string   | ✅        | Pregunta en español sobre calidad de proveedores |
| `chart_type` | string   | ❌        | `bar`, `line`, `pie`, `doughnut`, `table` (default: `table`) |
| `history`    | array    | ❌        | Historial `[{role, content}]` para contexto    |

**Respuesta:** texto legible + bloque JSON con las filas de datos.

---

## Test local

```bash
npm install
npm run dev

# En otra terminal:
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "consultar_calidad_proveedores",
      "arguments": {
        "question": "¿Cuáles son los 5 proveedores con peor scorecard este mes?",
        "chart_type": "table"
      }
    }
  }'
```
