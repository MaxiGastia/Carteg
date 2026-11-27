import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, query, where, writeBatch, setDoc, deleteDoc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- Firebase (configuración pública: la seguridad está en las reglas de Firestore) ---------- */
const CONFIG = {
  apiKey: "AIzaSyDqG9wG3Sd1RESGM4ofbIZjEE82PgByz-4",
  authDomain: "carteg.firebaseapp.com",
  projectId: "carteg",
  storageBucket: "carteg.firebasestorage.app",
  messagingSenderId: "298530415356",
  appId: "1:298530415356:web:f848fc8ba2b59e2a9aed79",
};
const DUENO = "Frp9SgAjT7RZ0Gu0sTrqpgiiuZ52";
const app = initializeApp(CONFIG);
const auth = getAuth(app);
const fs = getFirestore(app);

/* Modo demo solo para probar la pantalla en la compu (localhost): no toca Firebase */
const DEMO = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? new URLSearchParams(location.search).get("demo") : null;

/* ---------- Constantes ---------- */
const CATEGORIAS = {
  ingreso: ["Venta", "Otro ingreso"],
  egreso: ["Insumos", "Embalaje", "Inversión", "Publicidad", "Envíos", "Comisión de cobro", "Otro gasto"],
};
const ESTADOS = ["Pendiente", "Enviado", "Respondió", "Interesado", "Cliente", "Descartado"];
const PERIODOS = [["hoy", "Hoy"], ["semana", "Esta semana"], ["mes", "Este mes"], ["anio", "Este año"], ["todo", "Todo"]];
const PRODUCTOS = [["1 display", 23990], ["Combo de 2", 47980], ["Pack de 3", 52000], ["Otro", 0]];
const DOMINIO = "carteg.com.ar";

/* ---------- Estado ---------- */
let rol = null;          // "dueno" | "vendedor"
let usuario = null;      // usuario de Firebase
let perfil = null;       // perfil del vendedor (colección usuarios)
let db = vacio();
let escuchas = [];

function vacio() {
  return { movimientos: [], vendedores: [], seguimiento: {}, locales: [], usuarios: [], postulantes: [], config: { ultimoCodigo: 0 }, ranking: null };
}
const pref = (k, def) => { try { return localStorage.getItem("carteg-sistema:" + k) || def; } catch (e) { return def; } };
const guardarPref = (k, v) => { try { localStorage.setItem("carteg-sistema:" + k, v); } catch (e) {} };

/* ---------- Utilidades ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nuevoId = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const redondear = n => Math.round(n * 100) / 100;
function plata(n) {
  n = redondear(n || 0);
  const abs = Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return (n < 0 ? "−$" : "$") + abs;
}
function compacto(n) {
  if (n >= 1e6) return (n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " M";
  if (n >= 1e3) return (n / 1e3).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " K";
  return String(n);
}
const aTexto = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const aFecha = t => { const [a, m, d] = t.split("-").map(Number); return new Date(a, m - 1, d, 12); };
const hoy = () => aTexto(new Date());
const sumarDias = (t, n) => { const d = aFecha(t); d.setDate(d.getDate() + n); return aTexto(d); };
const lunes = t => sumarDias(t, -((aFecha(t).getDay() + 6) % 7));
const fechaCorta = t => { const [a, m, d] = t.split("-"); return `${d}/${m}/${a}`; };
const diaMes = t => { const [, m, d] = t.split("-"); return `${d}/${m}`; };
const diasDesde = ts => ts ? Math.floor((Date.now() - ts) / 864e5) : null;
const nombreMes = m => aFecha(m + "-15").toLocaleDateString("es-AR", { month: "long", year: "numeric" });

function toast(t) {
  const el = $("toast"); el.textContent = t; el.classList.add("on");
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 2200);
}
async function copiar(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
    ta.remove(); return ok;
  }
}
function descargar(nombre, contenido, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Sincronización con Firebase (solo el dueño escribe así) ----------
   Se guarda una "foto" de lo último que hay en Firebase; al guardar se mandan solo los documentos que cambiaron. */
const COLS = { movimientos: "lista", vendedores: "lista", locales: "lista", postulantes: "lista", seguimiento: "mapa" };
const espejo = { movimientos: new Map(), vendedores: new Map(), locales: new Map(), postulantes: new Map(), seguimiento: new Map(), config: "", ranking: "" };
function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => (v[k] === undefined ? o : (o[k] = ordenado(v[k]), o)), {});
  return v;
}
const estable = v => JSON.stringify(ordenado(v));
const sinId = o => { const c = { ...o }; delete c.id; return c; };
function itemsDe(col) {
  return COLS[col] === "mapa" ? Object.entries(db[col]) : db[col].map(x => [x.id, sinId(x)]);
}
let cola = Promise.resolve(), errorSync = false;
function guardar() {
  if (rol !== "dueno") return;
  cola = cola.then(sincronizar).then(() => { if (errorSync) { errorSync = false; pintarAviso(); } })
    .catch(e => { console.error(e); errorSync = true; pintarAviso(); });
}
async function sincronizar() {
  if (DEMO) return;
  const ops = [];
  for (const col of Object.keys(COLS)) {
    const actuales = new Map(itemsDe(col).map(([id, v]) => [id, estable(v)]));
    for (const [id, s] of actuales) if (espejo[col].get(id) !== s) ops.push(["set", col, id, s]);
    for (const id of espejo[col].keys()) if (!actuales.has(id)) ops.push(["del", col, id]);
  }
  const cfg = estable(db.config);
  if (cfg !== espejo.config) ops.push(["set", "config", "general", cfg]);
  const rk = estable(calcularRanking());
  if (rk !== espejo.ranking) ops.push(["set", "resumenes", "ranking", rk]);
  for (let i = 0; i < ops.length; i += 400) {
    const wb = writeBatch(fs);
    for (const [op, col, id, s] of ops.slice(i, i + 400)) {
      const ref = doc(fs, col, id);
      if (op === "set") wb.set(ref, JSON.parse(s)); else wb.delete(ref);
    }
    await wb.commit();
  }
  for (const [op, col, id, s] of ops) {
    if (col === "config") espejo.config = s;
    else if (col === "resumenes") espejo.ranking = s;
    else if (op === "set") espejo[col].set(id, s); else espejo[col].delete(id);
  }
}

/* ---------- Escuchar cambios en vivo (otro dispositivo, un vendedor que carga una venta…) ---------- */
let pendienteRepintar = false;
function repintarSiSePuede() {
  const a = document.activeElement;
  const escribiendo = a && $("vista").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if ($("dlg").open || escribiendo) { pendienteRepintar = true; return; }
  pendienteRepintar = false;
  pintar();
}
document.addEventListener("focusout", () => setTimeout(() => { if (pendienteRepintar) repintarSiSePuede(); }, 250));
$("dlg").addEventListener("close", () => setTimeout(() => { if (pendienteRepintar) repintarSiSePuede(); }, 50));

/* Los mensajes viejos decían "sin QR ni app"; ahora los displays traen QR de respaldo */
function actualizarMensajesLocales() {
  let cambios = 0;
  const arreglar = t => typeof t !== "string" ? t
    : t.replace(/, sin QR ni app/g, ", sin bajar ninguna app").replace(/Sin QR, sin app y con pago único/g, "Sin bajar ninguna app y con pago único");
  for (const l of db.locales) {
    for (const k of ["mensaje_whatsapp", "mensaje_instagram", "mensaje_seguimiento"]) {
      const nuevo = arreglar(l[k]);
      if (nuevo !== l[k]) { l[k] = nuevo; cambios++; }
    }
  }
  if (cambios) guardar();
}

function escucharDueno() {
  const faltan = new Set(["movimientos", "vendedores", "seguimiento", "locales", "usuarios", "config", "postulantes"]);
  const listo = n => {
    if (faltan.delete(n) && !faltan.size) { actualizarMensajesLocales(); mostrarApp(); }
    else if (!faltan.size) repintarSiSePuede();
  };
  const lista = col => onSnapshot(collection(fs, col), s => {
    db[col] = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (espejo[col]) espejo[col] = new Map(s.docs.map(d => [d.id, estable(d.data())]));
    listo(col);
  }, errorEscucha);
  escuchas.push(lista("movimientos"), lista("vendedores"), lista("locales"), lista("usuarios"), lista("postulantes"));
  escuchas.push(onSnapshot(collection(fs, "seguimiento"), s => {
    db.seguimiento = Object.fromEntries(s.docs.map(d => [d.id, d.data()]));
    espejo.seguimiento = new Map(s.docs.map(d => [d.id, estable(d.data())]));
    listo("seguimiento");
  }, errorEscucha));
  escuchas.push(onSnapshot(doc(fs, "config", "general"), s => {
    db.config = s.exists() ? { ultimoCodigo: 0, ...s.data() } : { ultimoCodigo: 0 };
    espejo.config = s.exists() ? estable(s.data()) : "";
    listo("config");
  }, errorEscucha));
  escuchas.push(onSnapshot(doc(fs, "resumenes", "ranking"), s => { espejo.ranking = s.exists() ? estable(s.data()) : ""; }, () => {}));
}
function escucharVendedor() {
  const faltan = new Set(["movimientos", "vendedores", "ranking"]);
  const listo = n => { if (faltan.delete(n) && !faltan.size) mostrarApp(); else if (!faltan.size) repintarSiSePuede(); };
  escuchas.push(onSnapshot(query(collection(fs, "movimientos"), where("vendedorId", "==", perfil.vendedorId)), s => {
    db.movimientos = s.docs.map(d => ({ id: d.id, ...d.data() })); listo("movimientos");
  }, errorEscucha));
  escuchas.push(onSnapshot(collection(fs, "vendedores"), s => {
    db.vendedores = s.docs.map(d => ({ id: d.id, ...d.data() })); listo("vendedores");
  }, errorEscucha));
  escuchas.push(onSnapshot(doc(fs, "resumenes", "ranking"), s => {
    db.ranking = s.exists() ? s.data() : null; listo("ranking");
  }, errorEscucha));
}
function errorEscucha(e) {
  console.error(e);
  $("pantallaCarga").innerHTML = `<div class="ingreso-caja"><div class="panel"><h1>No se pudieron cargar los datos</h1>
    <p class="gris">${/permission/.test(e.code || "") ? "Tu usuario no tiene permiso para ver esta información." : "Revisá la conexión y recargá la página."}</p>
    <button class="btn sec" type="button" onclick="location.reload()">Recargar</button></div></div>`;
  $("pantallaCarga").hidden = false; $("pantallaApp").hidden = true;
}

