// Página de producto: cantidad, precio, galería y botón fijo.
const model = document.documentElement.dataset.model;
const OPTIONS = [1, 2, 3];
let quantity = 1;

const optionsEl = document.getElementById('qty-options');
const priceEl = document.getElementById('product-price');
const oldEl = document.getElementById('product-old');
const addButton = document.getElementById('add-to-cart');
const buyBar = document.getElementById('buy-bar');
const buyBarButton = document.getElementById('buy-bar-button');

OPTIONS.forEach((count) => {
    const unitTotal = count * PRICE_FIRST;
    const total = priceFor(count);
    const label = document.createElement('label');
    label.className = 'qty-option';
    label.innerHTML = `
        <input type="radio" name="cantidad" value="${count}"${count === quantity ? ' checked' : ''}>
        <span class="qty-radio" aria-hidden="true"></span>
        <span class="qty-name">${count} ${count === 1 ? 'display' : 'displays'}</span>
        <span class="qty-price">
            <strong>${money(total)}</strong>
            ${count === 3 ? `<span class="price-sep">Separados <s>${money(unitTotal)}</s></span><small>Mejor precio · Envío gratis</small>` : ''}
            ${count === 1 ? `<span class="price-sep">Antes <s>${money(PRICE_BEFORE)}</s></span>` : ''}
        </span>`;
    optionsEl.append(label);
});

function renderProduct() {
    const total = priceFor(quantity);
    priceEl.textContent = money(total);
    oldEl.hidden = quantity === 2;
    oldEl.innerHTML = quantity === 1
        ? `Antes <s>${money(PRICE_BEFORE)}</s>`
        : `Separados <s>${money(quantity * PRICE_FIRST)}</s>`;
    buyBarButton.textContent = `${money(total)} · Agregar al carrito`;
}

optionsEl.addEventListener('change', (event) => {
    quantity = Number(event.target.value);
    renderProduct();
});

const addToCart = () => Cart.add(model, quantity);
addButton.addEventListener('click', addToCart);
buyBarButton.addEventListener('click', addToCart);

// Botón fijo: se oculta cuando el botón principal ya está a la vista.
new IntersectionObserver((entries) => {
    buyBar.hidden = entries[0].isIntersecting;
}).observe(addButton);

// Galería
const mainImage = document.getElementById('gallery-main');
const caption = document.getElementById('gallery-caption');
document.querySelectorAll('.gallery-thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => {
        mainImage.src = thumb.dataset.src;
        mainImage.alt = thumb.dataset.alt;
        caption.textContent = thumb.dataset.caption;
        document.querySelectorAll('.gallery-thumb').forEach((other) => {
            other.setAttribute('aria-pressed', other === thumb ? 'true' : 'false');
        });
    });
});

renderProduct();
