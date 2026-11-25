"use strict";

/*
 * Redirección de los displays: carteg.com.ar/r/c014 → destino guardado en Firebase.
 * Si el código todavía no está activado, manda a /activar/ (ahí el dueño lo activa desde el celular).
 * La clave de abajo es la configuración pública de Firebase (no es secreta):
 * la seguridad está en las reglas de Firestore.
 */
const PROYECTO = "carteg";
const CLAVE = "AIzaSyDqG9wG3Sd1RESGM4ofbIZjEE82PgByz-4";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;

function ir(res, url) {
  res.statusCode = 302;
  res.setHeader("Location", url);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

async function pedir(url, opciones = {}, ms = 2500) {
  const control = new AbortController();
  const espera = setTimeout(() => control.abort(), ms);
  try { return await fetch(url, { ...opciones, signal: control.signal }); }
  finally { clearTimeout(espera); }
}

/* Mes en hora de Argentina (UTC−3), por ejemplo "2026-11" */
function mesActual() {
  return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
}

async function sumarToque(codigo) {
  const nombre = `projects/${PROYECTO}/databases/(default)/documents/displays/${codigo}`;
  await pedir(`${DOCS}:commit?key=${CLAVE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: nombre,
          fieldTransforms: [
            { fieldPath: "toques", increment: { integerValue: "1" } },
            { fieldPath: "mes.`" + mesActual() + "`", increment: { integerValue: "1" } },
          ],
        },
        currentDocument: { exists: true },
      }],
    }),
  }, 1500);
}

module.exports = async (req, res) => {
  const codigo = String((req.query && req.query.code) || "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(codigo)) return ir(res, "/");
  try {
    const r = await pedir(`${DOCS}/displays/${codigo}?key=${CLAVE}`);
    if (r.status === 404) return ir(res, `/activar/?c=${codigo}`);
    if (!r.ok) throw new Error("Firestore respondió " + r.status);
    const doc = await r.json();
    const destino = doc.fields && doc.fields.destino && doc.fields.destino.stringValue;
    if (!destino || !/^https:\/\//i.test(destino)) return ir(res, `/activar/?c=${codigo}`);
    try { await sumarToque(codigo); } catch (e) { console.error("No se pudo sumar el toque", e); }
    return ir(res, destino);
  } catch (e) {
    console.error(e);
    return ir(res, "/");
  }
};