/* ---------- Cálculos ---------- */
const cuenta = m => !m.estado || m.estado === "aprobada";
const aprobados = () => db.movimientos.filter(cuenta);
const pendientes = () => db.movimientos.filter(m => m.estado === "pendiente");
const comision = m => m.tipo === "ingreso" && m.vendedorId ? redondear(m.monto * (m.comisionPct || 0) / 100) : 0;
const vendedor = id => db.vendedores.find(v => v.id === id);
const nombreVendedor = id => (vendedor(id) || {}).nombre || "Vendedor";

function rango(p) {
  const h = hoy();
  if (p === "hoy") return [h, h];
  if (p === "semana") return [lunes(h), sumarDias(lunes(h), 6)];
  if (p === "mes") return [h.slice(0, 7) + "-01", h.slice(0, 7) + "-31"];
  if (p === "anio") return [h.slice(0, 4) + "-01-01", h.slice(0, 4) + "-12-31"];
  return null;
}
function entre(lista, ini, fin) { return lista.filter(m => m.fecha && m.fecha >= ini && m.fecha <= fin); }
function delPeriodo(lista, p) {
  if (p === "todo") return lista;
  const [i, f] = rango(p);
  return entre(lista, i, f);
}
function resumen(lista) {
  let ingresos = 0, gastos = 0, comisiones = 0, inversion = 0, ventas = 0, montoVentas = 0;
  for (const m of lista) {
    if (m.tipo === "ingreso") {
      ingresos += m.monto; comisiones += comision(m);
      if (m.categoria === "Venta") { ventas++; montoVentas += m.monto; }
    } else {
      gastos += m.monto;
      if (m.categoria === "Inversión") inversion += m.monto;
    }
  }
  const egresos = gastos + comisiones;
  return { ingresos, egresos, comisiones, inversion, ventas, montoVentas, resultado: ingresos - egresos };
}
function calcularRanking() {
  const mes = hoy().slice(0, 7);
  const filas = db.vendedores.filter(v => v.activo !== false).map(v => {
    const suyas = aprobados().filter(m => m.categoria === "Venta" && m.vendedorId === v.id && (m.fecha || "").startsWith(mes));
    return { vendedorId: v.id, nombre: v.nombre, ventas: suyas.length, monto: redondear(suyas.reduce((a, m) => a + m.monto, 0)) };
  }).sort((a, b) => b.monto - a.monto || b.ventas - a.ventas);
  return { mes, filas };
}
function tile(titulo, valor, nota) {
  return `<div class="tile"><small>${esc(titulo)}</small><b>${esc(valor)}</b>${nota ? `<em>${esc(nota)}</em>` : ""}</div>`;
}
const signo = n => n > 0 ? "A favor" : n < 0 ? "En contra" : "";
const chipEstado = m => (m.origen === "tiendanube" ? `<span class="chip">Tiendanube</span> ` : "") +
  (m.estado === "pendiente" ? `<span class="chip ojo">Pendiente</span>` : m.estado === "rechazada" ? `<span class="chip">${m.origen === "tiendanube" ? "Cancelada" : "Rechazada"}</span>` : "");

/* ---------- Navegación ---------- */
const NAV_DUENO = [["metricas", "Métricas"], ["movimientos", "Ingresos y egresos"], ["aprobar", "Aprobar ventas"], ["vendedores", "Vendedores"], ["postulantes", "Postulantes"], ["locales", "Locales"], ["displays", "Displays"]];
const NAV_VENDEDOR = [["inicio", "Mis métricas"], ["misventas", "Mis ventas"], ["ranking", "Ranking"], ["displays", "Displays"]];
const navActual = () => rol === "dueno" ? NAV_DUENO : NAV_VENDEDOR;
let vista = "";
const filtrosMov = { q: "", tipo: "" };
const filtrosLoc = { q: "", estado: "" };

function pintarNav() {
  const p = pendientes().length;
  $("nav").innerHTML = navActual().map(([k, t]) =>
    `<button data-v="${k}" ${k === vista ? 'aria-current="page"' : ""}>${t}${k === "aprobar" && p ? ` <span class="badge">${p}</span>` : ""}${k === "postulantes" && nuevosPost() ? ` <span class="badge">${nuevosPost()}</span>` : ""}</button>`).join("");
}
function pintar() {
  if (!navActual().some(([k]) => k === vista)) vista = navActual()[0][0];
  pintarNav();
  const vistas = { metricas: vistaMetricas, movimientos: vistaMovimientos, aprobar: vistaAprobar, vendedores: vistaVendedores, postulantes: vistaPostulantes, locales: vistaLocales,
    displays: vistaDisplays, inicio: vistaMisMetricas, misventas: vistaMisVentas, ranking: vistaRanking };
  vistas[vista]();
  pintarAviso();
}
function pintarAviso() {
  const av = $("aviso");
  if (DEMO) { av.hidden = false; av.innerHTML = "<b>Modo de prueba:</b> estos datos son de ejemplo y no se guardan. Tu sistema real está en carteg.com.ar/sistema."; return; }
  if (errorSync) { av.hidden = false; av.textContent = "No se pudieron guardar los últimos cambios. Revisá la conexión: se reintenta en el próximo cambio."; }
  else av.hidden = true;
}

/* ---------- Dueño: Métricas ---------- */
function vistaMetricas() {
  const p = pref("periodo", "todo");
  const base = aprobados();
  const lista = delPeriodo(base, p), r = resumen(lista);
  const sinFecha = base.filter(m => !m.fecha).length;
  const promedio = r.ventas ? r.montoVentas / r.ventas : 0;
  const cats = {};
  for (const m of lista) if (m.tipo === "egreso") cats[m.categoria] = (cats[m.categoria] || 0) + m.monto;
  if (r.comisiones) cats["Comisiones"] = r.comisiones;
  const orden = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const maxCat = orden.length ? orden[0][1] : 1;
  const np = pendientes().length;
  const vacia = !db.movimientos.length;

  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Métricas</h1><p>Cómo viene el negocio, por período.</p></div>
      <div class="acciones"><button class="btn" data-a="nuevo-venta" type="button">+ Cargar venta</button><button class="btn sec" data-a="nuevo-gasto" type="button">+ Cargar gasto</button></div></div>
    ${vacia ? `<section class="panel"><h2>Todavía no hay datos</h2><p class="gris">Traé lo que cargaste en Carteg Sistema de tu compu con una copia, o empezá con los números de tu planilla.</p>
      <div class="acciones"><button class="btn" data-a="importar" type="button">Importar copia</button><button class="btn sec" data-a="datos-planilla" type="button">Empezar con la planilla</button></div></section>` : ""}
    ${np ? `<div class="aviso">Tenés <b>${np}</b> ${np === 1 ? "venta" : "ventas"} de vendedores para aprobar. <button class="link" data-v-ir="aprobar" type="button">Ver</button></div>` : ""}
    <div class="tabs">${PERIODOS.map(([k, t]) => `<button type="button" data-a="periodo" data-p="${k}" aria-pressed="${k === p}">${t}</button>`).join("")}</div>
    ${p !== "todo" && sinFecha ? `<div class="aviso">${sinFecha} movimientos no tienen fecha, así que no se cuentan acá. Sí se cuentan en “Todo”.</div>` : ""}
    <div class="tiles">
      ${tile("Ingresos", plata(r.ingresos))}
      ${tile("Egresos", plata(r.egresos), r.comisiones ? `Incluye ${plata(r.comisiones)} de comisiones` : "")}
      ${tile("Resultado", plata(r.resultado), signo(r.resultado))}
      ${tile("Resultado sin inversión", plata(r.resultado + r.inversion), "Sin contar compras como la impresora")}
      ${tile("Ventas", String(r.ventas))}
      ${tile("Promedio por venta", plata(promedio))}
    </div>
    <div class="dos">
      <section class="panel"><h2>Ingresos y egresos</h2><div class="sub" id="grafSub"></div>
        <div class="leyenda"><span><i style="background:var(--ingreso)"></i>Ingresos</span><span><i style="background:var(--egreso)"></i>Egresos</span></div>
        <div class="grafico" id="graf"></div>
        <details class="tabla"><summary>Ver como tabla</summary><div class="scroll" id="grafTabla"></div></details>
      </section>
      <section class="panel"><h2>En qué se fue la plata</h2><div class="sub">Egresos del período, por tipo.</div>
        ${orden.length ? orden.map(([c, v]) => `<div class="cat"><span>${esc(c)}</span><span>${plata(v)}</span><div class="barra"><div style="width:${Math.max(2, v / maxCat * 100)}%"></div></div></div>`).join("") : `<div class="vacio">Sin egresos en este período.</div>`}
      </section>
    </div>`;
  pintarGrafico(base, p);
}

function cajones(p) {
  const h = hoy(), salida = [];
  if (p === "hoy" || p === "semana") {
    for (let i = 13; i >= 0; i--) { const d = sumarDias(h, -i); salida.push({ ini: d, fin: d, etiqueta: diaMes(d), largo: fechaCorta(d) }); }
    return ["Últimos 14 días, día por día.", salida];
  }
  if (p === "mes") {
    for (let i = 7; i >= 0; i--) {
      const ini = sumarDias(lunes(h), -7 * i), fin = sumarDias(ini, 6);
      salida.push({ ini, fin, etiqueta: diaMes(ini), largo: `Semana del ${fechaCorta(ini)}` });
    }
    return ["Últimas 8 semanas (cada barra arranca el lunes indicado).", salida];
  }
  const base = aFecha(h);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 15, 12);
    const m = aTexto(d).slice(0, 7);
    salida.push({ ini: m + "-01", fin: m + "-31", etiqueta: d.toLocaleDateString("es-AR", { month: "short" }).replace(".", ""), largo: d.toLocaleDateString("es-AR", { month: "long", year: "numeric" }) });
  }
  return ["Últimos 12 meses (solo movimientos con fecha).", salida];
}
function maximoLindo(max) {
  if (max <= 0) return 1000;
  const pot = Math.pow(10, Math.floor(Math.log10(max)));
  for (const n of [1, 2, 4, 8, 10]) if (n * pot >= max) return n * pot;
  return 10 * pot;
}
function barraSvg(x, base, ancho, alto, color) {
  if (alto <= 0) return "";
  const r = Math.min(4, ancho / 2, alto), y = base - alto;
  return `<path fill="${color}" d="M${x} ${base}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + ancho - r}Q${x + ancho} ${y} ${x + ancho} ${y + r}V${base}Z"/>`;
}
let ultimoGrafico = null;
function pintarGrafico(base, p) {
  ultimoGrafico = [base, p];
  const cont = $("graf"); if (!cont) return;
  const [sub, caj] = cajones(p);
  $("grafSub").textContent = sub;
  const filas = caj.map(c => { const r = resumen(entre(base, c.ini, c.fin)); return { ...c, ing: r.ingresos, eg: r.egresos }; });
  $("grafTabla").innerHTML = `<table><thead><tr><th>Período</th><th class="num">Ingresos</th><th class="num">Egresos</th></tr></thead><tbody>${filas.map(f => `<tr><td>${esc(f.largo)}</td><td class="num">${plata(f.ing)}</td><td class="num">${plata(f.eg)}</td></tr>`).join("")}</tbody></table>`;
  if (!filas.some(f => f.ing || f.eg)) {
    cont.innerHTML = `<div class="vacio">Todavía no hay movimientos con fecha en este período. Las próximas ventas y gastos que cargues van a aparecer acá.</div>`;
    return;
  }
  const W = Math.max(280, cont.clientWidth), H = 250, izq = 46, der = 6, arr = 10, aba = 24;
  const alto = H - arr - aba, base0 = arr + alto, banda = (W - izq - der) / filas.length;
  const tope = maximoLindo(Math.max(...filas.map(f => Math.max(f.ing, f.eg))));
  let s = "";
  for (let i = 0; i <= 4; i++) {
    const v = tope * i / 4, y = base0 - alto * i / 4;
    s += `<line x1="${izq}" x2="${W - der}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${izq - 7}" y="${y + 4}" text-anchor="end">${compacto(v)}</text>`;
  }
  const paso = Math.ceil(filas.length / Math.max(1, Math.floor((W - izq) / 46)));
  const anchoBarra = Math.max(3, Math.min(24, (banda - 8) / 2 - 1));
  filas.forEach((f, i) => {
    const c = izq + banda * i + banda / 2;
    s += barraSvg(c - anchoBarra - 1, base0, anchoBarra, f.ing / tope * alto, "var(--ingreso)");
    s += barraSvg(c + 1, base0, anchoBarra, f.eg / tope * alto, "var(--egreso)");
    if (i % paso === 0) s += `<text x="${c}" y="${H - 7}" text-anchor="middle">${esc(f.etiqueta)}</text>`;
  });
  filas.forEach((f, i) => { s += `<rect class="hit" tabindex="0" data-i="${i}" x="${izq + banda * i}" y="${arr}" width="${banda}" height="${alto}" aria-label="${esc(f.largo)}: ingresos ${plata(f.ing)}, egresos ${plata(f.eg)}"/>`; });
  cont.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Gráfico de ingresos y egresos">${s}</svg><div class="tip" hidden></div>`;
  const tip = cont.querySelector(".tip");
  const mostrar = e => {
    if (!e.target.classList.contains("hit")) return;
    const i = +e.target.dataset.i, f = filas[i];
    tip.innerHTML = `<b>${esc(f.largo)}</b><br><i style="background:var(--ingreso)"></i>${plata(f.ing)}<br><i style="background:var(--egreso)"></i>${plata(f.eg)}`;
    tip.hidden = false;
    const x = izq + banda * i + banda / 2 - tip.offsetWidth / 2;
    tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, x)) + "px";
    tip.style.top = "6px";
  };
  cont.addEventListener("mouseover", mostrar);
  cont.addEventListener("focusin", mostrar);
  cont.addEventListener("mouseleave", () => { tip.hidden = true; });
  cont.addEventListener("focusout", () => { tip.hidden = true; });
}

