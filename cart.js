// Compra: la web guarda lo elegido y, al pagar, lo carga en el carrito de Tiendanube.
const Cart = (() => {
    const CART_URL = `${STORE_URL}/comprar/`;
    const STORAGE_KEY = 'carteg_cart';
    let memory = [];

    function read() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        } catch {
            return memory;
        }
    }

    function write(items) {
        memory = items;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        } catch {
            // Sin almacenamiento, la lista vive mientras la página siga abierta.
        }
    }

    // Los displays tienen una variante por cantidad; los combos, una sola.
    function variantFor(id, qty) {
        const variant = VARIANTS[id];
        return typeof variant === 'object' ? variant[qty] : variant;
    }

    const isDisplay = (id) => typeof VARIANTS[id] === 'object';
    const MAX_PER_LINE = 30;

    // Una línea por producto: cantidad de displays sueltos, o de combos.
    function linesOf(items) {
        const lines = [];
        items.forEach((item) => {
            if (!PRODUCTS[item.id]) return;
            const amount = isDisplay(item.id) ? item.qty * item.units : item.units;
            const found = lines.find((line) => line.id === item.id);
            if (found) found.count += amount;
            else lines.push({ id: item.id, count: amount });
        });
        return lines;
    }

    // Los displays de un mismo modelo se arman en packs de 3, que es el mejor precio.
    function itemsOf(lines) {
        const items = [];
        lines.forEach(({ id, count }) => {
            if (count <= 0) return;
            if (!isDisplay(id)) {
                items.push({ id, qty: 1, units: count });
                return;
            }
            const packs = Math.floor(count / 3);
            const rest = count % 3;
            if (packs) items.push({ id, qty: 3, units: packs });
            if (rest) items.push({ id, qty: rest, units: 1 });
        });
        return items;
    }

    function lineTotal({ id, count }) {
        if (!isDisplay(id)) return priceFor(PRODUCTS[id].models.length) * count;
        const rest = count % 3;
        return Math.floor(count / 3) * PRICES[3] + (rest ? PRICES[rest] : 0);
    }

    const totalOf = (items) => linesOf(items).reduce((sum, line) => sum + lineTotal(line), 0);

    function setLines(lines) {
        write(itemsOf(lines));
        renderBadge();
        renderDrawer();
    }

    function add(id, qty = 1) {
        const lines = linesOf(read());
        const amount = isDisplay(id) ? qty : 1;
        const found = lines.find((line) => line.id === id);
        if (found) found.count = Math.min(found.count + amount, MAX_PER_LINE);
        else lines.push({ id, count: amount });
        setLines(lines);
        showToast(id, qty, totalOf(read()));
    }

    // Va a Tiendanube. La tienda carga el resto de los productos que viajan en #cg.
    function checkout() {
        const parts = read().map((item) => `${variantFor(item.id, item.qty)}-${item.units}`);
        write([]);
        if (!parts.length) {
            location.href = CART_URL;
            return;
        }
        const rest = parts.slice(1).join(',');
        location.href = `${STORE_URL}/cart-link/${parts[0]}${rest ? `#cg=${rest}` : ''}`;
    }

    // Botón del carrito en la barra superior
    let badge = null;
    const nav = document.querySelector('.nav');
    const navButton = nav && nav.querySelector('.btn-small');
    if (navButton) {
        const actions = document.createElement('div');
        actions.className = 'nav-actions';
        const cartLink = document.createElement('a');
        cartLink.className = 'cart-toggle';
        cartLink.href = CART_URL;
        cartLink.setAttribute('aria-label', 'Ver carrito');
        cartLink.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 4h2.2l2.2 11h10.4l2-8H6.2M9.5 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="cart-count" hidden></span>';
        cartLink.setAttribute('aria-haspopup', 'dialog');
        cartLink.addEventListener('click', (event) => {
            event.preventDefault();
            openDrawer();
        });
        badge = cartLink.querySelector('.cart-count');
        const instagram = document.createElement('a');
        instagram.className = 'cart-toggle nav-ig';
        instagram.href = 'https://www.instagram.com/carteg.nfc/';
        instagram.target = '_blank';
        instagram.rel = 'noopener';
        instagram.setAttribute('aria-label', 'Seguinos en Instagram');
        instagram.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>';
        navButton.replaceWith(actions);
        actions.append(instagram, cartLink, navButton);
    }

    function renderBadge() {
        if (!badge) return;
        const count = linesOf(read()).reduce((sum, line) => sum + line.count, 0);
        badge.textContent = count;
        badge.hidden = count === 0;
    }

    // Panel lateral del carrito
    const drawer = document.createElement('div');
    drawer.className = 'cart-drawer';
    drawer.hidden = true;
    drawer.innerHTML = `
        <div class="cart-backdrop" data-close></div>
        <aside class="cart-panel" role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <header class="cart-head">
                <h2 id="cart-title">Tu carrito</h2>
                <button type="button" class="cart-close" data-close aria-label="Cerrar carrito">&times;</button>
            </header>
            <ul class="cart-lines"></ul>
            <div class="cart-empty">
                <p>Tu carrito está vacío.</p>
                <a class="btn" href="catalogo.html">Ver productos</a>
            </div>
            <footer class="cart-foot">
                <span class="cart-ship-note"></span>
                <span class="ship-bar" aria-hidden="true"><i></i></span>
                <div class="cart-total"><span>Total</span><strong></strong></div>
                <small class="cart-foot-note">El envío se calcula en el próximo paso, con tu código postal.</small>
                <button type="button" class="btn btn-wide cart-pay">Finalizar y pagar</button>
            </footer>
        </aside>`;
    document.body.append(drawer);
    const linesEl = drawer.querySelector('.cart-lines');
    let lastFocus = null;

    function lineDetail({ id, count }) {
        if (!isDisplay(id)) return PRODUCTS[id].detail || 'Combo de displays';
        const packs = Math.floor(count / 3);
        const label = `${count} ${count === 1 ? 'display' : 'displays'}`;
        return packs ? `${label} · precio de pack aplicado` : label;
    }

    function renderDrawer() {
        const lines = linesOf(read());
        const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
        drawer.classList.toggle('is-empty', lines.length === 0);
        linesEl.innerHTML = lines.map((line) => {
            const product = PRODUCTS[line.id];
            const thumbs = product.models.map((model) => `<img src="assets/${model}.jpg?v=3" alt="" width="64" height="80" loading="lazy">`).join('');
            return `
                <li class="cart-line" data-id="${line.id}">
                    <span class="cart-thumb${product.models.length > 1 ? ' is-combo' : ''}">${thumbs}</span>
                    <span class="cart-line-info">
                        <strong>${product.name}</strong>
                        <small>${lineDetail(line)}</small>
                        <span class="cart-qty">
                            <button type="button" data-step="-1" aria-label="Quitar uno de ${product.name}">−</button>
                            <output aria-live="polite">${line.count}</output>
                            <button type="button" data-step="1" aria-label="Sumar uno de ${product.name}"${line.count >= MAX_PER_LINE ? ' disabled' : ''}>+</button>
                        </span>
                    </span>
                    <span class="cart-line-side">
                        <strong>${money(lineTotal(line))}</strong>
                        <button type="button" class="cart-remove" data-remove>Quitar</button>
                    </span>
                </li>`;
        }).join('');
        drawer.querySelector('.cart-total strong').textContent = money(total);
        drawer.querySelector('.cart-ship-note').textContent = total ? shippingNote(total) : '';
        drawer.querySelector('.ship-bar i').style.width = `${Math.min(total / FREE_SHIPPING_OVER, 1) * 100}%`;
        drawer.querySelector('.cart-pay').disabled = lines.length === 0;
    }

    function openDrawer() {
        toast.hidden = true;
        renderDrawer();
        lastFocus = document.activeElement;
        drawer.hidden = false;
        document.documentElement.classList.add('cart-open');
        drawer.querySelector('.cart-close').focus();
    }

    function closeDrawer() {
        drawer.hidden = true;
        document.documentElement.classList.remove('cart-open');
        if (lastFocus) lastFocus.focus();
    }

    drawer.addEventListener('click', (event) => {
        if (event.target.closest('[data-close]')) {
            closeDrawer();
            return;
        }
        const row = event.target.closest('.cart-line');
        if (!row) return;
        const lines = linesOf(read());
        const line = lines.find((item) => item.id === row.dataset.id);
        if (!line) return;
        const step = event.target.closest('[data-step]');
        if (step) line.count = Math.min(line.count + Number(step.dataset.step), MAX_PER_LINE);
        else if (event.target.closest('[data-remove]')) line.count = 0;
        else return;
        setLines(lines);
        const again = linesEl.querySelector(`[data-id="${row.dataset.id}"] [data-step="${step ? step.dataset.step : ''}"]`);
        (again || drawer.querySelector('.cart-close')).focus();
    });
    drawer.querySelector('.cart-pay').addEventListener('click', checkout);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !drawer.hidden) closeDrawer();
    });

    // Aviso de producto agregado
    const toast = document.createElement('div');
    toast.className = 'cart-toast';
    toast.setAttribute('role', 'status');
    toast.hidden = true;
    toast.innerHTML = `
        <button type="button" class="cart-toast-close" aria-label="Cerrar aviso">&times;</button>
        <strong class="cart-toast-title"></strong>
        <span class="cart-toast-note"></span>
        <span class="ship-bar" aria-hidden="true"><i></i></span>
        <button type="button" class="btn btn-wide cart-toast-pay">Ver carrito</button>`;
    document.body.append(toast);
    toast.querySelector('.cart-toast-pay').addEventListener('click', openDrawer);
    toast.querySelector('.cart-toast-close').addEventListener('click', () => {
        toast.hidden = true;
    });

    function shippingNote(total) {
        if (total > FREE_SHIPPING_OVER) return '🚚 ¡Desbloqueaste el ENVÍO GRATIS!';
        if (total === PRICES[2]) return `🚚 Por ${money(PRICES[3] - PRICES[2])} más llevás el pack de 3 con ENVÍO GRATIS`;
        return `🚚 ¡Agregá ${money(FREE_SHIPPING_OVER - total)} más para desbloquear ENVÍO GRATIS!`;
    }

    let hideTimer;
    function showToast(id, qty, total) {
        const name = PRODUCTS[id].name;
        const label = typeof VARIANTS[id] === 'object' && qty > 1 ? `${qty} displays de ${name}` : name;
        toast.querySelector('.cart-toast-title').textContent = `${label}: agregado al carrito`;
        toast.querySelector('.cart-toast-note').textContent = shippingNote(total);
        toast.querySelector('.ship-bar i').style.width = `${Math.min(total / FREE_SHIPPING_OVER, 1) * 100}%`;
        toast.hidden = false;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            toast.hidden = true;
        }, 9000);
    }

    // Cualquier botón con data-add agrega ese producto.
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-add]');
        if (button) add(button.dataset.add);
    });

    // Botón flotante de WhatsApp
    const whatsapp = document.createElement('a');
    whatsapp.className = 'wa-float';
    whatsapp.href = 'https://wa.me/5493516967688?text=Hola%20Carteg!%20Tengo%20una%20consulta.';
    whatsapp.target = '_blank';
    whatsapp.rel = 'noopener';
    whatsapp.setAttribute('aria-label', 'Escribinos por WhatsApp');
    whatsapp.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.42-.08-.12-.27-.2-.57-.35zM12.05 21.8h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.89 9.9-9.89 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 7c0 5.45-4.44 9.88-9.89 9.88zM20.46 3.49A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.05 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.42z"/></svg>';
    document.body.append(whatsapp);

    renderBadge();
    return { add };
})();
