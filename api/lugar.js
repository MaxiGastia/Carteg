"use strict";

/*
 * Lee un link de Google Maps (por ejemplo el de "Compartir": maps.app.goo.gl/...)
 * y devuelve el código del negocio (Place ID) y el link oficial para dejar reseña.
 * Solo sigue links de Google: no sirve para abrir otras páginas.
 */
const HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|(www\.|maps\.)?google\.[a-z.]{2,8})$/i;
const FID = /(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})/i;

/* El Place ID ("ChIJ…") es el número del negocio en Maps codificado en base64 */
function placeIdDesdeFid(a, b) {
  const buf = Buffer.alloc(20);
  buf[0] = 0x0a; buf[1] = 0x12; buf[2] = 0x09;
  buf.writeBigUInt64LE(BigInt(a), 3);
  buf[11] = 0x11;
  buf.writeBigUInt64LE(BigInt(b), 12);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function responder(res, codigo, datos) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(datos));
}

function leer(url) {
  const texto = decodeURIComponent(url);
  const m = FID.exec(texto);
  if (!m) return null;
  const n = /\/maps\/place\/([^/@?]+)/.exec(url);
  return { fid: m[0], a: m[1], b: m[2], nombre: n ? decodeURIComponent(n[1].replace(/\+/g, " ")) : "" };
}

module.exports = async (req, res) => {
  let url = String((req.query && req.query.u) || "").trim();
  try {
    let u = new URL(url);
    if (u.protocol !== "https:" || !HOSTS.test(u.hostname)) return responder(res, 400, { error: "Tiene que ser un link de Google Maps." });
    let datos = leer(u.href);
    for (let i = 0; !datos && i < 4; i++) {
      const control = new AbortController();
      const espera = setTimeout(() => control.abort(), 4000);
      let r;
      try { r = await fetch(u.href, { redirect: "manual", signal: control.signal, headers: { "User-Agent": "Mozilla/5.0" } }); }
      finally { clearTimeout(espera); }
      const destino = r.headers.get("location");
      if (!destino) break;
      u = new URL(destino, u);
      if (!HOSTS.test(u.hostname)) break;
      datos = leer(u.href);
    }
    if (!datos) return responder(res, 404, { error: "No encontré el negocio en ese link. Abrí el local en Google Maps y usá Compartir → Copiar link." });
    const placeId = placeIdDesdeFid(datos.a, datos.b);
    return responder(res, 200, { nombre: datos.nombre, placeId, link: `https://search.google.com/local/writereview?placeid=${placeId}` });
  } catch (e) {
    return responder(res, 400, { error: "Ese link no se pudo leer. Copiá el link de Compartir de Google Maps." });
  }
};