/* ---------- Dueño: Ingresos y egresos ---------- */
function ordenados(lista) { return [...lista].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")); }
function selectorVendedor(m) {
  const opciones = db.vendedores.filter(v => v.activo !== false || v.id === m.vendedorId)
    .map(v => `<option value="${esc(v.id)}" ${v.id === m.vendedorId ? "selected" : ""}>${esc(v.nombre)}</option>`).join("");
  return `<select data-a="asignar" data-id="${esc(m.id)}" aria-label="Quién hizo la venta"><option value="">Sin vendedor</option>${opciones}</select>`;
}
const celdaFecha = m => m.fecha ? fechaCorta(m.fecha) : `<span class="chip ojo">Sin fecha</span>`;

function vistaMovimientos() {
  const r = resumen(aprobados());
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Ingresos y egresos</h1><p>Toda la plata que entra y sale.</p></div>
      <div class="acciones"><button class="btn" data-a="nuevo-venta" type="button">+ Cargar venta</button><button class="btn sec" data-a="nuevo-gasto" type="button">+ Cargar gasto</button></div></div>
    <div class="tiles">${tile("Total ingresos", plata(r.ingresos))}${tile("Total egresos", plata(r.egresos), r.comisiones ? `Incluye ${plata(r.comisiones)} de comisiones` : "")}${tile("Resultado", plata(r.resultado), signo(r.resultado))}</div>
    <div class="filtros">
      <input type="search" id="fq" placeholder="Buscar…" aria-label="Buscar" value="${esc(filtrosMov.q)}">
      <select id="ft" aria-label="Filtrar por tipo">
        <option value="">Todo</option><option value="ingreso">Solo ingresos</option><option value="egreso">Solo egresos</option><option value="sinfecha">Sin fecha</option>
      </select>
    </div>
    <section class="panel"><div class="scroll" id="tablaMov"></div></section>`;
  $("ft").value = filtrosMov.tipo;
  $("fq").addEventListener("input", e => { filtrosMov.q = e.target.value; tablaMov(); });
  $("ft").addEventListener("change", e => { filtrosMov.tipo = e.target.value; tablaMov(); });
  tablaMov();
}
function tablaMov() {
  const q = filtrosMov.q.toLowerCase().trim(), t = filtrosMov.tipo;
  const lista = ordenados(db.movimientos.filter(m => m.estado !== "pendiente")).filter(m => {
    if (t === "sinfecha" && m.fecha) return false;
    if ((t === "ingreso" || t === "egreso") && m.tipo !== t) return false;
    return !q || (m.concepto + " " + m.categoria).toLowerCase().includes(q);
  });
  $("tablaMov").innerHTML = lista.length ? `<table>
    <thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Vendedor</th><th class="num">Monto</th><th></th></tr></thead>
    <tbody>${lista.map(m => `<tr>
      <td>${celdaFecha(m)}</td><td>${esc(m.concepto)} ${chipEstado(m)}</td><td>${esc(m.categoria)}</td>
      <td>${m.categoria === "Venta" ? selectorVendedor(m) : ""}</td>
      <td class="num">${m.tipo === "ingreso" ? "+" : "−"}${plata(m.monto)}</td>
      <td><div class="fila"><button class="link" data-a="editar" data-id="${esc(m.id)}" type="button">Editar</button><button class="link" data-a="borrar" data-id="${esc(m.id)}" type="button">Borrar</button></div></td>
    </tr>`).join("")}</tbody></table>` : `<div class="vacio">No hay movimientos con este filtro.</div>`;
}

/* ---------- Dueño: Aprobar ventas de vendedores ---------- */
function vistaAprobar() {
  const lista = ordenados(pendientes());
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Aprobar ventas</h1><p>Las ventas que cargan los vendedores. Cuentan en tus números recién cuando las aprobás.</p></div></div>
    <section class="panel"><div class="scroll">
      ${lista.length ? `<table><thead><tr><th>Fecha</th><th>Vendedor</th><th>Venta</th><th class="num">Monto</th><th class="num">Comisión</th><th></th></tr></thead><tbody>
      ${lista.map(m => `<tr><td>${celdaFecha(m)}</td><td>${esc(nombreVendedor(m.vendedorId))}</td><td>${esc(m.concepto)}${m.nota ? `<br><small class="gris">${esc(m.nota)}</small>` : ""}</td>
        <td class="num">${plata(m.monto)}</td><td class="num">${plata(comision(m))}</td>
        <td><div class="fila"><button class="btn chico" data-a="aprobar" data-id="${esc(m.id)}" type="button">Aprobar</button>
          <button class="link" data-a="editar" data-id="${esc(m.id)}" type="button">Editar</button>
          <button class="link" data-a="rechazar" data-id="${esc(m.id)}" type="button">Rechazar</button></div></td></tr>`).join("")}
      </tbody></table>` : `<div class="vacio">No hay ventas para aprobar.</div>`}
    </div></section>`;
}

/* ---------- Dueño: Vendedores ---------- */
const accesoDe = v => db.usuarios.find(u => u.vendedorId === v.id);
function vistaVendedores() {
  const ventas = aprobados().filter(m => m.categoria === "Venta");
  const mes = rango("mes");
  const tarjetas = db.vendedores.map(v => {
    const suyas = ventas.filter(m => m.vendedorId === v.id);
    const delMes = entre(suyas, mes[0], mes[1]);
    const total = suyas.reduce((a, m) => a + m.monto, 0);
    const generada = suyas.reduce((a, m) => a + comision(m), 0);
    const aPagar = suyas.filter(m => !m.comisionPagada).reduce((a, m) => a + comision(m), 0);
    const acc = accesoDe(v);
    return `<section class="panel vend">
      <div class="top"><h2>${esc(v.nombre)}${v.activo === false ? ' <span class="chip">Inactivo</span>' : ""}</h2><button class="link" data-a="editar-vend" data-id="${esc(v.id)}" type="button">Editar</button></div>
      <div class="datos">
        <div><small>Ventas</small><b>${suyas.length}</b></div>
        <div><small>Total vendido</small><b>${plata(total)}</b></div>
        <div><small>Vendido este mes</small><b>${plata(delMes.reduce((a, m) => a + m.monto, 0))}</b></div>
        <div><small>Comisión (${esc(v.comision)}%)</small><b>${plata(generada)}</b></div>
        <div><small>Comisión a pagar</small><b>${plata(aPagar)}</b></div>
      </div>
      <div class="acceso">${acc
        ? `<span class="gris">Acceso: ${esc(acc.email)}${acc.activo === false ? " · desactivado" : ""}</span>
           <button class="link" data-a="acceso-activo" data-id="${esc(acc.id)}" data-on="${acc.activo === false ? "1" : "0"}" type="button">${acc.activo === false ? "Reactivar" : "Quitar acceso"}</button>`
        : `<span class="gris">Sin usuario para entrar.</span> <button class="btn sec chico" data-a="crear-acceso" data-id="${esc(v.id)}" type="button">Crear acceso</button>`}</div>
    </section>`;
  }).join("");
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Vendedores</h1><p>Quién vendió cuánto, qué comisión le corresponde y su acceso al sistema.</p></div>
      <div class="acciones"><button class="btn" data-a="nuevo-venta" type="button">+ Cargar venta</button><button class="btn sec" data-a="nuevo-vend" type="button">+ Agregar vendedor</button></div></div>
    <div class="vendedores">${tarjetas || `<div class="vacio">Todavía no hay vendedores.</div>`}</div>
    <section class="panel"><h2>Ventas</h2><div class="sub">Tildá “Pagada” cuando le pases la comisión.</div><div class="scroll">
      ${ventas.length ? `<table><thead><tr><th>Fecha</th><th>Venta</th><th>Vendedor</th><th class="num">Monto</th><th class="num">Comisión</th><th>Pagada</th></tr></thead><tbody>
      ${ordenados(ventas).map(m => `<tr><td>${celdaFecha(m)}</td><td>${esc(m.concepto)}</td><td>${selectorVendedor(m)}</td><td class="num">${plata(m.monto)}</td><td class="num">${m.vendedorId ? plata(comision(m)) : "–"}</td>
        <td>${m.vendedorId ? `<input type="checkbox" data-a="pagada" data-id="${esc(m.id)}" aria-label="Comisión pagada" ${m.comisionPagada ? "checked" : ""}>` : ""}</td></tr>`).join("")}
      </tbody></table>` : `<div class="vacio">Todavía no hay ventas cargadas.</div>`}
    </div></section>`;
}

/* ---------- Dueño: Postulantes (se anotan desde carteg.com.ar/vendedores) ---------- */
const ESTADOS_POST = ["Nuevo", "Contactado", "Sumado", "Descartado"];
const nuevosPost = () => (db.postulantes || []).filter(p => (p.estado || "Nuevo") === "Nuevo").length;
function vistaPostulantes() {
  const lista = [...(db.postulantes || [])].sort((a, b) => (b.creado || 0) - (a.creado || 0));
  const fecha = ms => ms ? fechaCorta(aTexto(new Date(ms))) : "";
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Postulantes</h1><p>Personas que quieren vender displays. Se anotan en <a href="/vendedores" target="_blank" rel="noopener">carteg.com.ar/vendedores</a>.</p></div></div>
    ${lista.length ? `<div class="lista">${lista.map(p => {
      const wa = normalizarWhatsapp(p.whatsapp);
      const texto = encodeURIComponent(`Hola ${p.nombre || ""}! Soy Maxi, de Carteg. Vi que te postulaste para vender displays. ¿Tenés unos minutos para que te cuente cómo es?`);
      return `<article class="panel local" data-id="${esc(p.id)}">
        <div class="top"><div><div class="nombre">${esc(p.nombre)}</div>
          <div class="meta">${[esc(p.zona), esc(p.disponibilidad), p.edad ? esc(p.edad) + " años" : "", fecha(p.creado)].filter(Boolean).join(" · ")}</div></div>
          <span class="chip ${(p.estado || "Nuevo") === "Nuevo" ? "ojo" : ""}">${esc(p.estado || "Nuevo")}</span></div>
        ${p.experiencia ? `<div class="op"><span>Experiencia:</span> ${esc(p.experiencia)}</div>` : ""}
        ${p.mensaje ? `<div class="op"><span>Mensaje:</span> ${esc(p.mensaje)}</div>` : ""}
        <div class="acts">
          ${wa ? `<a class="btn" href="https://wa.me/${wa}?text=${texto}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          ${p.instagram ? `<a class="btn sec" href="https://www.instagram.com/${encodeURIComponent(String(p.instagram).replace(/^@/, ""))}/" target="_blank" rel="noopener">Instagram</a>` : ""}
          <select data-a="estado-post" aria-label="Estado">${ESTADOS_POST.map(e => `<option ${e === (p.estado || "Nuevo") ? "selected" : ""}>${e}</option>`).join("")}</select>
          <button class="link" data-a="borrar-post" type="button">Borrar</button>
        </div>
        <textarea data-a="nota-post" aria-label="Notas" placeholder="Notas (qué hablaron, cuándo arranca…)">${esc(p.nota || "")}</textarea>
      </article>`; }).join("")}</div>` : `<div class="vacio">Todavía no se postuló nadie. Compartí el flyer o el link carteg.com.ar/vendedores.</div>`}`;
}

/* ---------- Dueño: Locales ---------- */
const todosLocales = () => [...db.locales].sort((a, b) => (b.manual ? 1 : 0) - (a.manual ? 1 : 0) || (b.creado || 0) - (a.creado || 0) || (b.puntuacion || 0) - (a.puntuacion || 0));
function seg(id) { return db.seguimiento[id] || (db.seguimiento[id] = { estado: "Pendiente", nota: "", enviado: null, seguido: null }); }
function tocaSeguir(id) { const s = db.seguimiento[id]; return !!s && s.estado === "Enviado" && !s.seguido && diasDesde(s.enviado) >= 3; }
const urlSegura = u => /^https?:\/\//i.test(u || "") ? u : "";
function vistaLocales() {
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Locales</h1><p>Negocios para contactar, con los mensajes listos.</p></div>
      <div class="acciones"><button class="btn sec" data-a="nuevo-local" type="button">+ Agregar local</button></div></div>
    ${db.locales.length ? "" : `<section class="panel"><h2>Todavía no hay locales</h2><p class="gris">Importá el archivo <code>locales-para-importar.json</code> que está en tu carpeta Carteg\\Sistema.</p>
      <button class="btn sec" data-a="importar" type="button">Importar locales</button></section>`}
    <div class="tiles" id="statsLoc"></div>
    <div class="filtros">
      <input type="search" id="lq" placeholder="Buscar por nombre, barrio o Instagram…" aria-label="Buscar locales" value="${esc(filtrosLoc.q)}">
      <select id="lf" aria-label="Filtrar por estado"><option value="">Todos los estados</option><option value="seguir">Toca seguimiento</option>${ESTADOS.map(e => `<option>${e}</option>`).join("")}</select>
    </div>
    <div class="lista" id="listaLoc"></div>`;
  $("lf").value = filtrosLoc.estado;
  $("lq").addEventListener("input", e => { filtrosLoc.q = e.target.value; listaLocales(); });
  $("lf").addEventListener("change", e => { filtrosLoc.estado = e.target.value; listaLocales(); });
  listaLocales();
}
const estadoDe = id => (db.seguimiento[id] || {}).estado || "Pendiente";
function tarjetaLocal(l) {
  const s = db.seguimiento[l.id] || { estado: "Pendiente", nota: "", enviado: null };
  const d = diasDesde(s.enviado), toca = tocaSeguir(l.id);
  const web = urlSegura(l.web), maps = urlSegura(l.maps);
  const wa = String(l.whatsapp || "").replace(/\D/g, "");
  const meta = [esc(l.rubro), esc(l.direccion),
    l.rating ? `★ ${esc(l.rating)}${l.resenas ? ` (${esc(l.resenas)})` : ""}` : "",
    web ? `<a href="${esc(web)}" target="_blank" rel="noopener">web</a>` : "",
    maps ? `<a href="${esc(maps)}" target="_blank" rel="noopener">mapa</a>` : "",
    l.telefono ? esc(l.telefono) : ""].filter(Boolean).join(" · ");
  const msg = (t, b) => b ? `<div class="msg"><h3>${t}</h3>${esc(b)}</div>` : "";
  const hayMsg = l.mensaje_whatsapp || l.mensaje_instagram || l.mensaje_seguimiento;
  return `<article class="panel local ${["Cliente", "Descartado"].includes(s.estado) ? "hecho" : ""}" data-id="${esc(l.id)}">
    <div class="top"><div><div class="nombre">${esc(l.nombre)}</div><div class="meta">${meta}</div></div>${l.puntuacion ? `<div class="puntos" title="Puntuación">${esc(l.puntuacion)}</div>` : ""}</div>
    ${l.oportunidad ? `<div class="op"><span>Oportunidad:</span> ${esc(l.oportunidad)}</div>` : ""}
    ${l.detalle ? `<div class="op"><span>Detalle:</span> ${esc(l.detalle)}</div>` : ""}
    <div class="chips"><span class="chip">${esc(s.estado)}</span>${d !== null ? `<span class="chip ${toca ? "ojo" : ""}">Enviado hace ${d} d${toca ? " · toca seguimiento" : ""}</span>` : ""}</div>
    ${hayMsg ? `<details><summary>Ver mensajes</summary>${msg("WhatsApp", l.mensaje_whatsapp)}${msg("Instagram", l.mensaje_instagram)}${msg("Seguimiento (a los 3 días)", l.mensaje_seguimiento)}</details>` : ""}
    <div class="acts">
      ${wa ? `<a class="btn" data-a="wa" href="https://wa.me/${wa}?text=${encodeURIComponent(l.mensaje_whatsapp || "")}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
      ${l.instagram ? `<button class="btn sec" data-a="ig" type="button">Instagram</button>` : ""}
      ${l.mensaje_seguimiento ? `<button class="btn sec" data-a="seg" type="button">Copiar seguimiento</button>` : ""}
      <select data-a="estado" aria-label="Estado">${ESTADOS.map(e => `<option ${e === s.estado ? "selected" : ""}>${e}</option>`).join("")}</select>
      ${l.manual ? `<button class="link" data-a="borrar-local" type="button">Borrar</button>` : ""}
    </div>
    <textarea data-a="nota" aria-label="Notas" placeholder="Notas (qué respondió, próximo paso…)">${esc(s.nota)}</textarea>
  </article>`;
}
function listaLocales() {
  const q = filtrosLoc.q.toLowerCase().trim(), f = filtrosLoc.estado;
  const ls = todosLocales(), c = k => ls.filter(l => estadoDe(l.id) === k).length;
  $("statsLoc").innerHTML = ls.length ? tile("Locales", String(ls.length)) + tile("Pendientes", String(c("Pendiente"))) + tile("Enviados", String(c("Enviado"))) +
    tile("Respondieron", String(c("Respondió") + c("Interesado") + c("Cliente"))) + tile("Clientes", String(c("Cliente"))) + tile("Toca seguimiento", String(ls.filter(l => tocaSeguir(l.id)).length)) : "";
  const vis = ls.filter(l => {
    if (f === "seguir" && !tocaSeguir(l.id)) return false;
    if (f && f !== "seguir" && estadoDe(l.id) !== f) return false;
    return !q || [l.nombre, l.rubro, l.direccion, l.instagram].join(" ").toLowerCase().includes(q);
  });
  $("listaLoc").innerHTML = vis.length ? vis.map(tarjetaLocal).join("") : (ls.length ? `<div class="vacio">No hay locales con este filtro.</div>` : "");
}
function marcarEnviado(id) {
  const s = seg(id);
  if (s.estado === "Pendiente") { s.estado = "Enviado"; s.enviado = Date.now(); }
  guardar(); setTimeout(listaLocales, 400);
}

/* ---------- Displays (dueño y vendedores) ---------- */
const codigoTexto = n => "c" + String(n).padStart(3, "0");
function vistaDisplays() {
  const ult = db.config.ultimoCodigo || 0;
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Displays</h1><p>Cada display tiene un chip y un QR con su código. Se activan desde el celular, en el momento.</p></div>
      <div class="acciones"><a class="btn" href="/activar/" target="_blank" rel="noopener">Abrir panel de activación</a></div></div>
    <section class="panel"><h2>Cómo se usa</h2>
      <ol class="pasos-lista">
        <li><b>En el local:</b> escaneá el QR del display con tu celular (o entrá a <code>${DOMINIO}/activar/</code>), elegí a dónde lleva y tocá <b>Activar</b>. Funciona al instante.</li>
        <li><b>Reseñas:</b> tocá “Buscar en Google Maps”, elegí el local → Compartir → Copiar link, y pegalo.</li>
        <li><b>Toques:</b> en el panel de activación ves cuántas veces se usó cada display, en total y en el mes.</li>
      </ol>
    </section>
    ${rol === "dueno" ? `<section class="panel"><h2>Stickers QR</h2>
      <div class="sub">${ult ? `Impresos: c001 a ${codigoTexto(ult)}` : "Todavía no creaste ninguna hoja."} · Cada QR mide 5 × 5 cm.</div>
      <div class="acciones"><button class="btn sec" data-a="hoja-nueva" type="button">Crear e imprimir 50 nuevos</button>
        ${ult ? `<button class="btn sec" data-a="reimprimir" type="button">Volver a imprimir…</button>` : ""}</div>
    </section>` : ""}`;
}
let promesaQR = null;
function cargarQR() {
  if (window.qrcode) return Promise.resolve();
  if (!promesaQR) promesaQR = new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
    s.onload = ok; s.onerror = () => { promesaQR = null; mal(new Error("sin conexión")); };
    document.head.appendChild(s);
  });
  return promesaQR;
}
function matrizQR(texto) {
  const qr = window.qrcode(0, "M"); qr.addData(texto); qr.make();
  const n = qr.getModuleCount(), m = [];
  for (let r = 0; r < n; r++) { m.push([]); for (let c = 0; c < n; c++) m[r].push(qr.isDark(r, c)); }
  return m;
}
function svgQR(m, borde = 4) {
  const t = m.length + borde * 2;
  let p = "";
  m.forEach((fila, r) => fila.forEach((v, c) => { if (v) p += `M${c + borde} ${r + borde}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
}
async function imprimirHoja(desde, hasta) {
  const w = window.open("", "_blank");
  if (!w) { toast("El navegador bloqueó la ventana. Permití ventanas emergentes y probá de nuevo."); return; }
  w.document.write("<p style='font-family:Arial;padding:20px'>Generando los QR…</p>");
  try {
    await cargarQR();
    let celdas = "";
    for (let i = desde; i <= hasta; i++) {
      const c = codigoTexto(i);
      celdas += `<div class="celda">${svgQR(matrizQR(`https://${DOMINIO}/r/${c}`), 1)}<span>${c}</span></div>`;
    }
    w.document.open();
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Stickers QR ${codigoTexto(desde)} a ${codigoTexto(hasta)}</title><style>
      @page { size: A4; margin: 10mm; }
      body { margin: 0; font-family: Arial, sans-serif; color: #000; background: #fff; }
      .ayuda { margin: 12px; padding: 12px 16px; background: #fff7d6; border: 1px solid #e0b84a; border-radius: 8px; font-size: 14px; line-height: 1.5; }
      .ayuda button { font-size: 15px; padding: 6px 14px; margin-top: 6px; }
      @media print { .ayuda { display: none; } }
      .hoja { display: grid; grid-template-columns: repeat(3, 60mm); grid-auto-rows: 64mm; justify-content: center; }
      .celda { border: 0.2mm dashed #aaa; display: flex; flex-direction: column; align-items: center; justify-content: center; break-inside: avoid; }
      .celda svg { width: 50mm; height: 50mm; display: block; }
      .celda span { font-size: 10pt; margin-top: 2mm; letter-spacing: .06em; }
    </style></head><body>
      <div class="ayuda"><b>Antes de imprimir:</b> elegí tamaño <b>real</b> o <b>100%</b>, no “ajustar a la página”. Medí un QR: tiene que dar 5 cm.<br><button onclick="print()">Imprimir</button></div>
      <div class="hoja">${celdas}</div></body></html>`);
    w.document.close();
  } catch (e) {
    w.document.body.innerHTML = "<p style='font-family:Arial;padding:20px'>No se pudieron generar los QR. Revisá la conexión y probá de nuevo.</p>";
  }
}

/* ---------- Vendedor: Mis métricas ---------- */
const miVendedor = () => vendedor(perfil && perfil.vendedorId) || { nombre: (perfil && perfil.nombre) || "", comision: 0 };
function vistaMisMetricas() {
  const p = pref("periodo-v", "mes");
  const mias = db.movimientos;
  const ok = delPeriodo(mias.filter(cuenta), p);
  const vendido = ok.reduce((a, m) => a + m.monto, 0);
  const ganada = ok.reduce((a, m) => a + comision(m), 0);
  const aCobrar = mias.filter(m => cuenta(m) && !m.comisionPagada).reduce((a, m) => a + comision(m), 0);
  const pend = mias.filter(m => m.estado === "pendiente");
  const rk = db.ranking && db.ranking.mes === hoy().slice(0, 7) ? db.ranking.filas : [];
  const puesto = rk.findIndex(f => f.vendedorId === perfil.vendedorId);
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Hola, ${esc(miVendedor().nombre)}</h1><p>Tus ventas y comisiones.</p></div>
      <div class="acciones"><button class="btn" data-a="mi-venta" type="button">+ Cargar venta</button></div></div>
    <div class="tabs">${PERIODOS.map(([k, t]) => `<button type="button" data-a="periodo-v" data-p="${k}" aria-pressed="${k === p}">${t}</button>`).join("")}</div>
    <div class="tiles">
      ${tile("Ventas", String(ok.length))}
      ${tile("Vendido", plata(vendido))}
      ${tile(`Tu comisión (${esc(miVendedor().comision)}%)`, plata(ganada))}
      ${tile("Comisión a cobrar", plata(aCobrar), "Ventas aprobadas que todavía no te pagaron")}
      ${tile("Pendientes de aprobar", String(pend.length), pend.length ? plata(pend.reduce((a, m) => a + m.monto, 0)) : "")}
      ${tile("Puesto en el ranking", puesto >= 0 ? `${puesto + 1}º de ${rk.length}` : "–", "Este mes")}
    </div>
    <section class="panel"><h2>Últimas ventas</h2><div class="scroll">${tablaMisVentas(ordenados(mias).slice(0, 8), false)}</div></section>`;
}
function tablaMisVentas(lista, conAcciones) {
  if (!lista.length) return `<div class="vacio">Todavía no cargaste ventas.</div>`;
  return `<table><thead><tr><th>Fecha</th><th>Venta</th><th class="num">Monto</th><th class="num">Tu comisión</th><th>Estado</th>${conAcciones ? "<th></th>" : ""}</tr></thead><tbody>
    ${lista.map(m => `<tr><td>${celdaFecha(m)}</td><td>${esc(m.concepto)}${m.motivo ? `<br><small class="gris">${esc(m.motivo)}</small>` : ""}</td><td class="num">${plata(m.monto)}</td><td class="num">${plata(comision(m))}</td>
      <td>${m.estado === "pendiente" ? `<span class="chip ojo">Pendiente</span>` : m.estado === "rechazada" ? `<span class="chip">Rechazada</span>` : m.comisionPagada ? `<span class="chip">Cobrada</span>` : `<span class="chip">Aprobada</span>`}</td>
      ${conAcciones ? `<td>${m.estado === "pendiente" && m.creadoPor === usuario.uid ? `<div class="fila"><button class="link" data-a="editar-mi-venta" data-id="${esc(m.id)}" type="button">Editar</button><button class="link" data-a="borrar-mi-venta" data-id="${esc(m.id)}" type="button">Borrar</button></div>` : ""}</td>` : ""}</tr>`).join("")}
  </tbody></table>`;
}
function vistaMisVentas() {
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Mis ventas</h1><p>Cargá cada venta apenas la cerrás. Cuenta cuando se aprueba.</p></div>
      <div class="acciones"><button class="btn" data-a="mi-venta" type="button">+ Cargar venta</button></div></div>
    <section class="panel"><div class="scroll">${tablaMisVentas(ordenados(db.movimientos), true)}</div></section>`;
}
function vistaRanking() {
  const rk = db.ranking && db.ranking.mes === hoy().slice(0, 7) ? db.ranking.filas : [];
  $("vista").innerHTML = `
    <div class="cabeza"><div><h1>Ranking</h1><p>Ventas aprobadas de ${esc(nombreMes(hoy().slice(0, 7)))}.</p></div></div>
    <section class="panel"><div class="scroll">
      ${rk.length ? `<table><thead><tr><th>Puesto</th><th>Vendedor</th><th class="num">Ventas</th><th class="num">Vendido</th></tr></thead><tbody>
      ${rk.map((f, i) => `<tr class="${f.vendedorId === perfil.vendedorId ? "yo" : ""}"><td>${i + 1}º</td><td>${esc(f.nombre)}${f.vendedorId === perfil.vendedorId ? " (vos)" : ""}</td><td class="num">${f.ventas}</td><td class="num">${plata(f.monto)}</td></tr>`).join("")}
      </tbody></table>` : `<div class="vacio">Todavía no hay ventas aprobadas este mes.</div>`}
    </div></section>`;
}

/* ---------- Formularios ---------- */
const dlg = $("dlg");
function cerrar() { dlg.close(); }
dlg.addEventListener("click", e => { if (e.target.closest("[data-cerrar]")) cerrar(); });

function formMovimiento(m, preset) {
  const editando = !!m;
  const d = m || { tipo: preset, fecha: hoy(), concepto: "", monto: "", categoria: CATEGORIAS[preset][0], vendedorId: null };
  const opts = t => CATEGORIAS[t].map(c => `<option ${c === d.categoria ? "selected" : ""}>${c}</option>`).join("");
  const activos = db.vendedores.filter(v => v.activo !== false || v.id === d.vendedorId);
  dlg.innerHTML = `<form id="fm">
    <h2>${editando ? "Editar movimiento" : d.tipo === "ingreso" ? "Cargar venta o ingreso" : "Cargar gasto"}</h2>
    <label>Tipo<select name="tipo"><option value="ingreso" ${d.tipo === "ingreso" ? "selected" : ""}>Ingreso</option><option value="egreso" ${d.tipo === "egreso" ? "selected" : ""}>Egreso</option></select></label>
    <label>Fecha<input type="date" name="fecha" value="${esc(d.fecha || "")}"></label>
    <label class="check"><input type="checkbox" name="sinfecha" ${editando && !d.fecha ? "checked" : ""}> No sé la fecha</label>
    <label>Concepto<input type="text" name="concepto" required maxlength="120" value="${esc(d.concepto)}"></label>
    <label>Monto ($)<input type="number" name="monto" required min="0.01" step="0.01" inputmode="decimal" value="${esc(d.monto)}"></label>
    <label>Categoría<select name="categoria">${opts(d.tipo)}</select></label>
    <label id="filaVend">Vendedor<select name="vendedor"><option value="">Sin vendedor</option>${activos.map(v => `<option value="${esc(v.id)}" ${v.id === d.vendedorId ? "selected" : ""}>${esc(v.nombre)} (${esc(v.comision)}%)</option>`).join("")}</select></label>
    <div class="pie"><button class="btn sec" type="button" data-cerrar>Cancelar</button><button class="btn" type="submit">Guardar</button></div>
  </form>`;
  const f = $("fm");
  const ajustar = () => { f.fecha.disabled = f.sinfecha.checked; f.fecha.required = !f.sinfecha.checked; $("filaVend").hidden = f.categoria.value !== "Venta"; };
  f.tipo.addEventListener("change", () => { f.categoria.innerHTML = CATEGORIAS[f.tipo.value].map(c => `<option>${c}</option>`).join(""); ajustar(); });
  f.categoria.addEventListener("change", ajustar);
  f.sinfecha.addEventListener("change", ajustar);
  ajustar();
  f.addEventListener("submit", e => {
    e.preventDefault();
    const monto = redondear(parseFloat(f.monto.value));
    const concepto = f.concepto.value.trim();
    if (!concepto || !(monto > 0)) { toast("Revisá el concepto y el monto"); return; }
    const vendedorId = f.categoria.value === "Venta" ? (f.vendedor.value || null) : null;
    const destino = m || { id: nuevoId(), comisionPct: 0, comisionPagada: false, vendedorId: null, estado: "aprobada", creadoEn: Date.now() };
    if (vendedorId !== destino.vendedorId) { destino.comisionPct = vendedorId ? vendedor(vendedorId).comision : 0; destino.comisionPagada = false; }
    Object.assign(destino, { tipo: f.tipo.value, fecha: f.sinfecha.checked ? null : f.fecha.value, concepto, monto, categoria: f.categoria.value, vendedorId });
    if (!m) db.movimientos.push(destino);
    guardar(); cerrar(); pintar(); toast("Guardado");
  });
  dlg.showModal();
}

function formVendedor(v) {
  dlg.innerHTML = `<form id="fv">
    <h2>${v ? "Editar vendedor" : "Agregar vendedor"}</h2>
    <label>Nombre<input type="text" name="nombre" required maxlength="60" value="${esc(v ? v.nombre : "")}"></label>
    <label>Comisión por venta (%)<input type="number" name="comision" required min="0" max="100" step="0.1" value="${esc(v ? v.comision : 10)}"></label>
    <label class="check"><input type="checkbox" name="activo" ${!v || v.activo !== false ? "checked" : ""}> Vendedor activo</label>
    ${v ? `<p class="aviso">Si cambiás el porcentaje, se aplica a las ventas nuevas. Las ya cargadas quedan como estaban.</p>` : ""}
    <div class="pie"><button class="btn sec" type="button" data-cerrar>Cancelar</button><button class="btn" type="submit">Guardar</button></div>
  </form>`;
  const f = $("fv");
  f.addEventListener("submit", e => {
    e.preventDefault();
    const nombre = f.nombre.value.trim(); if (!nombre) return;
    const datos = { nombre, comision: parseFloat(f.comision.value) || 0, activo: f.activo.checked };
    if (v) Object.assign(v, datos); else db.vendedores.push({ id: nuevoId(), ...datos });
    guardar(); cerrar(); pintar(); toast("Guardado");
  });
  dlg.showModal();
}

/* Crear el usuario de un vendedor sin cerrar la sesión del dueño (se usa una segunda conexión) */
let authAlta = null;
function formAcceso(v) {
  dlg.innerHTML = `<form id="fa">
    <h2>Crear acceso para ${esc(v.nombre)}</h2>
    <p class="gris">Con este mail y contraseña va a entrar a <b>${DOMINIO}/sistema/</b>. Va a ver solo sus ventas, sus comisiones y el ranking. Después puede cambiar la contraseña con “Olvidé mi contraseña”.</p>
    <label>Mail<input type="email" name="mail" required autocomplete="off"></label>
    <label>Contraseña inicial (6 caracteres o más)<input type="text" name="clave" required minlength="6" autocomplete="new-password"></label>
    <p class="error" id="errAcceso" hidden></p>
    <div class="pie"><button class="btn sec" type="button" data-cerrar>Cancelar</button><button class="btn" type="submit" id="bAcceso">Crear acceso</button></div>
  </form>`;
  const f = $("fa");
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const err = t => { $("errAcceso").textContent = t; $("errAcceso").hidden = false; };
    const b = $("bAcceso"); b.disabled = true;
    try {
      if (!authAlta) authAlta = getAuth(initializeApp(CONFIG, "altas"));
      const email = f.mail.value.trim();
      const cred = await createUserWithEmailAndPassword(authAlta, email, f.clave.value);
      await setDoc(doc(fs, "usuarios", cred.user.uid), { rol: "vendedor", vendedorId: v.id, nombre: v.nombre, email, activo: true, creado: Date.now() });
      await signOut(authAlta);
      cerrar(); toast(`Listo: ${v.nombre} ya puede entrar`);
    } catch (e2) {
      b.disabled = false;
      const c = e2.code || "";
      err(c.includes("email-already-in-use") ? "Ese mail ya tiene un usuario." : c.includes("invalid-email") ? "Ese mail no es válido." : c.includes("weak-password") ? "La contraseña tiene que tener 6 caracteres o más." : "No se pudo crear. Revisá la conexión y probá de nuevo.");
    }
  });
  dlg.showModal();
}

