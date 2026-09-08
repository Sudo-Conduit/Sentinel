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

    // Real electron markers are colored by the element's bonding character,
    // so e.g. Carbon reads as "donor" (green) at a glance without opening
    // the data panel.
    var BOND_COLORS = {
        inert: 0xffe066,      // yellow
        donor: 0x4caf50,      // green
        acceptor: 0xef4444,   // red
        amphoteric: 0x9c55e0  // purple
    };
    var VACANT_COLOR = 0x00aaff; // matches the cloud's own cyan

    // A vacant-slot marker needs to read as an unmistakable hollow ring from
    // every angle, at any rotation — a 3D torus mesh looks like a ring only
    // face-on and a thin line edge-on, and a wireframe sphere just looks like
    // a fuzzy ball. A camera-facing Sprite drawn from a ring texture solves
    // both: sprites always billboard to the camera regardless of the group's
    // rotation, so it stays a clean circle no matter how the orbital spins.
    // Built once and cached — the texture is identical for every instance.
    // Drawn in white and tinted via SpriteMaterial.color (not baked into the
    // texture itself), so VACANT_COLOR renders at full, unmuddied strength.
    var ringTextureCache = null;
    function getRingTexture() {
        if (ringTextureCache) return ringTextureCache;
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        var ctx = canvas.getContext('2d');
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(32, 32, 24, 0, Math.PI * 2);
        ctx.stroke();
        ringTextureCache = new root.THREE.CanvasTexture(canvas);
        return ringTextureCache;
    }

    // Rejection-samples one point on the shell for the given orbital def,
    // returning {ct, st, phi, r} (spherical) so callers can place either a
    // cloud point or a discrete electron marker with the same real shape.
    function sampleShell(def, shellInner, shellThickness) {
        var ct, st, phi, r, density, attempts = 0, accepted = false;
        do {
            attempts++;
            r = shellInner + Math.random() * shellThickness;
            ct = Math.random() * 2 - 1; // uniform in [-1,1] == uniform solid angle
            st = Math.sqrt(1 - ct * ct);
            phi = Math.random() * Math.PI * 2;
            density = def.fn(ct, st, phi);
            accepted = Math.random() < (density / def.max);
        } while (!accepted && attempts < 40);
        return { ct: ct, st: st, phi: phi, r: r };
    }

    function getElement(symbol) {
        if (root.PDT.bySymbol[symbol]) return root.PDT.bySymbol[symbol];
        var lower = symbol.toLowerCase();
        for (var key in root.PDT.bySymbol) {
            if (key.toLowerCase() === lower) return root.PDT.bySymbol[key];
        }
        return null;
    }

    // options.ui (default true) controls whether OrbitalVisualizer builds its
    // own fixed dark control panel. Pass { ui: false } to drive everything
    // through the public API instead (setOrbital, isPulsing, isRotating,
    // showElectrons, spherical.radius, target, setElement, destroy) from a
    // host page's own themed controls; see OrbitalVisualizer.orbitalsForBlock
    // for populating an external shape list.
    var OrbitalVisualizer = function(container, symbol, orbitalChoice, options) {
        this.container = container;
        this.elementData = getElement(symbol);
        if (!this.elementData) throw new Error('Element not found');
        this._showUI = !options || options.ui !== false;

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
        this.isPulsing = true;    // Pulse is ON by default
        this.isRotating = true;   // Auto-rotate is ON by default; pause freezes in place
        this.showElectrons = false; // Discrete electron markers are opt-in
        this.cloudOpacity = 0.7;  // base opacity of the diffuse point cloud; Pulse modulates around this
        this.hudVisible = true;   // built-in control panel visibility (has no effect in headless mode)
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.spherical = { radius: 8, theta: 0, phi: Math.PI / 2 };
        this.target = { x: 0, y: 0, z: 0 }; // orbit/look-at center; Ctrl+Drag pans this
        this._elapsed = 0; // advances every frame (drives Pulse)
        this._rotAngle = 0; // advances only while isRotating (drives the Y spin)
        this._wobble = 0;    // advances only while isRotating (drives the X wobble)
        this._recorder = null;
        this._recordedChunks = [];
        this.saveRecording = this._defaultSaveRecording.bind(this); // overridable hook

        // Build the full visualization
        this._updateShellRadius();
        this._createParticles();
        this._createRing();
        this._createElectrons();
        this._createNucleus();
        this._setupCameraControls();
        if (this._showUI) this._createUI();
        this._animate();
    };

    OrbitalVisualizer.create = function(container, symbol, orbitalChoice, options) {
        return new OrbitalVisualizer(container, symbol, orbitalChoice, options);
    };

    // Static helper so a host page can build its own orbital-shape picker
    // for whatever block the current element belongs to, without reaching
    // into OrbitalVisualizer's internals: [{ key, label, ring }, ...].
    OrbitalVisualizer.orbitalsForBlock = function(block) {
        var defs = defsForBlock(block);
        return defs.order.map(function(key) {
            return { key: key, label: defs[key].label, ring: !!defs[key].ring };
        });
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
            if (e.ctrlKey || e.metaKey) {
                self._pan(dx, dy);
            } else {
                self.spherical.theta -= dx * 0.01;
                self.spherical.phi -= dy * 0.01;
                self.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, self.spherical.phi));
            }
            self.previousMousePosition = { x: e.clientX, y: e.clientY };
        });
        this.renderer.domElement.addEventListener('mouseup', function() { self.isDragging = false; });

        // Touch stays single-finger-orbit only; Ctrl+Drag pan is a desktop
        // (mouse + modifier key) interaction, not extended to touch here.
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

    // Screen-space pan: reads the camera's own current right/up axes (so it
    // matches whatever THREE actually rendered last frame, poles included)
    // and moves the orbit target along them, scaled by distance so pan
    // speed feels consistent whether zoomed in or out.
    OrbitalVisualizer.prototype._pan = function(dx, dy) {
        var panScale = this.spherical.radius * 0.0018;
        var right = new root.THREE.Vector3();
        var up = new root.THREE.Vector3();
        var ignored = new root.THREE.Vector3();
        this.camera.matrixWorld.extractBasis(right, up, ignored);
        this.target.x += (-right.x * dx + up.x * dy) * panScale;
        this.target.y += (-right.y * dx + up.y * dy) * panScale;
        this.target.z += (-right.z * dx + up.z * dy) * panScale;
    };

    // Undoes any Ctrl+Drag panning and returns to the default framing.
    OrbitalVisualizer.prototype.resetView = function() {
        this.target = { x: 0, y: 0, z: 0 };
        this.spherical = { radius: 8, theta: 0, phi: Math.PI / 2 };
    };

    OrbitalVisualizer.prototype._updateCamera = function() {
        var x = this.target.x + this.spherical.radius * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta);
        var y = this.target.y + this.spherical.radius * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta);
        var z = this.target.z + this.spherical.radius * Math.cos(this.spherical.phi);
        this.camera.position.set(x, y, z);
        this.camera.lookAt(this.target.x, this.target.y, this.target.z);
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
            var s = sampleShell(def, shellInner, shellThickness);
            positions[i * 3]     = s.r * s.st * Math.cos(s.phi);
            positions[i * 3 + 1] = s.r * s.st * Math.sin(s.phi);
            positions[i * 3 + 2] = s.r * s.ct;
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

    // ─── ELECTRONS (optional: occ real + (cap-occ) vacant, same real shape) ──
    // Off by default. When on, samples all `cap` slots of the current
    // orbital using the same rejection-sampled density as the diffuse cloud
    // (so every marker lands where the orbital is actually dense): the
    // first `occ` render as solid, opaque electron spheres colored by the
    // element's bonding character (BOND_COLORS); the remaining `cap - occ`
    // render as hollow #DDD ring sprites (never a filled shape, so they
    // can't be mistaken for a dim electron) showing the orbital's unfilled
    // capacity — so e.g. Carbon's p-orbital reads at a glance as
    // "2 filled donor-green electrons, 4 empty rings".
    OrbitalVisualizer.prototype._createElectrons = function() {
        if (this.electronGroup) {
            this.scene.remove(this.electronGroup);
            this.electronGroup = null;
        }
        [this._electronGeometry, this._electronMaterial, this._vacantMaterial]
            .forEach(function(o) { if (o) o.dispose(); });
        this._electronGeometry = this._electronMaterial = this._vacantMaterial = null;
        if (!this.showElectrons) return;

        var def = defsForBlock(this.elementData.block)[this.orbitalChoice];
        var shellInner = this.shellRadius;
        var shellThickness = this.shellRadius * 0.6;
        var cap = this.elementData.cap || 1;
        var occ = Math.min(this.elementData.occ || 0, cap);
        var bondColor = BOND_COLORS[this.elementData.bonding && this.elementData.bonding.type] || 0xffffff;

        this._electronGeometry = new root.THREE.SphereGeometry(0.09, 12, 12);
        this._electronMaterial = new root.THREE.MeshBasicMaterial({ color: bondColor });
        this._vacantMaterial = new root.THREE.SpriteMaterial({ map: getRingTexture(), color: VACANT_COLOR, transparent: true, opacity: 0.85, depthWrite: false });

        this.electronGroup = new root.THREE.Group();

        for (var i = 0; i < cap; i++) {
            var s = sampleShell(def, shellInner, shellThickness);
            var x = s.r * s.st * Math.cos(s.phi), y = s.r * s.st * Math.sin(s.phi), z = s.r * s.ct;
            if (i < occ) {
                var mesh = new root.THREE.Mesh(this._electronGeometry, this._electronMaterial);
                mesh.position.set(x, y, z);
                this.electronGroup.add(mesh);
            } else {
                // A Sprite always billboards to the camera, so this stays a
                // clean ring from any angle, unlike a 3D torus or wireframe.
                var ring = new root.THREE.Sprite(this._vacantMaterial);
                ring.position.set(x, y, z);
                ring.scale.set(0.24, 0.24, 1);
                this.electronGroup.add(ring);
            }
        }
        this.scene.add(this.electronGroup);
    };

    // Toggle the discrete electron markers on/off from outside (host UI or
    // the built-in checkbox both go through this).
    OrbitalVisualizer.prototype.setShowElectrons = function(bool) {
        this.showElectrons = !!bool;
        this._createElectrons();
    };

    // Sets the cloud's base opacity (0-1); Pulse, if on, still modulates
    // around whatever this is set to. No rebuild needed — _animate reads
    // cloudOpacity every frame — so this is safe to call continuously from
    // a slider's input event.
    OrbitalVisualizer.prototype.setCloudOpacity = function(v) {
        this.cloudOpacity = clamp(Number(v), 0, 1);
    };

    // Shows/hides the built-in control panel so the shape itself can fill
    // the view unobstructed. The small hudToggleBtn that triggers this lives
    // outside uiPanel (appended straight to the container) specifically so
    // it never hides along with the rest of the HUD — otherwise there'd be
    // no way to bring the controls back. No-op in headless mode (ui:false),
    // since there's no built-in panel to hide.
    OrbitalVisualizer.prototype.setHudVisible = function(visible) {
        this.hudVisible = !!visible;
        if (this.uiPanel) this.uiPanel.style.display = this.hudVisible ? 'flex' : 'none';
        if (this.hudToggleBtn) this.hudToggleBtn.textContent = this.hudVisible ? 'Hide HUD' : 'Show HUD';
    };

    // ─── The Nucleus ────────────────────────────────────────────
    OrbitalVisualizer.prototype._createNucleus = function() {
        var nucleusGeometry = new root.THREE.SphereGeometry(0.1, 16, 16);
        var nucleusMaterial = new root.THREE.MeshBasicMaterial({ color: 0xffffff });
        this.nucleus = new root.THREE.Mesh(nucleusGeometry, nucleusMaterial);
        this.scene.add(this.nucleus);
    };

    // Change the orbital subtype within the current element's block (e.g.
    // 'dxy' while on Fe). Silently ignored if `key` isn't valid for the
    // current block. Safe to call whether or not the built-in UI exists.
    OrbitalVisualizer.prototype.setOrbital = function(key) {
        var defs = defsForBlock(this.elementData.block);
        if (!defs[key]) return;
        this.orbitalChoice = key;
        if (this.orbitalSelect) this.orbitalSelect.value = key;
        this._createRing();
        this._createParticles();
        this._createElectrons();
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
        this._createElectrons();
        console.log(`✅ Element switched to '${this.elementData.symbol}'`);
    };

    // ─── Recording (canvas capture -> WebM blob) ─────────────────
    // Uses captureStream + MediaRecorder directly on the rendered canvas, so
    // whatever is currently visible (any rotation/pause/electrons state) is
    // exactly what gets recorded. Unsupported in browsers without
    // HTMLCanvasElement.captureStream or MediaRecorder (notably older Safari);
    // callers should check isRecordingSupported() before offering the control.
    OrbitalVisualizer.prototype.isRecordingSupported = function() {
        return !!(this.renderer.domElement.captureStream && root.MediaRecorder);
    };

    OrbitalVisualizer.prototype.startRecording = function() {
        if (this._recorder || !this.isRecordingSupported()) return false;
        var self = this;
        var stream = this.renderer.domElement.captureStream(30);
        this._recordedChunks = [];
        this._recorder = new root.MediaRecorder(stream, { mimeType: 'video/webm' });
        this._recorder.ondataavailable = function(e) {
            if (e.data && e.data.size) self._recordedChunks.push(e.data);
        };
        this._recorder.start();
        return true;
    };

    // Resolves with the recorded video/webm Blob once the recorder has
    // fully flushed. Rejects if nothing was recording.
    OrbitalVisualizer.prototype.stopRecording = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            if (!self._recorder) { reject(new Error('Not recording')); return; }
            self._recorder.onstop = function() {
                var blob = new root.Blob(self._recordedChunks, { type: 'video/webm' });
                self._recordedChunks = [];
                self._recorder = null;
                resolve(blob);
            };
            self._recorder.stop();
        });
    };

    // Default save behavior: a plain <a download> blob link, which works in
    // an ordinary browser tab. A host page can override `instance.saveRecording`
    // with its own function(blob, filename) — e.g. routing through a
    // platform's own file-save capability where a plain link would be inert.
    OrbitalVisualizer.prototype._defaultSaveRecording = function(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
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
        this.uiPanel.style.cssText = 'position:absolute;top:20px;left:20px;background:rgba(0,0,0,0.9);border:1px solid #00aaff;border-radius:8px;padding:12px;z-index:10000;font-family:monospace;color:white;display:flex;flex-direction:column;gap:10px;max-width:200px;';

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
        this.resetBtn = document.createElement('button');
        this.resetBtn.textContent = '⟳';
        this.resetBtn.title = 'Reset view';
        this.resetBtn.style.cssText = 'background:#333;color:#fff;border:1px solid #666;padding:8px;border-radius:4px;cursor:pointer;font-size:14px;';
        this.resetBtn.addEventListener('click', function() { self.resetView(); });
        zoomRow.appendChild(this.zoomInBtn);
        zoomRow.appendChild(this.zoomOutBtn);
        zoomRow.appendChild(this.resetBtn);

        this.pulseBtn = document.createElement('button');
        this.pulseBtn.textContent = 'Pulse: ON'; // Default ON
        this.pulseBtn.style.cssText = 'background:#00aaff;color:#000;border:none;padding:6px;border-radius:4px;cursor:pointer;';
        this.pulseBtn.addEventListener('click', function() {
            self.isPulsing = !self.isPulsing;
            self.pulseBtn.textContent = self.isPulsing ? 'Pulse: ON' : 'Pulse: OFF';
        });

        this.rotateBtn = document.createElement('button');
        this.rotateBtn.textContent = 'Rotate: ON';
        this.rotateBtn.style.cssText = 'background:#00aaff;color:#000;border:none;padding:6px;border-radius:4px;cursor:pointer;';
        this.rotateBtn.addEventListener('click', function() {
            self.isRotating = !self.isRotating;
            self.rotateBtn.textContent = self.isRotating ? 'Rotate: ON' : 'Rotate: OFF';
        });

        this.electronsLabel = document.createElement('label');
        this.electronsLabel.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;';
        this.electronsLabel.title = 'Filled = bonding color (yellow inert, green donor, red acceptor, purple amphoteric). Cyan ring outline = vacant slot.';
        this.electronsCheckbox = document.createElement('input');
        this.electronsCheckbox.type = 'checkbox';
        this.electronsCheckbox.checked = this.showElectrons;
        this.electronsCheckbox.addEventListener('change', function() {
            self.setShowElectrons(self.electronsCheckbox.checked);
        });
        this.electronsLabel.appendChild(this.electronsCheckbox);
        this.electronsLabel.appendChild(document.createTextNode('Show Electrons'));

        this.opacityLabel = document.createElement('label');
        this.opacityLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;';
        this.opacitySlider = document.createElement('input');
        this.opacitySlider.type = 'range';
        this.opacitySlider.min = '0.05';
        this.opacitySlider.max = '1';
        this.opacitySlider.step = '0.05';
        this.opacitySlider.value = String(this.cloudOpacity);
        this.opacitySlider.style.cssText = 'flex:1;';
        this.opacitySlider.addEventListener('input', function() {
            self.setCloudOpacity(self.opacitySlider.value);
        });
        this.opacityLabel.appendChild(document.createTextNode('Cloud'));
        this.opacityLabel.appendChild(this.opacitySlider);

        this.input = document.createElement('input');
        this.input.placeholder = 'Enter symbol (e.g., Fe)';
        this.input.style.cssText = 'background:#111;color:#0ff;border:1px solid #0ff;padding:4px;border-radius:4px;';
        this.setBtn = document.createElement('button');
        this.setBtn.textContent = 'Set Element';
        this.setBtn.style.cssText = 'background:#00aaff;color:#000;border:none;padding:4px;border-radius:4px;cursor:pointer;';
        this.setBtn.addEventListener('click', function() {
            self.setElement(self.input.value);
            self.electronsCheckbox.checked = self.showElectrons;
        });

        this.orbitalSelect = document.createElement('select');
        this.orbitalSelect.style.cssText = 'background:#111;color:#fff;border:1px solid #0ff;padding:4px;border-radius:4px;';
        this._rebuildOrbitalOptions();
        this.orbitalSelect.addEventListener('change', function() {
            self.setOrbital(this.value);
        });

        this.recordBtn = document.createElement('button');
        this.recordBtn.style.cssText = 'background:#00aaff;color:#000;border:none;padding:6px;border-radius:4px;cursor:pointer;';
        if (!this.isRecordingSupported()) {
            this.recordBtn.textContent = 'Record (unsupported)';
            this.recordBtn.disabled = true;
            this.recordBtn.style.opacity = '0.5';
            this.recordBtn.style.cursor = 'not-allowed';
        } else {
            this.recordBtn.textContent = 'Record';
            this.recordBtn.addEventListener('click', function() {
                if (!self._recorder) {
                    self.startRecording();
                    self.recordBtn.textContent = 'Stop';
                    self.recordBtn.style.background = '#ff0000';
                    self.recordBtn.style.color = '#fff';
                } else {
                    self.recordBtn.disabled = true;
                    self.stopRecording().then(function(blob) {
                        var filename = self.elementData.symbol + '-' + self.orbitalChoice + '.webm';
                        self.saveRecording(blob, filename);
                        self.recordBtn.textContent = 'Record';
                        self.recordBtn.style.background = '#00aaff';
                        self.recordBtn.style.color = '#000';
                        self.recordBtn.disabled = false;
                    });
                }
            });
        }

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
        this.uiPanel.appendChild(this.rotateBtn);
        this.uiPanel.appendChild(this.electronsLabel);
        this.uiPanel.appendChild(this.opacityLabel);
        this.uiPanel.appendChild(this.input);
        this.uiPanel.appendChild(this.setBtn);
        this.uiPanel.appendChild(this.orbitalSelect);
        this.uiPanel.appendChild(this.recordBtn);
        this.uiPanel.appendChild(this.closeBtn);
        this.uiPanel.appendChild(this.destroyBtn);
        this.container.appendChild(this.uiPanel);

        // Deliberately outside uiPanel and appended after it, so it always
        // sits on top and is never hidden along with the rest of the HUD.
        this.hudToggleBtn = document.createElement('button');
        this.hudToggleBtn.textContent = 'Hide HUD';
        this.hudToggleBtn.style.cssText = 'position:absolute;top:20px;right:20px;background:rgba(0,0,0,0.7);color:#00aaff;border:1px solid #00aaff;padding:6px 10px;border-radius:4px;cursor:pointer;font-family:monospace;font-size:11px;z-index:10001;';
        this.hudToggleBtn.addEventListener('click', function() { self.setHudVisible(!self.hudVisible); });
        this.container.appendChild(this.hudToggleBtn);
    };

    OrbitalVisualizer.prototype.close = function() {
        if (this.container) this.container.style.display = 'none';
    };

    OrbitalVisualizer.prototype.destroy = function() {
        if (this._recorder) { try { this._recorder.stop(); } catch (e) {} this._recorder = null; }
        if (this.container) {
            // .remove() (not container.removeChild) so this is safe even if a
            // host page already replaced the container's contents itself
            // (e.g. innerHTML = ...) before calling destroy().
            if (this.uiPanel) this.uiPanel.remove();
            if (this.hudToggleBtn) this.hudToggleBtn.remove();
            if (this.renderer && this.renderer.domElement) this.renderer.domElement.remove();
            this.container.style.display = 'none';
            this.container = null;
        }
        if (this.renderer) this.renderer.dispose();
        if (this.material) this.material.dispose();
        if (this.points) this.points.geometry.dispose();
        if (this.ring) this.ring.geometry.dispose();
        [this._electronGeometry, this._electronMaterial, this._vacantMaterial]
            .forEach(function(o) { if (o) o.dispose(); });
        if (this.nucleus) this.nucleus.geometry.dispose();
        cancelAnimationFrame(this._animationId);
        this._animationId = null;
    };

    // ─── ANIMATION (Includes Pulse) ──────────────────────────────
    OrbitalVisualizer.prototype._animate = function() {
        var self = this;
        var loop = function() {
            self._animationId = requestAnimationFrame(loop);

            var dt = self.clock.getDelta();
            self._elapsed += dt;
            if (self.isRotating) {
                self._rotAngle += dt * 0.5;
                self._wobble += dt * 0.3;
            }
            self._updateCamera();

            // PULSE: modulates around the user-set base (cloudOpacity), not a
            // fixed value, and scales down with it so a low base doesn't get
            // swamped by a disproportionately large swing. Independent of Rotate.
            if (self.isPulsing) {
                self.material.opacity = clamp(self.cloudOpacity + self.cloudOpacity * 0.4 * Math.sin(self._elapsed * 3.0), 0, 1);
            } else {
                self.material.opacity = self.cloudOpacity;
            }

            // Rotate (frozen in place, not reset, while isRotating is off)
            self.points.rotation.y = self._rotAngle;
            self.points.rotation.x = Math.sin(self._wobble) * 0.2;
            if (self.ring) {
                self.ring.rotation.y = self._rotAngle;
                self.ring.rotation.x = Math.sin(self._wobble) * 0.2;
            }
            if (self.electronGroup) {
                self.electronGroup.rotation.y = self._rotAngle;
                self.electronGroup.rotation.x = Math.sin(self._wobble) * 0.2;
            }

            self.renderer.render(self.scene, self.camera);
        };
        loop();
    };

    root.OrbitalVisualizer = OrbitalVisualizer;
})(window);
