"use strict";

/*
 * Tiendanube avisa acá cada pedido pagado o cancelado.
 * Se comprueba la firma, se piden los datos del pedido y se carga en Carteg Sistema.
 */
const tn = require("../_tiendanube");

function responder(res, codigo, datos) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(datos));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return responder(res, 200, { ok: true, info: "Conexión de Carteg con Tiendanube" });
  const faltan = tn.falta(["TN_CLIENT_SECRET", "FB_INTEGRACION_EMAIL", "FB_INTEGRACION_CLAVE"]);
  if (faltan.length) return responder(res, 503, { error: "Faltan claves en Vercel", faltan });

  const cuerpo = await tn.leerCuerpo(req);
  if (!tn.firmaValida(cuerpo, req.headers["x-linkedstore-hmac-sha256"])) return responder(res, 401, { error: "Firma inválida" });

  let aviso;
  try { aviso = JSON.parse(cuerpo.toString("utf8")); } catch (e) { return responder(res, 400, { error: "JSON inválido" }); }
  const { event: evento, id, store_id: tienda } = aviso || {};
  if (!/^order\/(paid|cancelled)$/.test(evento || "") || !id) return responder(res, 200, { ok: true, ignorado: evento || null });

  try {
    const conexion = await tn.leerConexion();
    if (!conexion) return responder(res, 503, { error: "La tienda todavía no está conectada" });
    if (String(tienda) !== conexion.tiendaId) return responder(res, 200, { ok: true, ignorado: "otra tienda" });

    if (evento === "order/cancelled") {
      await tn.marcarCancelada(`tn-${id}`, "Cancelado en Tiendanube");
      await tn.marcarCancelada(`tn-${id}-com`, "Cancelado en Tiendanube");
      return responder(res, 200, { ok: true, cancelado: id });
    }

    const r = await tn.apiTiendanube(conexion, "GET", `/orders/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error("Tiendanube respondió " + r.status);
    const pedido = await r.json();
    if (pedido.payment_status && pedido.payment_status !== "paid") return responder(res, 200, { ok: true, ignorado: "pago " + pedido.payment_status });
    const resultado = await tn.crearSiNoExiste(tn.armarMovimientos(pedido));
    return responder(res, 200, { ok: true, pedido: pedido.number, resultado });
  } catch (e) {
    console.error(e);
    return responder(res, 500, { error: "No se pudo cargar la venta" }); // Tiendanube reintenta solo
  }
};