function formRechazo(m) {
  dlg.innerHTML = `<form id="fr">
    <h2>Rechazar venta</h2>
    <p class="gris">${esc(nombreVendedor(m.vendedorId))} · ${esc(m.concepto)} · ${plata(m.monto)}</p>
    <label>Motivo (lo ve el vendedor)<input type="text" name="motivo" maxlength="140" placeholder="Por ejemplo: el cliente no pagó"></label>
    <div class="pie"><button class="btn sec" type="button" data-cerrar>Cancelar</button><button class="btn" type="submit">Rechazar</button></div>
  </form>`;
  $("fr").addEventListener("submit", e => {
    e.preventDefault();
    m.estado = "rechazada"; m.motivo = $("fr").motivo.value.trim();
    guardar(); cerrar(); pintar(); toast("Venta rechazada");
  });
  dlg.showModal();
}

/* Vendedor: cargar o editar su venta (queda pendiente) */
function formMiVenta(m) {
  const editando = !!m;
  const d = m || { fecha: hoy(), cliente: "", producto: PRODUCTOS[0][0], monto: PRODUCTOS[0][1], nota: "" };
  dlg.innerHTML = `<form id="fmv">
    <h2>${editando ? "Editar venta" : "Cargar venta"}</h2>
    <label>Fecha<input type="date" name="fecha" required value="${esc(d.fecha || hoy())}"></label>
    <label>Local o cliente<input type="text" name="cliente" required maxlength="80" value="${esc(d.cliente || "")}"></label>
    <label>Qué vendiste<select name="producto">${PRODUCTOS.map(([p]) => `<option ${p === d.producto ? "selected" : ""}>${p}</option>`).join("")}</select></label>
    <label>Monto cobrado ($)<input type="number" name="monto" required min="1" step="0.01" inputmode="decimal" value="${esc(d.monto)}"></label>
    <label>Nota (opcional)<input type="text" name="nota" maxlength="140" value="${esc(d.nota || "")}" placeholder="Por ejemplo: pagó por transferencia"></label>
    <p class="gris">Queda pendiente hasta que se apruebe. Tu comisión es del ${esc(miVendedor().comision)}%.</p>
    <p class="error" id="errMv" hidden></p>
    <div class="pie"><button class="btn sec" type="button" data-cerrar>Cancelar</button><button class="btn" type="submit" id="bMv">Guardar</button></div>
  </form>`;
  const f = $("fmv");
  f.producto.addEventListener("change", () => { const p = PRODUCTOS.find(x => x[0] === f.producto.value); if (p && p[1]) f.monto.value = p[1]; });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const monto = redondear(parseFloat(f.monto.value)), cliente = f.cliente.value.trim();
    if (!cliente || !(monto > 0)) return;
    const id = m ? m.id : nuevoId();
    const datos = { tipo: "ingreso", categoria: "Venta", estado: "pendiente", fecha: f.fecha.value, cliente, producto: f.producto.value,
      concepto: `${cliente} · ${f.producto.value}`, monto, nota: f.nota.value.trim(), vendedorId: perfil.vendedorId,
      comisionPct: m ? m.comisionPct : (miVendedor().comision || 0), comisionPagada: false, creadoPor: usuario.uid, creadoEn: m ? m.creadoEn : Date.now() };
    $("bMv").disabled = true;
    try {
      if (!DEMO) await setDoc(doc(fs, "movimientos", id), datos);
      else { db.movimientos = db.movimientos.filter(x => x.id !== id).concat({ id, ...datos }); pintar(); }
      cerrar(); toast(editando ? "Venta actualizada" : "Venta cargada: queda pendiente de aprobación");
    } catch (e2) { $("bMv").disabled = false; $("errMv").textContent = "No se pudo guardar. Revisá la conexión y probá de nuevo."; $("errMv").hidden = false; }
  });
  dlg.showModal();
}

