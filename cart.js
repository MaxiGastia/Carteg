// Compra: cada botón agrega el producto al carrito de Tiendanube y lleva a la tienda.
const Cart = (() => {
    const CART_URL = `${STORE_URL}/comprar/`;

    function add(id, qty = 1) {
        const variant = VARIANTS[id];
        // Los displays tienen una variante por cantidad; los combos, una sola.
        const variantId = typeof variant === 'object' ? variant[qty] : variant;
        const units = typeof variant === 'object' ? 1 : qty;
        location.href = `${STORE_URL}/cart-link/${variantId}-${units}`;
    }

    // Botón del carrito en la barra superior
    const nav = document.querySelector('.nav');
    const navButton = nav && nav.querySelector('.btn-small');
    if (navButton) {
        const actions = document.createElement('div');
        actions.className = 'nav-actions';
        const cartLink = document.createElement('a');
        cartLink.className = 'cart-toggle';
        cartLink.href = CART_URL;
        cartLink.setAttribute('aria-label', 'Ver carrito');
        cartLink.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 4h2.2l2.2 11h10.4l2-8H6.2M9.5 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        navButton.replaceWith(actions);
        actions.append(cartLink, navButton);
    }

    // Cualquier botón con data-add agrega ese producto.
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-add]');
        if (button) add(button.dataset.add);
    });

    return { add };
})();
