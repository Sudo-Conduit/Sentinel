(function(root) {
    'use strict';
    if (!root.PDT || !root.THREE) throw new Error('Requires PDT and THREE');

    // ─── Orbital shapes, by block ─────────────────────────────────
    // Each entry's fn(ct, st, phi) returns the magnitude of the real spherical
    // harmonic for that orbital (ct = cos(theta), st = sin(theta)); `max` is
    // that function's true maximum over the sphere, used to normalize
    // probability-weighted rejection sampling in _createParticles. `ring:true`
    // marks the one shape (dz2) that has a real toroidal lobe in addition to
    // its point cloud.
    var ORBITAL_DEFS = {
        s: {
            order: ['s'],
            s:  { label: 's · sphere', max: 1, fn: function() { return 1; } }
        },
        p: {
            order: ['pz', 'px', 'py'],
            pz: { label: 'pz · dumbbell', max: 1, fn: function(ct, st, phi) { return Math.abs(ct); } },
            px: { label: 'px · dumbbell', max: 1, fn: function(ct, st, phi) { return Math.abs(st * Math.cos(phi)); } },
            py: { label: 'py · dumbbell', max: 1, fn: function(ct, st, phi) { return Math.abs(st * Math.sin(phi)); } }
        },
        d: {
            order: ['dz2', 'dxy', 'dx2y2', 'dxz', 'dyz'],
            dz2:   { label: 'dz2 · dumbbell + torus', max: 2,   ring: true, fn: function(ct) { return Math.abs(3 * ct * ct - 1); } },
            dxy:   { label: 'dxy · cloverleaf',       max: 1,   fn: function(ct, st, phi) { return Math.abs(st * st * Math.sin(2 * phi)); } },
            dx2y2: { label: 'dx2-y2 · cloverleaf',    max: 1,   fn: function(ct, st, phi) { return Math.abs(st * st * Math.cos(2 * phi)); } },
            dxz:   { label: 'dxz · cloverleaf',       max: 0.5, fn: function(ct, st, phi) { return Math.abs(st * ct * Math.cos(phi)); } },
            dyz:   { label: 'dyz · cloverleaf',       max: 0.5, fn: function(ct, st, phi) { return Math.abs(st * ct * Math.sin(phi)); } }
        },
        f: {
            order: ['fz3'],
            fz3: { label: 'fz3 · multi-lobed', max: 2, fn: function(ct) { return Math.abs(5 * ct * ct * ct - 3 * ct); } }
        }
    };

    function defsForBlock(block) { return ORBITAL_DEFS[block] || ORBITAL_DEFS.s; }
    function defaultOrbitalFor(block) { return defsForBlock(block).order[0]; }
    function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

    function getElement(symbol) {
        if (root.PDT.bySymbol[symbol]) return root.PDT.bySymbol[symbol];
        var lower = symbol.toLowerCase();
        for (var key in root.PDT.bySymbol) {
            if (key.toLowerCase() === lower) return root.PDT.bySymbol[key];
        }
        return null;
    }

    var OrbitalVisualizer = function(container, symbol, orbitalChoice) {
        this.container = container;
        this.elementData = getElement(symbol);
        if (!this.elementData) throw new Error('Element not found');

        var defs0 = defsForBlock(this.elementData.block);
        this.orbitalChoice = (orbitalChoice && defs0[orbitalChoice]) ? orbitalChoice : defaultOrbitalFor(this.elementData.block);

        // Main Scene
        this.scene = new root.THREE.Scene();
        this.camera = new root.THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.camera.position.z = 8;

        this.renderer = new root.THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(this.renderer.domElement);

        this.clock = new root.THREE.Clock();
        this.isPulsing = true; // Pulse is ON by default
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.spherical = { radius: 8, theta: 0, phi: Math.PI / 2 };

        // Build the full visualization
        this._updateShellRadius();
        this._createParticles();
        this._createRing();
        this._createNucleus();
        this._setupCameraControls();
        this._createUI();
        this._animate();
    };

    OrbitalVisualizer.create = function(container, symbol, orbitalChoice) {
        return new OrbitalVisualizer(container, symbol, orbitalChoice);
    };

    // ─── Camera Controls ─────────────────────────────────────────
    OrbitalVisualizer.prototype._setupCameraControls = function() {
        var self = this;
        this.renderer.domElement.addEventListener('mousedown', function(e) {
            self.isDragging = true;
            self.previousMousePosition = { x: e.clientX, y: e.clientY };
        });
        this.renderer.domElement.addEventListener('mousemove', function(e) {
            if (!self.isDragging) return;
            var dx = e.clientX - self.previousMousePosition.x;
            var dy = e.clientY - self.previousMousePosition.y;
            self.spherical.theta -= dx * 0.01;
            self.spherical.phi -= dy * 0.01;
            self.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, self.spherical.phi));
            self.previousMousePosition = { x: e.clientX, y: e.clientY };
        });
        this.renderer.domElement.addEventListener('mouseup', function() { self.isDragging = false; });

        this.renderer.domElement.addEventListener('touchstart', function(e) {
            if (e.touches.length === 1) {
                self.isDragging = true;
                self.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        }, { passive: true });
        this.renderer.domElement.addEventListener('touchmove', function(e) {
            if (e.touches.length === 1 && self.isDragging) {
                e.preventDefault();
                var dx = e.touches[0].clientX - self.previousMousePosition.x;
                var dy = e.touches[0].clientY - self.previousMousePosition.y;
                self.spherical.theta -= dx * 0.01;
                self.spherical.phi -= dy * 0.01;
                self.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, self.spherical.phi));
                self.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        }, { passive: false });
        this.renderer.domElement.addEventListener('touchend', function() { self.isDragging = false; });
        this.renderer.domElement.addEventListener('wheel', function(e) {
            e.preventDefault();
            self.spherical.radius += e.deltaY * 0.01;
            self.spherical.radius = Math.max(3, Math.min(15, self.spherical.radius));
        });
    };

    OrbitalVisualizer.prototype._updateCamera = function() {
        var x = this.spherical.radius * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta);
        var y = this.spherical.radius * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta);
        var z = this.spherical.radius * Math.cos(this.spherical.phi);
        this.camera.position.set(x, y, z);
        this.camera.lookAt(0, 0, 0);
    };

    // ─── Shell scale (ties the particle cloud and the dz2 ring to the ──
    // ─── same element-dependent radius, instead of a hardcoded value) ──
    OrbitalVisualizer.prototype._updateShellRadius = function() {
        var sr = (this.elementData.slater_radius || 1) * 3;
        this.shellRadius = clamp(sr, 1.2, 4.2);
    };

    // ─── THE PARTICLE CLOUD (real orbital shape via rejection sampling) ──
    OrbitalVisualizer.prototype._createParticles = function() {
        if (this.points) {
            this.scene.remove(this.points);
            this.points.geometry.dispose();
        }

        var count = 20000;
        var positions = new Float32Array(count * 3);
        var def = defsForBlock(this.elementData.block)[this.orbitalChoice];

        var shellInner = this.shellRadius;
        var shellThickness = this.shellRadius * 0.6; // outer = inner * 1.6

        for (var i = 0; i < count; i++) {
            var ct, st, phi, r, density, attempts = 0, accepted = false;
            do {
                attempts++;
                r = shellInner + Math.random() * shellThickness;
                ct = Math.random() * 2 - 1;          // uniform in [-1,1] == uniform solid angle
                st = Math.sqrt(1 - ct * ct);
                phi = Math.random() * Math.PI * 2;
                density = def.fn(ct, st, phi);
                accepted = Math.random() < (density / def.max);
            } while (!accepted && attempts < 40);

            positions[i * 3]     = r * st * Math.cos(phi);
            positions[i * 3 + 1] = r * st * Math.sin(phi);
            positions[i * 3 + 2] = r * ct;
        }

        var geometry = new root.THREE.BufferGeometry();
        geometry.setAttribute('position', new root.THREE.BufferAttribute(positions, 3));

        // Standard PointsMaterial for reliability
        this.material = new root.THREE.PointsMaterial({
            color: 0x00aaff,
            size: 0.03,
            transparent: true,
            opacity: 0.7,
            blending: root.THREE.AdditiveBlending,
            depthWrite: false
        });

        this.points = new root.THREE.Points(geometry, this.material);
        this.scene.add(this.points);
    };

    // ─── THE RING (dz2's real toroidal lobe only — no other orbital has one) ──
    OrbitalVisualizer.prototype._createRing = function() {
        if (this.ring) {
            this.scene.remove(this.ring);
            this.ring.geometry.dispose();
            this.ring = null;
        }

        var def = defsForBlock(this.elementData.block)[this.orbitalChoice];
        if (!def.ring) return;

        // The torus sits at dz2's equatorial anti-node, inside the axial lobes;
        // TorusGeometry already lies flat in the xy-plane by default, which is
        // exactly where dz2's ring belongs relative to its z-axis lobes.
        var radius = this.shellRadius * 0.85;
        var ringGeometry = new root.THREE.TorusGeometry(radius, 0.05, 8, 32);
        var ringMaterial = new root.THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 });
        this.ring = new root.THREE.Mesh(ringGeometry, ringMaterial);
        this.scene.add(this.ring);
    };

    // ─── The Nucleus ────────────────────────────────────────────
    OrbitalVisualizer.prototype._createNucleus = function() {
        var nucleusGeometry = new root.THREE.SphereGeometry(0.1, 16, 16);
        var nucleusMaterial = new root.THREE.MeshBasicMaterial({ color: 0xffffff });
        this.nucleus = new root.THREE.Mesh(nucleusGeometry, nucleusMaterial);
        this.scene.add(this.nucleus);
    };

    // ─── Case-Insensitive Switch ────────────────────────────────
    OrbitalVisualizer.prototype.setElement = function(symbol) {
        if (!symbol) return;
        var newData = getElement(symbol);
        if (!newData) return;
        this.elementData = newData;
        this.orbitalChoice = defaultOrbitalFor(newData.block);
        this._updateShellRadius();
        this._rebuildOrbitalOptions();
        this._createParticles();
        this._createRing();
        console.log(`✅ Element switched to '${this.elementData.symbol}'`);
    };

    // ─── UI (With Pulse Toggle) ─────────────────────────────────
    OrbitalVisualizer.prototype._rebuildOrbitalOptions = function() {
        if (!this.orbitalSelect) return;
        var defs = defsForBlock(this.elementData.block);
        this.orbitalSelect.innerHTML = '';
        for (var i = 0; i < defs.order.length; i++) {
            var key = defs.order[i];
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = defs[key].label;
            this.orbitalSelect.appendChild(opt);
        }
        this.orbitalSelect.value = this.orbitalChoice;
    };

    OrbitalVisualizer.prototype._createUI = function() {
        var self = this;
        this.uiPanel = document.createElement('div');
        this.uiPanel.style.cssText = 'position:absolute;top:20px;left:20px;background:rgba(0,0,0,0.9);border:1px solid #00aaff;border-radius:8px;padding:12px;z-index:10000;font-family:monospace;color:white;display:flex;flex-direction:column;gap:10px;';

        var zoomRow = document.createElement('div');
        zoomRow.style.cssText = 'display:flex;gap:5px;';
        this.zoomInBtn = document.createElement('button');
        this.zoomInBtn.textContent = '+';
        this.zoomInBtn.style.cssText = 'background:#00aaff;color:#000;border:none;padding:8px;border-radius:4px;cursor:pointer;font-size:18px;';
        this.zoomInBtn.addEventListener('click', function() { self.spherical.radius -= 0.5; if (self.spherical.radius < 3) self.spherical.radius = 3; });
        this.zoomOutBtn = document.createElement('button');
        this.zoomOutBtn.textContent = '-';
        this.zoomOutBtn.style.cssText = 'background:#ff00aa;color:#000;border:none;padding:8px;border-radius:4px;cursor:pointer;font-size:18px;';
        this.zoomOutBtn.addEventListener('click', function() { self.spherical.radius += 0.5; if (self.spherical.radius > 15) self.spherical.radius = 15; });
        zoomRow.appendChild(this.zoomInBtn);
        zoomRow.appendChild(this.zoomOutBtn);

        this.pulseBtn = document.createElement('button');
        this.pulseBtn.textContent = 'Pulse: ON'; // Default ON
        this.pulseBtn.style.cssText = 'background:#00aaff;color:#000;border:none;padding:6px;border-radius:4px;cursor:pointer;';
        this.pulseBtn.addEventListener('click', function() {
            self.isPulsing = !self.isPulsing;
            self.pulseBtn.textContent = self.isPulsing ? 'Pulse: ON' : 'Pulse: OFF';
        });

        this.input = document.createElement('input');
        this.input.placeholder = 'Enter symbol (e.g., Fe)';
        this.input.style.cssText = 'background:#111;color:#0ff;border:1px solid #0ff;padding:4px;border-radius:4px;';
        this.setBtn = document.createElement('button');
        this.setBtn.textContent = 'Set Element';
        this.setBtn.style.cssText = 'background:#00aaff;color:#000;border:none;padding:4px;border-radius:4px;cursor:pointer;';
        this.setBtn.addEventListener('click', function() { self.setElement(self.input.value); });

        this.orbitalSelect = document.createElement('select');
        this.orbitalSelect.style.cssText = 'background:#111;color:#fff;border:1px solid #0ff;padding:4px;border-radius:4px;';
        this._rebuildOrbitalOptions();
        this.orbitalSelect.addEventListener('change', function() {
            self.orbitalChoice = this.value;
            self._createRing();
            self._createParticles();
        });

        this.closeBtn = document.createElement('button');
        this.closeBtn.textContent = 'Close';
        this.closeBtn.style.cssText = 'background:#ff00aa;color:#000;border:none;padding:4px;border-radius:4px;cursor:pointer;';
        this.closeBtn.addEventListener('click', function() { self.close(); });

        this.destroyBtn = document.createElement('button');
        this.destroyBtn.textContent = 'Destroy';
        this.destroyBtn.style.cssText = 'background:#ff0000;color:#fff;border:none;padding:4px;border-radius:4px;cursor:pointer;';
        this.destroyBtn.addEventListener('click', function() { self.destroy(); });

        this.uiPanel.appendChild(zoomRow);
        this.uiPanel.appendChild(this.pulseBtn);
        this.uiPanel.appendChild(this.input);
        this.uiPanel.appendChild(this.setBtn);
        this.uiPanel.appendChild(this.orbitalSelect);
        this.uiPanel.appendChild(this.closeBtn);
        this.uiPanel.appendChild(this.destroyBtn);
        this.container.appendChild(this.uiPanel);
    };

    OrbitalVisualizer.prototype.close = function() {
        if (this.container) this.container.style.display = 'none';
    };

    OrbitalVisualizer.prototype.destroy = function() {
        if (this.container) {
            this.container.removeChild(this.uiPanel);
            this.container.removeChild(this.renderer.domElement);
            this.container.style.display = 'none';
            this.container = null;
        }
        if (this.renderer) this.renderer.dispose();
        if (this.material) this.material.dispose();
        if (this.points) this.points.geometry.dispose();
        if (this.ring) this.ring.geometry.dispose();
        if (this.nucleus) this.nucleus.geometry.dispose();
        cancelAnimationFrame(this._animationId);
        this._animationId = null;
    };

    // ─── ANIMATION (Includes Pulse) ──────────────────────────────
    OrbitalVisualizer.prototype._animate = function() {
        var self = this;
        var loop = function() {
            self._animationId = requestAnimationFrame(loop);

            var elapsed = self.clock.getElapsedTime();
            self._updateCamera();

            // PULSE: If pulse is ON, modulate opacity
            if (self.isPulsing) {
                self.material.opacity = 0.7 + 0.3 * Math.sin(elapsed * 3.0);
            } else {
                self.material.opacity = 0.7;
            }

            // Rotate
            self.points.rotation.y = elapsed * 0.5;
            self.points.rotation.x = Math.sin(elapsed * 0.3) * 0.2;
            if (self.ring) {
                self.ring.rotation.y = elapsed * 0.5;
                self.ring.rotation.x = Math.sin(elapsed * 0.3) * 0.2;
            }

            self.renderer.render(self.scene, self.camera);
        };
        loop();
    };

    root.OrbitalVisualizer = OrbitalVisualizer;
})(window);