function normalizarWhatsapp(t) {
  let n = String(t || "").replace(/\D/g, "");
  if (!n) return "";
  if (n.startsWith("0")) n = n.slice(1);
  /* Sin código de país, con el "15" del celular adentro (ej: 351 15 555-1234): se saca el 15 */
  if (!n.startsWith("54") && n.length === 12) {
    for (const i of [3, 4, 2]) if (n.substr(i, 2) === "15") { n = n.slice(0, i) + n.slice(i + 2); break; }
  }
  if (!n.startsWith("54")) n = "549" + n;
  return n;
}
function formLocal() {
  dlg.innerHTML = `<form id="fl">
    <h2>Agregar local</h2>
    <label>Nombre<input type="text" name="nombre" required maxlength="100"></label>
    <label>Rubro<input type="text" name="rubro" maxlength="60"></label>
    <label>Dirección<input type="text" name="direccion" maxlength="120"></label>
    <label>WhatsApp (ej: 351 696-7688)<input type="tel" name="whatsapp" maxlength="25"></label>
    <label>Instagram (sin @)<input type="text" name="instagram" maxlength="60"></label>
    <label>Mensaje<textarea name="mensaje" rows="4"></textarea></label>
    <div class="pie"><button class="btn sec" type="button" data-cerrar>Cancelar</button><button class="btn" type="submit">Guardar</button></div>
  </form>`;
  const f = $("fl");
  f.addEventListener("submit", e => {
    e.preventDefault();
    const nombre = f.nombre.value.trim(); if (!nombre) return;
    const instagram = f.instagram.value.trim().replace(/^@/, "");
    const whatsapp = normalizarWhatsapp(f.whatsapp.value);
    const mensaje = f.mensaje.value.trim();
    db.locales.push({ id: nuevoId(), manual: true, creado: Date.now(), nombre, rubro: f.rubro.value.trim(), direccion: f.direccion.value.trim(), whatsapp, instagram,
      telefono: f.whatsapp.value.trim(), mensaje_whatsapp: whatsapp ? mensaje : "", mensaje_instagram: instagram ? mensaje : "" });
    guardar(); cerrar(); pintar(); toast("Local agregado");
  });
  dlg.showModal();
}
function formReimprimir() {
  const ult = db.config.ultimoCodigo || 0;
  dlg.innerHTML = `<form id="fri">
    <h2>Volver a imprimir</h2>
    <p class="gris">Por si se te arruinó un sticker o querés imprimir otra vez una tanda. Los códigos son los mismos.</p>
    <label>Desde el número<input type="number" name="desde" min="1" max="${ult}" value="1" required></label>
    <label>Hasta el número<input type="number" name="hasta" min="1" max="${ult}" value="${ult}" required></label>
    <div class="pie"><button class="btn sec" type="button" data-cerrar>Cancelar</button><button class="btn" type="submit">Imprimir</button></div>
  </form>`;
  const f = $("fri");
  f.addEventListener("submit", e => {
    e.preventDefault();
    const a = parseInt(f.desde.value, 10), b = parseInt(f.hasta.value, 10);
    if (!(a >= 1 && b >= a && b <= ult)) { toast(`Elegí números entre 1 y ${ult}`); return; }
    cerrar(); imprimirHoja(a, b);
  });
  dlg.showModal();
}

