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

    function unitPrice(id, qty) {
        return priceFor(typeof VARIANTS[id] === 'object' ? qty : PRODUCTS[id].models.length);
    }

    const totalOf = (items) => items.reduce((sum, item) => sum + unitPrice(item.id, item.qty) * item.units, 0);

    function add(id, qty = 1) {
        const items = read();
        const found = items.find((item) => item.id === id && item.qty === qty);
        if (found) found.units += 1;
        else items.push({ id, qty, units: 1 });
        write(items);
        renderBadge();
        showToast(id, qty, totalOf(items));
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
        cartLink.addEventListener('click', (event) => {
            event.preventDefault();
            checkout();
        });
        badge = cartLink.querySelector('.cart-count');
        navButton.replaceWith(actions);
        actions.append(cartLink, navButton);
    }

    function renderBadge() {
        if (!badge) return;
        const count = read().reduce((sum, item) => sum + item.units, 0);
        badge.textContent = count;
        badge.hidden = count === 0;
    }

    // Aviso de producto agregado
    const toast = document.createElement('div');
    toast.className = 'cart-toast';
    toast.setAttribute('role', 'status');
    toast.hidden = true;
    toast.innerHTML = `
        <button type="button" class="cart-toast-close" aria-label="Cerrar aviso">&times;</button>
        <strong class="cart-toast-title"></strong>
        <span class="cart-toast-note"></span>
        <button type="button" class="btn btn-wide cart-toast-pay">Ver carrito y pagar</button>`;
    document.body.append(toast);
    toast.querySelector('.cart-toast-pay').addEventListener('click', checkout);
    toast.querySelector('.cart-toast-close').addEventListener('click', () => {
        toast.hidden = true;
    });

    function shippingNote(total) {
        if (total > FREE_SHIPPING_OVER) return 'Tenés envío gratis';
        if (total === PRICES[2]) return `Por ${money(PRICES[3] - PRICES[2])} más, el pack de 3 tiene envío gratis`;
        return `Te faltan ${money(FREE_SHIPPING_OVER - total)} para el envío gratis`;
    }

    let hideTimer;
    function showToast(id, qty, total) {
        const name = PRODUCTS[id].name;
        const label = typeof VARIANTS[id] === 'object' && qty > 1 ? `${qty} displays de ${name}` : name;
        toast.querySelector('.cart-toast-title').textContent = `${label}: agregado al carrito`;
        toast.querySelector('.cart-toast-note').textContent = shippingNote(total);
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

    renderBadge();
    return { add };
})();
