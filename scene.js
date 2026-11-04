// Escena 3D: display flotante, celular que se acerca, ondas NFC y luz de fondo.
(function () {
    const canvas = document.getElementById('scene');
    const Carteg = window.Carteg;

    function disable3D() {
        document.documentElement.classList.add('no3d');
    }

    if (!window.THREE) { disable3D(); return; }

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (error) {
        disable3D();
        return;
    }

    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x0a0c08, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.z = 9;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x30342a, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(-2, 3, 6);
    scene.add(key);
    const rim = new THREE.PointLight(0xc9f73a, 1.4, 12);
    rim.position.set(3, 2, -2);
    scene.add(rim);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    // --- Colores por modelo ---
    const ACCENTS = [new THREE.Color(0xc9f73a), new THREE.Color(0xff4fb0), new THREE.Color(0x38e887)];
    const accent = ACCENTS[0].clone();

    // --- Luz de fondo ---
    const backgroundMaterial = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
            time: { value: 0 },
            color: { value: accent },
            aspect: { value: 1 },
            focusX: { value: 0.3 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = position.xy;
                gl_Position = vec4(position.xy, 1.0, 1.0);
            }`,
        fragmentShader: `
            precision mediump float;
            varying vec2 vUv;
            uniform float time;
            uniform float aspect;
            uniform float focusX;
            uniform vec3 color;
            void main() {
                vec2 p = vec2(vUv.x * aspect - focusX * aspect, vUv.y);
                float light = 0.0;
                for (int i = 0; i < 4; i++) {
                    float fi = float(i);
                    float y = p.y + 0.2 * sin(p.x * 1.6 + time * 0.22 + fi * 1.9)
                                  + 0.07 * sin(p.x * 4.0 - time * 0.3 + fi * 2.7)
                                  + (fi - 1.5) * 0.11;
                    float fade = exp(-p.x * p.x * 0.55);
                    light += fade * (0.0075 / (abs(y) + 0.012) + 0.1 * exp(-abs(y) * 5.0));
                }
                float halo = exp(-dot(p, p) * 1.5) * 0.2;
                vec3 base = vec3(0.039, 0.047, 0.031);
                gl_FragColor = vec4(base + color * (light * 0.5 + halo), 1.0);
            }`,
    });
    const background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backgroundMaterial);
    background.frustumCulled = false;
    background.renderOrder = -10;
    scene.add(background);

    // --- Geometría del display ---
    function displayOutline() {
        const s = new THREE.Shape();
        s.moveTo(-0.7, -1.35);
        s.quadraticCurveTo(-1, -1.1, -1, -0.4);
        s.lineTo(-1, 1.03);
        s.quadraticCurveTo(-1, 1.35, -0.68, 1.35);
        s.lineTo(0.68, 1.35);
        s.quadraticCurveTo(1, 1.35, 1, 1.03);
        s.lineTo(1, -0.4);
        s.quadraticCurveTo(1, -1.1, 0.7, -1.35);
        s.closePath();
        return s;
    }

    function roundedRect(w, h, r) {
        const s = new THREE.Shape();
        const x = -w / 2;
        const y = -h / 2;
        s.moveTo(x + r, y);
        s.lineTo(x + w - r, y);
        s.quadraticCurveTo(x + w, y, x + w, y + r);
        s.lineTo(x + w, y + h - r);
        s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        s.lineTo(x + r, y + h);
        s.quadraticCurveTo(x, y + h, x, y + h - r);
        s.lineTo(x, y + r);
        s.quadraticCurveTo(x, y, x + r, y);
        return s;
    }

    function planarUv(geometry, minX, minY, width, height) {
        const position = geometry.attributes.position;
        const uv = geometry.attributes.uv;
        for (let i = 0; i < position.count; i++) {
            uv.setXY(i, (position.getX(i) - minX) / width, (position.getY(i) - minY) / height);
        }
        uv.needsUpdate = true;
    }

    const BODY_DEPTH = 0.12;
    const bodyGeometry = new THREE.ExtrudeGeometry(displayOutline(), {
        depth: BODY_DEPTH, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 24,
    });
    bodyGeometry.translate(0, 0, -BODY_DEPTH / 2);

    const faceGeometry = new THREE.ShapeGeometry(displayOutline(), 24);
    planarUv(faceGeometry, -1, -1.35, 2, 2.7);

    const baseGeometry = new THREE.ExtrudeGeometry(roundedRect(1.9, 0.95, 0.1), {
        depth: 0.17, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 10,
    });
    baseGeometry.rotateX(-Math.PI / 2);
    baseGeometry.translate(0, -1.5, 0);

    // --- Dibujo de cada cara ---
    const WHATSAPP_ICON = 'M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c-.003 1.396.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z';

    function drawLines(ctx, lines, color, weight, size, startY, gap) {
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
        lines.forEach((line, i) => ctx.fillText(line, 512, startY + i * gap));
    }

    function drawGoogleG(ctx, cx, cy, r) {
        const width = r * 0.42;
        ctx.lineWidth = width;
        ctx.lineCap = 'butt';
        const arc = (color, from, to) => {
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, r, from, to);
            ctx.stroke();
        };
        arc('#ea4335', -Math.PI * 0.82, -Math.PI * 0.22);
        arc('#fbbc05', Math.PI * 0.8, -Math.PI * 0.82 + Math.PI * 2);
        arc('#34a853', Math.PI * 0.22, Math.PI * 0.8);
        arc('#4285f4', 0, Math.PI * 0.22);
        ctx.fillStyle = '#4285f4';
        ctx.fillRect(cx - r * 0.02, cy - width / 2, r + width / 2 + r * 0.02, width * 0.9);
    }

    function drawNfc(ctx, cx, cy, r) {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 12;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        [0.72, 0.5, 0.28].forEach((f) => {
            ctx.beginPath();
            ctx.arc(cx, cy - r * 0.02, r * f, -Math.PI * 0.76, -Math.PI * 0.24);
            ctx.stroke();
        });
        ctx.fillStyle = '#111';
        ctx.font = `900 ${r * 0.48}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NFC', cx, cy + r * 0.42);
    }

    function drawInstagram(ctx, cx, cy, size) {
        const half = size / 2;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = size * 0.075;
        ctx.beginPath();
        const r = size * 0.27;
        ctx.moveTo(cx - half + r, cy - half);
        ctx.arcTo(cx + half, cy - half, cx + half, cy + half, r);
        ctx.arcTo(cx + half, cy + half, cx - half, cy + half, r);
        ctx.arcTo(cx - half, cy + half, cx - half, cy - half, r);
        ctx.arcTo(cx - half, cy - half, cx + half, cy - half, r);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.23, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx + size * 0.27, cy - size * 0.27, size * 0.055, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawWhatsApp(ctx, cx, cy, size) {
        ctx.save();
        ctx.translate(cx - size / 2, cy - size / 2);
        ctx.scale(size / 16, size / 16);
        ctx.fillStyle = '#fff';
        ctx.fill(new Path2D(WHATSAPP_ICON));
        ctx.restore();
    }

    const FACES = [
        { body: 0xf2f3ef, draw(ctx) {
            ctx.fillStyle = '#f7f8f4';
            ctx.fillRect(0, 0, 1024, 1382);
            drawLines(ctx, ['Opina sobre', 'nosotros en', 'Google'], '#111', 500, 116, 160, 136);
            drawGoogleG(ctx, 512, 615, 66);
            drawNfc(ctx, 512, 985, 200);
        } },
        { body: 0xe8097f, draw(ctx) {
            ctx.fillStyle = '#ec0a82';
            ctx.fillRect(0, 0, 1024, 1382);
            drawLines(ctx, ['Seguinos', 'en', 'Instagram'], '#fff', 700, 142, 180, 164);
            drawInstagram(ctx, 512, 875, 340);
        } },
        { body: 0x0c7a4e, draw(ctx) {
            ctx.fillStyle = '#0d8052';
            ctx.fillRect(0, 0, 1024, 1382);
            drawLines(ctx, ['Escribinos', 'al', 'WhatsApp'], '#fff', 700, 136, 180, 164);
            drawWhatsApp(ctx, 512, 875, 370);
        } },
    ];

    function canvasTexture(width, height, draw) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        draw(c.getContext('2d'));
        const texture = new THREE.CanvasTexture(c);
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = maxAnisotropy;
        return texture;
    }

    const displays = FACES.map((face, i) => {
        const group = new THREE.Group();
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: face.body, roughness: 0.8, metalness: 0 });
        group.add(new THREE.Mesh(bodyGeometry, bodyMaterial));
        group.add(new THREE.Mesh(baseGeometry, bodyMaterial));
        const faceMesh = new THREE.Mesh(faceGeometry, new THREE.MeshStandardMaterial({
            map: canvasTexture(1024, 1382, face.draw), roughness: 0.85,
        }));
        faceMesh.position.z = BODY_DEPTH / 2 + 0.017;
        group.add(faceMesh);
        group.userData = { reveal: i === 0 ? 1 : 0 };
        scene.add(group);
        return group;
    });

    // --- Celular ---
    function drawPhoneScreen(ctx) {
        const w = 540;
        const h = 1140;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1b1b1b';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '600 46px Arial, Helvetica, sans-serif';
        ctx.fillText('Tu local', 44, 150);
        ctx.font = '400 28px Arial, Helvetica, sans-serif';
        ctx.fillStyle = '#6a6f66';
        ctx.fillText('Contá cómo fue tu experiencia', 44, 205);
        ctx.fillStyle = '#e9ebe4';
        ctx.fillRect(44, 250, w - 88, 2);

        ctx.textAlign = 'center';
        ctx.font = '500 34px Arial, Helvetica, sans-serif';
        ctx.fillStyle = '#1b1b1b';
        ctx.fillText('¿Cómo la calificarías?', w / 2, 340);
        for (let i = 0; i < 5; i++) {
            const cx = 110 + i * 80;
            const cy = 430;
            ctx.beginPath();
            for (let p = 0; p < 10; p++) {
                const radius = p % 2 === 0 ? 34 : 15;
                const angle = -Math.PI / 2 + p * Math.PI / 5;
                ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
            }
            ctx.closePath();
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#8f948a';
            ctx.stroke();
        }
        ctx.strokeStyle = '#c9cdc3';
        ctx.lineWidth = 3;
        ctx.strokeRect(44, 520, w - 88, 290);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#8f948a';
        ctx.font = '400 28px Arial, Helvetica, sans-serif';
        ctx.fillText('Escribí tu opinión', 70, 565);
        ctx.fillStyle = '#1a73e8';
        ctx.fillRect(44, 860, w - 88, 92);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = '600 32px Arial, Helvetica, sans-serif';
        ctx.fillText('Publicar', w / 2, 906);
    }

    const PHONE_W = 1.08;
    const PHONE_H = 2.2;
    const phone = new THREE.Group();
    const phoneBody = new THREE.Mesh(
        new THREE.ExtrudeGeometry(roundedRect(PHONE_W, PHONE_H, 0.16), {
            depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 12,
        }),
        new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.6 })
    );
    phoneBody.position.z = -0.035;
    phone.add(phoneBody);

    const SCREEN_W = PHONE_W - 0.08;
    const SCREEN_H = PHONE_H - 0.08;
    const screenGeometry = new THREE.ShapeGeometry(roundedRect(SCREEN_W, SCREEN_H, 0.12), 12);
    planarUv(screenGeometry, -SCREEN_W / 2, -SCREEN_H / 2, SCREEN_W, SCREEN_H);
    const screenMaterial = new THREE.MeshBasicMaterial({ map: canvasTexture(540, 1140, drawPhoneScreen), color: 0x000000 });
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.z = 0.052;
    phone.add(screen);
    scene.add(phone);

    // --- Ondas NFC ---
    const ringGeometry = new THREE.RingGeometry(0.975, 1, 96);
    const rings = [0, 1, 2].map((i) => {
        const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
            color: accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
        mesh.userData.offset = i / 3;
        scene.add(mesh);
        return mesh;
    });

    // --- Posiciones por sección ---
    const ANCHORS = {
        wide: {
            hero: { x: 2.3, y: 0.02, s: 1.22 },
            how: { x: 1.95, y: 0.02, s: 1.16 },
            models: { x: 2.2, y: 0.02, s: 1.28 },
        },
        narrow: {
            hero: { x: 0, y: -1.78, s: 0.52 },
            how: { x: 0, y: 1.02, s: 0.6 },
            models: { x: 0, y: 1.02, s: 0.6 },
        },
    };

    const smooth = (edge0, edge1, x) => {
        const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    };
    const mix = (a, b, t) => a + (b - a) * t;
    const damp = (current, target, rate) => current + (target - current) * rate;

    const startAnchor = ANCHORS[innerWidth <= 860 ? 'narrow' : 'wide'].hero;
    const current = { x: startAnchor.x, y: startAnchor.y, s: startAnchor.s * 0.3, z: 0, phoneX: 4, phoneY: -5, phoneZ: 1, phoneRot: 0.5, phoneScale: 1, screen: 0, rings: 0, sway: 1 };
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let layout = 'wide';

    // En celulares bajos la portada tiene menos lugar libre para el display.
    function anchorFor(mode) {
        const anchor = ANCHORS[layout][mode];
        if (layout === 'narrow' && innerHeight < 720) {
            return mode === 'hero' ? { x: 0, y: -2.08, s: 0.38 } : { x: 0, y: 1.42, s: 0.42 };
        }
        return anchor;
    }

    addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch') return;
        pointer.tx = event.clientX / innerWidth - 0.5;
        pointer.ty = event.clientY / innerHeight - 0.5;
    }, { passive: true });

    function resize() {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        layout = width <= 860 ? 'narrow' : 'wide';
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, layout === 'narrow' ? 1.5 : 1.75));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        backgroundMaterial.uniforms.aspect.value = camera.aspect;
    }
    addEventListener('resize', resize);
    resize();

    let lastFrame = performance.now();

    function frame(now) {
        requestAnimationFrame(frame);
        if (!Carteg.sceneVisible || document.hidden) {
            lastFrame = now;
            return;
        }

        const delta = Math.min(0.05, (now - lastFrame) / 1000);
        lastFrame = now;
        const time = Carteg.reducedMotion ? 0 : now / 1000;
        const rate = 1 - Math.pow(0.0015, delta);

        const anchor = anchorFor(Carteg.mode);
        const howP = Carteg.howProgress;
        const inHow = Carteg.mode === 'how';

        // Coreografía del celular según el avance de la sección
        const approach = inHow ? smooth(0.26, 0.5, howP) : 0;
        const present = inHow ? smooth(0.62, 0.82, howP) : 0;
        const narrow = layout === 'narrow';

        const displayShift = present * (narrow ? -0.52 : -0.95);
        current.x = damp(current.x, anchor.x + displayShift, rate);
        current.y = damp(current.y, anchor.y, rate);
        current.z = damp(current.z, present * -0.8, rate);
        current.s = damp(current.s, anchor.s, rate);

        const s = current.s;
        const contactX = anchor.x;
        const contactY = anchor.y - 0.5 * s;
        const startX = anchor.x + (narrow ? 2.4 : 3.8);
        const startY = anchor.y - (narrow ? 3.4 : 3.6);
        const presentX = anchor.x + (narrow ? 0.62 : 1.05);
        const presentY = anchor.y + (narrow ? -0.08 : 0.02);

        current.phoneX = damp(current.phoneX, mix(mix(startX, contactX, approach), presentX, present), rate);
        current.phoneY = damp(current.phoneY, mix(mix(startY, contactY, approach), presentY, present), rate);
        current.phoneZ = damp(current.phoneZ, mix(0.55, 1.15, present), rate);
        current.phoneRot = damp(current.phoneRot, mix(0.5, 0.06, approach) - present * 0.06, rate);
        current.phoneScale = damp(current.phoneScale, s * mix(0.82, 1.08, present), rate);
        const screenTarget = inHow ? smooth(0.46, 0.6, howP) : 0;
        current.screen = damp(current.screen, screenTarget, rate);

        phone.visible = current.phoneY > -6 && (inHow || current.phoneY > startY + 0.1);
        phone.position.set(current.phoneX, current.phoneY, current.phoneZ);
        phone.rotation.set(-0.04 - pointer.y * 0.08, -0.14 + pointer.x * 0.15, -current.phoneRot);
        phone.scale.setScalar(current.phoneScale);
        screenMaterial.color.setScalar(0.03 + current.screen * 0.97);

        // Display visible
        pointer.x = damp(pointer.x, pointer.tx, rate * 0.6);
        pointer.y = damp(pointer.y, pointer.ty, rate * 0.6);
        current.sway = damp(current.sway, inHow ? 0.25 : 1, rate);

        displays.forEach((group, i) => {
            // El nuevo modelo entra recién cuando salió el anterior, así no se cruzan.
            const othersGone = displays.every((other, j) => j === i || other.userData.reveal < 0.06);
            const target = i === Carteg.modelIndex && othersGone ? 1 : 0;
            const data = group.userData;
            data.reveal = damp(data.reveal, target, target ? rate * 0.7 : Math.min(1, rate * 1.6));
            group.visible = data.reveal > 0.01;
            if (!group.visible) return;
            const eased = 1 - Math.pow(1 - data.reveal, 3);
            const float = Math.sin(time * 0.9 + i) * 0.05 * current.sway;
            group.position.set(current.x, current.y + float, current.z);
            group.scale.setScalar(s * eased);
            group.rotation.set(
                0.06 + pointer.y * 0.16 + Math.sin(time * 0.6) * 0.025 * current.sway,
                Math.sin(time * 0.5) * 0.3 * current.sway - 0.12 * current.sway + pointer.x * 0.35 + (1 - eased) * 2.6 + Carteg.heroProgress * 0.5 * (Carteg.mode === 'hero' ? 1 : 0),
                0
            );
        });

        // Color y luz de fondo
        accent.lerp(ACCENTS[Carteg.modelIndex], rate * 0.5);
        rim.color.copy(accent);
        backgroundMaterial.uniforms.time.value = time;
        backgroundMaterial.uniforms.focusX.value = damp(
            backgroundMaterial.uniforms.focusX.value,
            narrow ? 0 : current.x / (5.67 * camera.aspect / 2),
            rate
        );

        // Ondas
        const ringTarget = inHow ? mix(0.25, 1, smooth(0.38, 0.55, howP)) * (1 - present * 0.7) : 0.42;
        current.rings = damp(current.rings, ringTarget, rate);
        rings.forEach((ring) => {
            const phase = Carteg.reducedMotion ? ring.userData.offset : (time * 0.32 + ring.userData.offset) % 1;
            ring.position.set(current.x, current.y - 0.1 * s, current.z - 0.5);
            ring.scale.setScalar(s * (0.9 + phase * 2.3));
            ring.material.opacity = Math.pow(1 - phase, 2) * current.rings * 0.75;
        });

        renderer.render(scene, camera);
    }

    requestAnimationFrame(frame);
})();