/* ---------- Importar datos (de Carteg Sistema de la compu, o la lista de locales) ---------- */
function datosPlanilla() {
  const eg = (id, concepto, monto, categoria) => ({ id, tipo: "egreso", fecha: null, concepto, monto, categoria, vendedorId: null, comisionPct: 0, comisionPagada: false, estado: "aprobada" });
  const vt = (id, concepto, monto) => ({ id, tipo: "ingreso", fecha: null, concepto, monto, categoria: "Venta", vendedorId: null, comisionPct: 0, comisionPagada: false, estado: "aprobada" });
  return {
    movimientos: [eg("e1", "Filamento blanco 1kg", 25000, "Insumos"), eg("e2", "Filamento Rosa 1kg", 33200, "Insumos"), eg("e3", "Impresora 3D", 250000, "Inversión"),
      eg("e4", "Bolsas y Cajas", 78131.46, "Embalaje"), eg("e5", "Filamento negro 1kg", 25000, "Insumos"), eg("e6", "Chips Nfc 300 u", 43700, "Insumos"),
      vt("v1", "Vta Inmogastiazoro", 34000), vt("v2", "Vta Nuevonippon", 24000), vt("v3", "Vta Artetoldos", 24000), vt("v4", "Vta Lomas Fitness", 50000),
      vt("v5", "Vta Mercadito del cerro", 24000), vt("v6", "Vta Mauro", 25000), vt("v7", "Vta Efecto Lola", 60000)],
    vendedores: [{ id: "zoe", nombre: "Zoe", comision: 10, activo: true }],
  };
}
function aplicarImportacion(d) {
  let n = 0;
  if (Array.isArray(d.leads)) {
    for (const l of d.leads) if (l && l.id && !db.locales.some(x => x.id === l.id)) { db.locales.push({ ...l, puntuacion: l.puntuacion || 0 }); n++; }
    return `Se importaron ${n} locales.`;
  }
  if (!Array.isArray(d.movimientos) || !Array.isArray(d.vendedores)) throw new Error("formato");
  const juntar = (lista, nuevos) => { for (const x of nuevos) if (x && x.id) { const i = lista.findIndex(y => y.id === x.id); if (i >= 0) lista[i] = { ...lista[i], ...x }; else lista.push(x); } };
  juntar(db.movimientos, d.movimientos.map(m => ({ ...m, estado: m.estado || "aprobada" })));
  juntar(db.vendedores, d.vendedores);
  if (d.seguimiento && typeof d.seguimiento === "object") Object.assign(db.seguimiento, d.seguimiento);
  if (Array.isArray(d.localesExtra)) juntar(db.locales, d.localesExtra.map(l => ({ ...l, manual: true })));
  if (Number.isInteger(d.ultimoCodigo) && d.ultimoCodigo > (db.config.ultimoCodigo || 0)) db.config.ultimoCodigo = d.ultimoCodigo;
  return `Se importaron ${d.movimientos.length} movimientos y ${d.vendedores.length} vendedores.`;
}
$("archivo").addEventListener("change", async e => {
  const arch = e.target.files[0]; e.target.value = "";
  if (!arch) return;
  try {
    const d = JSON.parse(await arch.text());
    if (!confirm("Se suman los datos del archivo a lo que ya hay en el sistema (lo repetido no se duplica). ¿Seguir?")) return;
    const msg = aplicarImportacion(d);
    guardar(); pintar(); toast(msg);
  } catch (err) { toast("Ese archivo no es una copia de Carteg Sistema ni una lista de locales"); }
});

