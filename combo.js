// Página de combo: el botón fijo se oculta cuando el principal está a la vista.
const buyBar = document.getElementById('buy-bar');
new IntersectionObserver((entries) => {
    buyBar.hidden = entries[0].isIntersecting;
}).observe(document.getElementById('add-to-cart'));
