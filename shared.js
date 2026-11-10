// Precios, productos y datos de cobro. Lo usan todas las páginas.

// Precios provisorios: confirmar contra los costos antes de publicar.
const PRICE_FIRST = 23990;
// Precio al que se vendía cada display antes del lanzamiento (dato del dueño). Se muestra tachado.
const PRICE_BEFORE = 35500;
// Señuelo: 2 displays no tienen descuento y 3 llevan envío gratis. Mantener igual en Tiendanube.
const PRICES = { 1: PRICE_FIRST, 2: PRICE_FIRST * 2, 3: 52000 };
const FREE_SHIPPING_OVER = 50000; // Mantener igual que la regla de Tiendanube.

// Cupo real del precio de lanzamiento. Restar en "left" cada display vendido.
// Con left en 0 se oculta el bloque y hay que subir los precios.
const STOCK = { total: 50, left: 3 };
const LOW_STOCK = 5; // Desde cuántas quedan se muestra el aviso de últimas unidades.

// Fin REAL de la oferta de lanzamiento, por ejemplo '2026-11-30T23:59:00-03:00'.
// Con null no se muestra la cuenta regresiva. Cuando termina, hay que subir los precios de verdad.
const OFFER_ENDS = null;

// Tienda y variantes de Tiendanube para armar los links al carrito.
const STORE_URL = 'https://carteg.mitiendanube.com';
const VARIANTS = {
    google: { 1: 1632243034, 2: 1632243035, 3: 1632243036 },
    instagram: { 1: 1632243739, 2: 1632243740, 3: 1632243741 },
    whatsapp: { 1: 1632244077, 2: 1632244078, 3: 1632244079 },
    completo: 1632241834,
    'resenas-whatsapp': 1632241983,
    'resenas-instagram': 1632242503,
    'instagram-whatsapp': 1632242560,
};

const MODELS = ['google', 'instagram', 'whatsapp'];

const PRODUCTS = {
    google: { name: 'Reseñas de Google', models: ['google'] },
    instagram: { name: 'Instagram', models: ['instagram'] },
    whatsapp: { name: 'WhatsApp', models: ['whatsapp'] },
    completo: { name: 'Pack Completo', detail: 'Reseñas, Instagram y WhatsApp', models: ['google', 'instagram', 'whatsapp'] },
    'resenas-whatsapp': { name: 'Reseñas + WhatsApp', models: ['google', 'whatsapp'] },
    'resenas-instagram': { name: 'Reseñas + Instagram', models: ['google', 'instagram'] },
    'instagram-whatsapp': { name: 'Instagram + WhatsApp', models: ['instagram', 'whatsapp'] },
};

const money = (n) => '$' + n.toLocaleString('es-AR');

function priceFor(count) {
    return PRICES[count];
}

function renderStock() {
    const stockEl = document.getElementById('stock');
    if (!stockEl) return;
    if (STOCK.left <= 0) {
        stockEl.hidden = true;
        return;
    }
    stockEl.classList.add('is-active');
    const leftEl = document.getElementById('stock-left');
    const fillEl = document.getElementById('stock-fill');
    leftEl.textContent = STOCK.left === 1
        ? `🔥 Queda solo 1 de ${STOCK.total} unidades a precio de lanzamiento`
        : `🔥 Quedan solo ${STOCK.left} de ${STOCK.total} unidades a precio de lanzamiento`;
    // La barra muestra cuánto del cupo ya se vendió.
    const sold = (STOCK.total - STOCK.left) / STOCK.total;
    fillEl.style.width = `${Math.max(sold * 100, 4)}%`;
    renderCountdown(stockEl);
}

function renderCountdown(stockEl) {
    const end = OFFER_ENDS ? new Date(OFFER_ENDS).getTime() : NaN;
    if (!end || end <= Date.now()) return;
    const timer = document.createElement('p');
    timer.className = 'stock-timer';
    stockEl.append(timer);
    const pad = (n) => String(n).padStart(2, '0');
    let interval;
    const tick = () => {
        const ms = end - Date.now();
        if (ms <= 0) {
            timer.remove();
            clearInterval(interval);
            return;
        }
        const sec = Math.floor(ms / 1000);
        const days = Math.floor(sec / 86400);
        const time = `${pad(Math.floor(sec / 3600) % 24)}h : ${pad(Math.floor(sec / 60) % 60)}m : ${pad(sec % 60)}s`;
        timer.textContent = `⏳ La oferta termina en ${days ? `${days}d ` : ''}${time}`;
    };
    interval = setInterval(tick, 1000);
    tick();
}
renderStock();

// Etiquetas sobre las fotos: descuento real del pack y últimas unidades cuando quedan pocas.
document.querySelectorAll('[data-badge]').forEach((el) => {
    const badges = [];
    if (el.dataset.badge === 'pack') {
        const off = Math.round((1 - PRICES[3] / (3 * PRICE_FIRST)) * 100);
        badges.push(['is-deal', `-${off}% vs. separados`]);
    }
    if (STOCK.left > 0 && STOCK.left <= LOW_STOCK) badges.push(['is-low', 'Últimas unidades']);
    if (!badges.length) return;
    const wrap = document.createElement('span');
    wrap.className = 'promo-badges';
    wrap.innerHTML = badges.map(([cls, text]) => `<span class="promo-badge ${cls}">${text}</span>`).join('');
    el.append(wrap);
});

// Completa los precios marcados en la página según el producto.
document.querySelectorAll('[data-price-of]').forEach((el) => {
    const count = PRODUCTS[el.dataset.priceOf].models.length;
    const unitTotal = count * PRICE_FIRST;
    const total = priceFor(count);
    if (count === 3) {
        el.innerHTML = `<strong>${money(total)}</strong><span class="price-sep">Separados <s>${money(unitTotal)}</s></span><small>Mejor precio · Envío gratis</small>`;
    } else if (count === 1) {
        el.innerHTML = `<strong>${money(total)}</strong><span class="price-sep">Antes <s>${money(PRICE_BEFORE)}</s></span><small>Ahorrás ${money(PRICE_BEFORE - total)}</small>`;
    } else {
        el.innerHTML = `<strong>${money(total)}</strong>`;
    }
});

// Precio simple dentro de un texto, según la cantidad de displays.
document.querySelectorAll('[data-price-plain]').forEach((el) => {
    el.textContent = money(priceFor(Number(el.dataset.pricePlain)));
});

// Diferencia entre 2 y 3 displays, para ofrecer el pack.
document.querySelectorAll('[data-price-step]').forEach((el) => {
    el.textContent = money(priceFor(3) - priceFor(2));
});
