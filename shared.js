// Precios, productos y datos de cobro. Lo usan todas las páginas.

// Precios provisorios: confirmar contra los costos antes de publicar.
const PRICE_FIRST = 24000;
// Señuelo: 2 displays no tienen descuento y 3 llevan envío gratis. Mantener igual en Tiendanube.
const PRICES = { 1: PRICE_FIRST, 2: 48000, 3: 52000 };

// Cupo real del precio de lanzamiento. Restar en "left" cada display vendido.
// Con left en 0 se oculta el bloque y hay que subir los precios.
const STOCK = { total: 10, left: 10 };

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
    const leftEl = document.getElementById('stock-left');
    const fillEl = document.getElementById('stock-fill');
    if (STOCK.left === 0) {
        stockEl.hidden = true;
        return;
    }
    leftEl.textContent = STOCK.left === 1 ? 'Queda el último a este precio' : `Quedan los últimos ${STOCK.left} a este precio`;
    fillEl.style.width = `${(STOCK.left / STOCK.total) * 100}%`;
}
renderStock();

// Completa los precios marcados en la página según el producto.
document.querySelectorAll('[data-price-of]').forEach((el) => {
    const count = PRODUCTS[el.dataset.priceOf].models.length;
    const unitTotal = count * PRICE_FIRST;
    const total = priceFor(count);
    el.innerHTML = count === 3
        ? `<strong>${money(total)}</strong><span class="price-sep">Separados <s>${money(unitTotal)}</s></span><small>Mejor precio · Envío gratis</small>`
        : `<strong>${money(total)}</strong>`;
});

// Precio simple dentro de un texto, según la cantidad de displays.
document.querySelectorAll('[data-price-plain]').forEach((el) => {
    el.textContent = money(priceFor(Number(el.dataset.pricePlain)));
});

// Diferencia entre 2 y 3 displays, para ofrecer el pack.
document.querySelectorAll('[data-price-step]').forEach((el) => {
    el.textContent = money(priceFor(3) - priceFor(2));
});
