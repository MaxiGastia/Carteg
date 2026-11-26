"use strict";

/*
 * Avisos de privacidad que Tiendanube exige a toda app (store/redact, customers/redact, customers/data_request).
 * Se comprueba la firma y se responde OK. Carteg Sistema es de uso interno del dueño de la tienda:
 * los pedidos guardados se borran a mano desde Carteg Sistema si un cliente lo pide.
 */
const tn = require("../_tiendanube");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") { res.statusCode = 200; return res.end(JSON.stringify({ ok: true })); }
  const cuerpo = await tn.leerCuerpo(req);
  if (!tn.firmaValida(cuerpo, req.headers["x-linkedstore-hmac-sha256"])) { res.statusCode = 401; return res.end(JSON.stringify({ error: "Firma inválida" })); }
  console.log("Aviso de privacidad de Tiendanube:", cuerpo.toString("utf8").slice(0, 500));
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
};
