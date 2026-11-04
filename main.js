// Contenido, scroll y configurador de pack. Funciona aunque falle la escena 3D.

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

// Estado compartido con scene.js
const Carteg = { mode: 'hero', modelIndex: 0, heroIndex: 0, howProgress: 0, heroProgress: 0, sceneVisible: true, reducedMotion };
window.Carteg = Carteg;

// --- Scroll ---
const howSection = document.getElementById('como-funciona');
const modelsSection = document.getElementById('modelos');
const howPanels = [...document.querySelectorAll('[data-panels="how"] .panel')];
const modelPanels = [...document.querySelectorAll('[data-panels="models"] .panel')];
const dots = [...document.querySelectorAll('.dots i')];
const solid = document.querySelector('.solid');
const howHint = document.querySelector('[data-hint="how"]');
const modelsHint = document.querySelector('[data-hint="models"]');

function sectionProgress(section) {
    const rect = section.getBoundingClientRect();
    return clamp(-rect.top / (rect.height - innerHeight));
}

function setActive(list, index) {
    list.forEach((el, i) => el.classList.toggle('is-active', i === index));
}

function updateScroll() {
    const vh = innerHeight;
    const howTop = howSection.getBoundingClientRect().top;
    const modelsTop = modelsSection.getBoundingClientRect().top;
    const howP = sectionProgress(howSection);
    const modelsP = sectionProgress(modelsSection);

    Carteg.heroProgress = clamp(-document.getElementById('top').getBoundingClientRect().top / vh);
    Carteg.howProgress = howP;
    Carteg.sceneVisible = solid.getBoundingClientRect().top > 0;

    if (modelsTop < vh * 0.5) {
        Carteg.mode = 'models';
        Carteg.modelIndex = Math.min(2, Math.floor(modelsP * 3));
    } else if (howTop < vh * 0.5) {
        Carteg.mode = 'how';
        Carteg.modelIndex = 0;
    } else {
        Carteg.mode = 'hero';
        Carteg.modelIndex = Carteg.heroIndex;
    }

    const howStep = howP < 0.34 ? 0 : howP < 0.64 ? 1 : 2;
    setActive(howPanels, howStep);
    howHint.classList.toggle('is-hidden', howStep === 2);
    const modelStep = Math.min(2, Math.floor(modelsP * 3));
    setActive(modelPanels, modelStep);
    setActive(dots, modelStep);
    modelsHint.classList.toggle('is-hidden', modelStep === 2);

    document.documentElement.dataset.model = MODELS[Carteg.modelIndex];
}

let scrollQueued = false;
function queueScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; updateScroll(); });
}
addEventListener('scroll', queueScroll, { passive: true });
addEventListener('resize', queueScroll);
updateScroll();

// --- Frase que cambia en la portada ---
const rotatorItems = [...document.querySelectorAll('.rotator em')];
if (!reducedMotion) {
    setInterval(() => {
        if (Carteg.mode !== 'hero' || document.hidden) return;
        Carteg.heroIndex = (Carteg.heroIndex + 1) % rotatorItems.length;
        setActive(rotatorItems, Carteg.heroIndex);
        updateScroll();
    }, 3200);
}

// --- Aparición de bloques ---
if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
} else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
}
