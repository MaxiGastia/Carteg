"use strict";

/*
 * Tiendanube vuelve acá después de que el dueño toca "Autorizar" en su tienda.
 * Se cambia el código por el token, se guarda en Firebase y se registran los avisos de pedidos.
 */
const tn = require("../_tiendanube");

const WEBHOOK_URL = "https://www.carteg.com.ar/api/tiendanube/webhook";
const EVENTOS = ["order/paid", "order/cancelled"];

function pagina(res, codigo, titulo, texto) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  res.end(`<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titulo)} · Carteg</title>
<style>body{margin:0;background:#0a0c08;color:#f4f6ee;font:16px/1.5 'Segoe UI',Roboto,Arial,sans-serif}main{max-width:520px;margin:0 auto;padding:40px 16px}
.panel{background:#14170f;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:20px}h1{font-size:22px;margin:0 0 8px}p{color:#aeb3a4;margin:0 0 12px}a{color:#c9f73a}</style></head>
<body><main><div class="panel"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p><p><a href="/sistema/">Ir a Carteg Sistema</a></p></div></main></body></html>`);
}

module.exports = async (req, res) => {
  const faltan = tn.falta(["TN_APP_ID", "TN_CLIENT_SECRET", "FB_INTEGRACION_EMAIL", "FB_INTEGRACION_CLAVE"]);
  if (faltan.length) return pagina(res, 503, "Falta configurar Vercel", "Todavía faltan estas claves en Vercel: " + faltan.join(", ") + ".");
  const codigo = String((req.query && req.query.code) || "");
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(codigo)) return pagina(res, 400, "Falta la autorización", "Entrá desde el link de instalación de la app para conectar tu tienda.");

  try {
    const r = await tn.pedir("https://www.tiendanube.com/apps/authorize/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": tn.USER_AGENT },
      body: JSON.stringify({ client_id: process.env.TN_APP_ID, client_secret: process.env.TN_CLIENT_SECRET, grant_type: "authorization_code", code: codigo }),
    }, 6000);
    const d = await r.json().catch(() => ({}));
    const tiendaId = d.user_id || d.store_id;
    if (!r.ok || !d.access_token || !tiendaId) return pagina(res, 400, "No se pudo conectar", "Tiendanube no aceptó la autorización (puede que el link haya vencido: dura 5 minutos). Probá de nuevo desde el link de instalación.");

    await tn.guardarConexion(d.access_token, tiendaId);
    const conexion = { token: d.access_token, tiendaId: String(tiendaId) };

    /* Registra los avisos (si ya existían, no los duplica) */
    const lista = await tn.apiTiendanube(conexion, "GET", "/webhooks");
    const existentes = lista.ok ? await lista.json() : [];
    for (const evento of EVENTOS) {
      if (Array.isArray(existentes) && existentes.some(w => w.event === evento && w.url === WEBHOOK_URL)) continue;
      const w = await tn.apiTiendanube(conexion, "POST", "/webhooks", { event: evento, url: WEBHOOK_URL });
      if (!w.ok) throw new Error("No se pudo registrar el aviso " + evento + " (" + w.status + ")");
    }
    return pagina(res, 200, "¡Tienda conectada!", "Desde ahora, cada venta pagada en tu tienda de Tiendanube se carga sola en Carteg Sistema, con la comisión de cobro estimada.");
  } catch (e) {
    console.error(e);
    return pagina(res, 500, "No se pudo terminar la conexión", "Algo falló al guardar la conexión. Avisale a quien te ayuda con el sistema y probá de nuevo.");
  }
};