/* ---------- Acciones ---------- */
$("nav").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  vista = b.dataset.v; location.hash = vista; pintar(); window.scrollTo(0, 0);
});
$("vista").addEventListener("click", async e => {
  const ir = e.target.closest("[data-v-ir]");
  if (ir) { vista = ir.dataset.vIr; location.hash = vista; pintar(); return; }
  const b = e.target.closest("[data-a]"); if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  const mov = id ? db.movimientos.find(x => x.id === id) : null;
  if (a === "periodo") { guardarPref("periodo", b.dataset.p); pintar(); }
  if (a === "periodo-v") { guardarPref("periodo-v", b.dataset.p); pintar(); }
  if (a === "nuevo-venta") formMovimiento(null, "ingreso");
  if (a === "nuevo-gasto") formMovimiento(null, "egreso");
  if (a === "nuevo-vend") formVendedor(null);
  if (a === "nuevo-local") formLocal();
  if (a === "editar-vend") formVendedor(vendedor(id));
  if (a === "crear-acceso") formAcceso(vendedor(id));
  if (a === "acceso-activo") {
    const u = db.usuarios.find(x => x.id === id);
    const activar = b.dataset.on === "1";
    if (!activar && !confirm(`¿Quitarle el acceso a ${u.nombre}? No va a poder entrar hasta que lo reactives.`)) return;
    try { if (!DEMO) await setDoc(doc(fs, "usuarios", id), { activo: activar }, { merge: true }); toast(activar ? "Acceso reactivado" : "Acceso quitado"); }
    catch (e2) { toast("No se pudo cambiar. Revisá la conexión."); }
  }
  if (a === "editar" && mov) formMovimiento(mov);
  if (a === "borrar" && mov && confirm(`¿Borrar “${mov.concepto}” de ${plata(mov.monto)}? No se puede deshacer.`)) {
    db.movimientos = db.movimientos.filter(x => x !== mov); guardar(); pintar(); toast("Borrado");
  }
  if (a === "aprobar" && mov) { mov.estado = "aprobada"; mov.aprobadoEn = Date.now(); delete mov.motivo; guardar(); pintar(); toast("Venta aprobada"); }
  if (a === "rechazar" && mov) formRechazo(mov);
  if (a === "importar") $("archivo").click();
  if (a === "datos-planilla" && confirm("Se cargan los gastos y ventas de tu planilla, y Zoe como vendedora. ¿Seguir?")) {
    aplicarImportacion(datosPlanilla()); guardar(); pintar(); toast("Datos de la planilla cargados");
  }
  if (a === "hoja-nueva") {
    const desde = (db.config.ultimoCodigo || 0) + 1, hasta = desde + 49;
    if (confirm(`Se crean los códigos ${codigoTexto(desde)} a ${codigoTexto(hasta)} y se abre la hoja para imprimir. ¿Seguir?`)) {
      db.config.ultimoCodigo = hasta; guardar(); pintar(); imprimirHoja(desde, hasta);
    }
  }
  if (a === "reimprimir") formReimprimir();
  if (a === "mi-venta") formMiVenta(null);
  if (a === "editar-mi-venta" && mov) formMiVenta(mov);
  if (a === "borrar-mi-venta" && mov && confirm(`¿Borrar la venta “${mov.concepto}”?`)) {
    try { if (!DEMO) await deleteDoc(doc(fs, "movimientos", mov.id)); else { db.movimientos = db.movimientos.filter(x => x !== mov); pintar(); } toast("Venta borrada"); }
    catch (e2) { toast("No se pudo borrar. Revisá la conexión."); }
  }
  if (a === "borrar-post") {
    const pid = b.closest("[data-id]").dataset.id, p = db.postulantes.find(x => x.id === pid);
    if (p && confirm(`¿Borrar la postulación de ${p.nombre}? No se puede deshacer.`)) { db.postulantes = db.postulantes.filter(x => x !== p); guardar(); pintar(); }
    return;
  }
  const tarjeta = b.closest(".local");
  if (tarjeta && vista === "locales") {
    const lid = tarjeta.dataset.id, l = db.locales.find(x => x.id === lid);
    if (a === "wa") marcarEnviado(lid);
    if (a === "ig") {
      await copiar(l.mensaje_instagram || "");
      toast("Mensaje copiado: pegalo en el chat");
      window.open(`https://ig.me/m/${encodeURIComponent(l.instagram)}`, "_blank", "noopener");
      marcarEnviado(lid);
    }
    if (a === "seg") { await copiar(l.mensaje_seguimiento || ""); toast("Seguimiento copiado"); seg(lid).seguido = Date.now(); guardar(); setTimeout(listaLocales, 400); }
    if (a === "borrar-local" && confirm(`¿Borrar “${l.nombre}”? No se puede deshacer.`)) {
      db.locales = db.locales.filter(x => x.id !== lid); delete db.seguimiento[lid]; guardar(); listaLocales();
    }
  }
});
$("vista").addEventListener("change", e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  if (b.dataset.a === "asignar") {
    const m = db.movimientos.find(x => x.id === b.dataset.id);
    m.vendedorId = b.value || null;
    m.comisionPct = m.vendedorId ? vendedor(m.vendedorId).comision : 0;
    m.comisionPagada = false;
    guardar(); pintar();
  }
  if (b.dataset.a === "pagada") { db.movimientos.find(x => x.id === b.dataset.id).comisionPagada = b.checked; guardar(); pintar(); }
  if (b.dataset.a === "estado-post") {
    const p = db.postulantes.find(x => x.id === b.closest("[data-id]").dataset.id);
    if (p) { p.estado = b.value; guardar(); pintar(); }
  }
  if (b.dataset.a === "estado") {
    const s = seg(b.closest(".local").dataset.id);
    s.estado = b.value;
    if (b.value === "Enviado" && !s.enviado) s.enviado = Date.now();
    guardar(); listaLocales();
  }
});
let esperaNota;
$("vista").addEventListener("input", e => {
  const bp = e.target.closest("[data-a='nota-post']");
  if (bp) {
    const p = db.postulantes.find(x => x.id === bp.closest("[data-id]").dataset.id);
    if (p) { p.nota = bp.value; clearTimeout(esperaNota); esperaNota = setTimeout(guardar, 700); }
    return;
  }
  const b = e.target.closest("[data-a='nota']"); if (!b) return;
  seg(b.closest(".local").dataset.id).nota = b.value;
  clearTimeout(esperaNota); esperaNota = setTimeout(guardar, 700);
});

