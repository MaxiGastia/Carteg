"use strict";

/*
 * Funciones compartidas para la conexión con Tiendanube (los archivos que empiezan con "_" no son páginas).
 * Claves que se cargan en Vercel (Settings → Environment Variables), nunca en el código:
 *   TN_APP_ID, TN_CLIENT_SECRET          → de la app creada en el portal de Partners de Tiendanube
 *   FB_INTEGRACION_EMAIL, FB_INTEGRACION_CLAVE → usuario especial de Firebase que solo puede cargar ventas de Tiendanube
 */
const crypto = require("crypto");

const FB_CLAVE_PUBLICA = "AIzaSyDqG9wG3Sd1RESGM4ofbIZjEE82PgByz-4";
const DOCS = "https://firestore.googleapis.com/v1/projects/carteg/databases/(default)/documents";
const NOMBRE_DOC = "projects/carteg/databases/(default)/documents";
const API_TN = "https://api.tiendanube.com/2025-03";
const USER_AGENT = "Carteg Sistema (https://www.carteg.com.ar)";
const COMISION_COBRO = 0.035 * 1.21; // Pago Nube: 3,5% + IVA (estimado)

function falta(nombres) { return nombres.filter(n => !process.env[n]); }

async function pedir(url, opciones = {}, ms = 2500) {
  const control = new AbortController();
  const espera = setTimeout(() => control.abort(), ms);
  try { return await fetch(url, { ...opciones, signal: control.signal }); }
  finally { clearTimeout(espera); }
}

/* Lee el cuerpo tal cual llegó (hace falta para comprobar la firma de Tiendanube) */
function leerCuerpo(req) {
  return new Promise((ok, mal) => {
    const partes = [];
    req.on("data", c => partes.push(c));
    req.on("end", () => ok(Buffer.concat(partes)));
    req.on("error", mal);
  });
}

function firmaValida(cuerpo, firma) {
  if (!firma || !process.env.TN_CLIENT_SECRET) return false;
  const esperada = crypto.createHmac("sha256", process.env.TN_CLIENT_SECRET).update(cuerpo).digest("hex");
  const a = Buffer.from(esperada), b = Buffer.from(String(firma).trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Sesión del usuario especial de Firebase (se reutiliza mientras dure) */
let sesion = null;
async function tokenFirebase() {
  if (sesion && sesion.vence > Date.now()) return sesion.token;
  const r = await pedir(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_CLAVE_PUBLICA}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.FB_INTEGRACION_EMAIL, password: process.env.FB_INTEGRACION_CLAVE, returnSecureToken: true }),
  });
  const d = await r.json();
  if (!r.ok || !d.idToken) throw new Error("No se pudo entrar a Firebase con el usuario de integración");
  sesion = { token: d.idToken, vence: Date.now() + (Number(d.expiresIn || 3600) - 300) * 1000 };
  return sesion.token;
}

/* Conversión simple a los valores de Firestore */
function aValor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aValor(x)])) } };
  return { stringValue: String(v) };
}
const aCampos = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, aValor(v)]));
function deValor(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  return null;
}

async function firestore(metodo, ruta, cuerpo) {
  const token = await tokenFirebase();
  return pedir(`${DOCS}${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
}

/* Datos de la conexión con la tienda (token de Tiendanube y número de tienda) */
async function leerConexion() {
  const r = await firestore("GET", "/privado/tiendanube");
  if (!r.ok) return null;
  const d = await r.json();
  return { token: deValor(d.fields.token), tiendaId: String(deValor(d.fields.tiendaId)) };
}
async function guardarConexion(token, tiendaId) {
  const r = await firestore("PATCH", "/privado/tiendanube", { fields: aCampos({ token, tiendaId: String(tiendaId), conectado: Date.now() }) });
  if (!r.ok) throw new Error("No se pudo guardar la conexión en Firebase (" + r.status + ")");
}

async function apiTiendanube(conexion, metodo, ruta, cuerpo) {
  return pedir(`${API_TN}/${conexion.tiendaId}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${conexion.token}`, "User-Agent": USER_AGENT, "Content-Type": "application/json; charset=utf-8" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
}

/* Crea documentos solo si no existen (si Tiendanube avisa dos veces, no se duplica) */
async function crearSiNoExiste(docs) {
  const token = await tokenFirebase();
  const r = await pedir(`${DOCS}:commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ writes: docs.map(([id, datos]) => ({ update: { name: `${NOMBRE_DOC}/movimientos/${id}`, fields: aCampos(datos) }, currentDocument: { exists: false } })) }),
  });
  if (r.ok) return "creada";
  const t = await r.text();
  if (/ALREADY_EXISTS|FAILED_PRECONDITION/.test(t) || r.status === 409) return "ya estaba";
  throw new Error("Firestore " + r.status + " " + t.slice(0, 200));
}

async function marcarCancelada(id, motivo) {
  const campos = { estado: "rechazada", motivo };
  const mascara = Object.keys(campos).map(k => "updateMask.fieldPaths=" + k).join("&");
  const r = await firestore("PATCH", `/movimientos/${id}?${mascara}&currentDocument.exists=true`, { fields: aCampos(campos) });
  return r.ok;
}

/* Fecha de Argentina (UTC−3) a partir de la fecha de Tiendanube */
function fechaArgentina(iso) {
  const d = iso ? new Date(iso) : new Date();
  return new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
}
const num = v => Math.round((parseFloat(v) || 0) * 100) / 100;

/* Arma la venta (y la comisión estimada) a partir de un pedido de Tiendanube */
function armarMovimientos(pedido) {
  const subtotal = num(pedido.subtotal), descuento = num(pedido.discount), total = num(pedido.total);
  const monto = Math.max(0, Math.round((subtotal - descuento) * 100) / 100);
  const envio = Math.max(0, Math.round((total - monto) * 100) / 100);
  const productos = (pedido.products || []).map(p => `${p.quantity > 1 ? p.quantity + "× " : ""}${p.name}`).join(", ");
  const cliente = (pedido.customer && pedido.customer.name) || pedido.contact_name || "Cliente de la tienda";
  const fecha = fechaArgentina(pedido.paid_at || pedido.created_at);
  const id = `tn-${pedido.id}`;
  const venta = {
    tipo: "ingreso", categoria: "Venta", estado: "aprobada", origen: "tiendanube",
    fecha, concepto: `Tiendanube #${pedido.number} · ${cliente}`.slice(0, 120), detalle: productos.slice(0, 300),
    cliente: String(cliente).slice(0, 80), monto, envioCliente: envio, totalCobrado: total,
    pedidoTiendanube: String(pedido.id), numeroPedido: String(pedido.number || ""),
    vendedorId: null, comisionPct: 0, comisionPagada: false, creadoEn: Date.now(),
  };
  const comision = Math.round(total * COMISION_COBRO * 100) / 100;
  const gasto = {
    tipo: "egreso", categoria: "Comisión de cobro", estado: "aprobada", origen: "tiendanube",
    fecha, concepto: `Comisión Pago Nube (estimada) · pedido #${pedido.number}`, monto: comision,
    pedidoTiendanube: String(pedido.id), vendedorId: null, comisionPct: 0, comisionPagada: false, creadoEn: Date.now(),
  };
  const docs = [[id, venta]];
  if (comision > 0) docs.push([`${id}-com`, gasto]);
  return docs;
}

module.exports = {
  falta, pedir, leerCuerpo, firmaValida, leerConexion, guardarConexion, apiTiendanube,
  crearSiNoExiste, marcarCancelada, armarMovimientos, USER_AGENT,
};