/* ---------- Inicio de sesión ---------- */
function mostrarIngreso() {
  $("pantallaCarga").hidden = true; $("pantallaApp").hidden = true; $("pantallaIngreso").hidden = false;
}
$("fIngreso").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, b = f.querySelector("button[type=submit]"); b.disabled = true;
  $("errIngreso").hidden = true;
  try { await signInWithEmailAndPassword(auth, f.mail.value.trim(), f.clave.value); }
  catch (err) {
    $("errIngreso").textContent = /network/.test(err.code || "") ? "Sin conexión. Probá de nuevo." : "Mail o contraseña incorrectos.";
    $("errIngreso").hidden = false; b.disabled = false;
  }
});
$("olvide").addEventListener("click", async () => {
  const mail = $("fIngreso").mail.value.trim();
  if (!mail) { $("errIngreso").textContent = "Escribí tu mail arriba y tocá de nuevo “Olvidé mi contraseña”."; $("errIngreso").hidden = false; return; }
  try { await sendPasswordResetEmail(auth, mail); } catch (e) {}
  $("errIngreso").textContent = "Si ese mail tiene usuario, te llegó un correo para elegir una contraseña nueva.";
  $("errIngreso").hidden = false;
});
$("salir").addEventListener("click", () => { if (DEMO) location.href = location.pathname; else signOut(auth); });

function mostrarApp() {
  $("pantallaIngreso").hidden = true; $("pantallaCarga").hidden = true; $("pantallaApp").hidden = false;
  $("quien").textContent = rol === "dueno" ? "Dueño" : `${miVendedor().nombre} · vendedor`;
  $("herramientas").innerHTML = rol === "dueno"
    ? `<button class="btn sec chico" id="bCopia" type="button">Descargar copia</button><button class="btn sec chico" id="bImportar" type="button">Importar…</button>`
    : "";
  if (rol === "dueno") {
    $("bCopia").onclick = () => descargar(`carteg-copia-${hoy()}.json`, JSON.stringify({ movimientos: db.movimientos, vendedores: db.vendedores, seguimiento: db.seguimiento, localesExtra: db.locales.filter(l => l.manual), ultimoCodigo: db.config.ultimoCodigo }, null, 1), "application/json");
    $("bImportar").onclick = () => $("archivo").click();
  }
  const h = location.hash.slice(1);
  vista = navActual().some(([k]) => k === h) ? h : navActual()[0][0];
  pintar();
}

function limpiarSesion() {
  escuchas.forEach(f => { try { f(); } catch (e) {} });
  escuchas = []; db = vacio(); rol = null; perfil = null;
  for (const k of Object.keys(COLS)) espejo[k] = new Map();
  espejo.config = ""; espejo.ranking = "";
}

if (DEMO) {
  /* Datos de ejemplo para revisar las pantallas sin conectarse */
  usuario = { uid: "demo" };
  const p = datosPlanilla();
  db.vendedores = p.vendedores;
  db.movimientos = p.movimientos.concat([
    { id: "d1", tipo: "ingreso", categoria: "Venta", estado: "pendiente", fecha: hoy(), cliente: "Hero Gym", producto: "Pack de 3", concepto: "Hero Gym · Pack de 3", monto: 52000, vendedorId: "zoe", comisionPct: 10, comisionPagada: false, creadoPor: "demo", creadoEn: Date.now() },
    { id: "d2", tipo: "ingreso", categoria: "Venta", estado: "aprobada", fecha: hoy(), concepto: "Kinevo Gym · 1 display", monto: 23990, vendedorId: "zoe", comisionPct: 10, comisionPagada: false, creadoPor: "demo" },
  ]);
  if (DEMO === "vendedor") {
    rol = "vendedor"; perfil = { vendedorId: "zoe", nombre: "Zoe" };
    db.movimientos = db.movimientos.filter(m => m.vendedorId === "zoe");
    db.ranking = { mes: hoy().slice(0, 7), filas: [{ vendedorId: "zoe", nombre: "Zoe", ventas: 1, monto: 23990 }, { vendedorId: "x", nombre: "Otro vendedor", ventas: 0, monto: 0 }] };
  } else {
    rol = "dueno";
    db.usuarios = [{ id: "u1", rol: "vendedor", vendedorId: "zoe", nombre: "Zoe", email: "zoe@ejemplo.com", activo: true }];
    db.postulantes = [{ id: "p1", nombre: "Juan Ejemplo", whatsapp: "351 555-1234", zona: "Alta Córdoba", edad: "24", disponibilidad: "Medio tiempo", experiencia: "Vendí ropa por Instagram", mensaje: "", estado: "Nuevo", creado: Date.now() }];
  }
  mostrarApp();
} else {
  onAuthStateChanged(auth, async u => {
    limpiarSesion();
    usuario = u;
    if (!u) return mostrarIngreso();
    $("pantallaIngreso").hidden = true; $("pantallaCarga").hidden = false;
    $("pantallaCarga").innerHTML = `<p class="gris">Cargando…</p>`;
    if (u.uid === DUENO) { rol = "dueno"; escucharDueno(); return; }
    try {
      const s = await getDoc(doc(fs, "usuarios", u.uid));
      const d = s.exists() ? s.data() : null;
      if (d && d.rol === "vendedor" && d.activo !== false) { rol = "vendedor"; perfil = d; escucharVendedor(); return; }
    } catch (e) { console.error(e); }
    $("pantallaCarga").innerHTML = `<div class="ingreso-caja"><div class="panel"><h1>Sin acceso</h1><p class="gris">La cuenta ${esc(u.email)} no tiene acceso a Carteg Sistema, o fue desactivada.</p>
      <button class="btn sec" type="button" id="salir3">Salir</button></div></div>`;
    $("salir3").onclick = () => signOut(auth);
  });
}

let esperaResize;
window.addEventListener("resize", () => { clearTimeout(esperaResize); esperaResize = setTimeout(() => { if (vista === "metricas" && ultimoGrafico) pintarGrafico(...ultimoGrafico); }, 150); });
window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (rol && v !== vista && navActual().some(([k]) => k === v)) { vista = v; pintar(); }
});
