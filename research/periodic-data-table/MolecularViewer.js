// Plain global IIFE (not full UMD) - MolecularViewer renders a
// MolecularGeometry.generateIdealizedCoordinates() result in three.js.
// This mirrors OrbitalVisualizer.js's own module pattern exactly: a
// browser-only, WebGL-dependent renderer has no real CommonJS/AMD
// consumer, so it just takes `root` directly rather than routing through
// a UMD factory that would need root threaded in as an explicit
// dependency parameter for no actual benefit.
//
// Pure rendering - no chemistry of its own, and no claim beyond what the
// geometry it's handed already says: a HUD line always echoes
// geometrySource ('idealized (VSEPR)' today; 'imported (source: ...)'
// once real-coordinate import exists) so a viewer never mistakes a
// mechanical VSEPR approximation for a measured structure.
//
// Camera/controls (orbit drag, Cmd+Drag pan, wheel zoom, ResizeObserver
// resize) intentionally mirror OrbitalVisualizer.js's own conventions,
// already established and working in Orbital Scope - not reinvented here.
(function(root) {
    'use strict';
    if (!root.THREE) throw new Error('MolecularViewer requires THREE (three.js) to already be loaded as a global');

    // Standard CPK/Jmol element coloring convention - a cited, published
    // color scheme (like the atomic-weight table elsewhere in this
    // project), not an arbitrary palette. Elements not listed fall back
    // to a neutral grey (visually flagged as "unassigned," not blended
    // in as if it meant something).
    var CPK_COLOR = {
        H: 0xffffff, C: 0x2f2f2f, N: 0x3050f8, O: 0xff0d0d, F: 0x90e050,
        Cl: 0x1ff01f, Br: 0xa62929, I: 0x940094, S: 0xffff30, P: 0xff8000,
        B: 0xffb5b5, Si: 0xf0c8a0, Na: 0xab5cf2, K: 0x8f40d4, Mg: 0x8aff00,
        Ca: 0x3dff00, Fe: 0xe06633, Cu: 0xc88033, Zn: 0x7d80b0, Mn: 0x9c7ac7,
        Co: 0xf090a0, Ni: 0x50d050
    };
    var DEFAULT_COLOR = 0xcccccc;
    var METAL_RADIUS = 0.5, HEAVY_RADIUS = 0.4, H_RADIUS = 0.28;

    function atomColor(symbol) { return CPK_COLOR[symbol] !== undefined ? CPK_COLOR[symbol] : DEFAULT_COLOR; }
    function atomRadius(symbol) {
        if (symbol === 'H') return H_RADIUS;
        if (CPK_COLOR[symbol] !== undefined && ['Fe', 'Cu', 'Zn', 'Mn', 'Co', 'Ni', 'Na', 'K', 'Mg', 'Ca'].indexOf(symbol) !== -1) return METAL_RADIUS;
        return HEAVY_RADIUS;
    }

    var BOND_RADIUS = 0.08;
    var BOND_OFFSET = 0.11;
    var BOND_COLOR = 0x8a97a8;
    var AROMATIC_BOND_COLOR = 0x00aaff;
    var RING_CLOSURE_COLOR = 0xff2fb0;

    function MolecularViewer(container, geometryResult, options) {
        options = options || {};
        this.container = container;
        this.THREE = root.THREE;

        this.scene = new this.THREE.Scene();
        this.camera = new this.THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.renderer = new this.THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(this.renderer.domElement);

        this.scene.add(new this.THREE.AmbientLight(0xffffff, 0.55));
        var key = new this.THREE.DirectionalLight(0xffffff, 0.8);
        key.position.set(5, 8, 6);
        this.scene.add(key);
        var fill = new this.THREE.DirectionalLight(0xffffff, 0.35);
        fill.position.set(-6, -3, -4);
        this.scene.add(fill);

        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.spherical = { radius: 10, theta: 0.6, phi: 1.1 };
        this.target = { x: 0, y: 0, z: 0 };

        this.molecule = new this.THREE.Group();
        this.scene.add(this.molecule);

        this._setupCameraControls();
        this._setupResize();
        this.setGeometry(geometryResult);
        this._animate();
    }

    MolecularViewer.create = function(container, geometryResult, options) {
        return new MolecularViewer(container, geometryResult, options);
    };

    // Swaps in a new MolecularGeometry result (e.g. after loading a
    // different molecule) without rebuilding the scene/camera/controls.
    MolecularViewer.prototype.setGeometry = function(geometryResult) {
        var THREE = this.THREE;
        while (this.molecule.children.length) this.molecule.remove(this.molecule.children[0]);
        this.geometryResult = geometryResult;
        if (!geometryResult || geometryResult.error) return;

        var atomSphereGeom = {}; // cache one sphere geometry per radius, reused across atoms
        function sphereGeometryFor(radius) {
            var key = radius.toFixed(3);
            if (!atomSphereGeom[key]) atomSphereGeom[key] = new THREE.SphereGeometry(radius, 20, 16);
            return atomSphereGeom[key];
        }

        var atoms = geometryResult.atoms;
        atoms.forEach(function(a) {
            var mat = new THREE.MeshStandardMaterial({ color: atomColor(a.symbol), roughness: 0.5, metalness: 0.05 });
            var mesh = new THREE.Mesh(sphereGeometryFor(atomRadius(a.symbol)), mat);
            mesh.position.set(a.x, a.y, a.z);
            mesh.userData = { atomIndex: a.index, symbol: a.symbol };
            this.molecule.add(mesh);
        }, this);

        var bondCylGeom = new THREE.CylinderGeometry(BOND_RADIUS, BOND_RADIUS, 1, 10, 1, true);
        var self = this;
        function addCylinder(p1, p2, colorHex, dashed) {
            var dir = new THREE.Vector3().subVectors(p2, p1);
            var length = dir.length();
            if (length < 1e-6) return;
            var mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
            var mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6, metalness: 0.05, transparent: !!dashed, opacity: dashed ? 0.55 : 1 });
            var mesh = new THREE.Mesh(bondCylGeom, mat);
            mesh.scale.set(1, length, 1);
            mesh.position.copy(mid);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            self.molecule.add(mesh);
        }

        geometryResult.bonds.forEach(function(b) {
            var pa = atoms[b.a], pb = atoms[b.b];
            if (!pa || !pb) return;
            var p1 = new THREE.Vector3(pa.x, pa.y, pa.z);
            var p2 = new THREE.Vector3(pb.x, pb.y, pb.z);
            var dir = new THREE.Vector3().subVectors(p2, p1).normalize();
            var perp = new THREE.Vector3(0, 1, 0).cross(dir);
            if (perp.length() < 1e-3) perp.set(1, 0, 0).cross(dir);
            perp.normalize();

            var color = b.ringClosure ? RING_CLOSURE_COLOR : (b.order === 'aromatic' ? AROMATIC_BOND_COLOR : BOND_COLOR);
            var count = (b.order === 2) ? 2 : (b.order === 3) ? 3 : 1;
            if (count === 1) {
                addCylinder(p1, p2, color, b.ringClosure);
            } else {
                var span = BOND_OFFSET * (count - 1);
                for (var k = 0; k < count; k++) {
                    var off = perp.clone().multiplyScalar(-span / 2 + k * BOND_OFFSET);
                    addCylinder(p1.clone().add(off), p2.clone().add(off), color, b.ringClosure);
                }
            }
        });
    };

    MolecularViewer.prototype._setupCameraControls = function() {
        var self = this;
        this.renderer.domElement.addEventListener('mousedown', function(e) {
            self.isDragging = true;
            self.previousMousePosition = { x: e.clientX, y: e.clientY };
        });
        this.renderer.domElement.addEventListener('mousemove', function(e) {
            if (!self.isDragging) return;
            var dx = e.clientX - self.previousMousePosition.x;
            var dy = e.clientY - self.previousMousePosition.y;
            if (e.metaKey) {
                self._pan(dx, dy);
            } else {
                self.spherical.theta -= dx * 0.01;
                self.spherical.phi -= dy * 0.01;
                self.spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, self.spherical.phi));
            }
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
            self.spherical.radius = Math.max(2, Math.min(40, self.spherical.radius));
        });
    };

    MolecularViewer.prototype._setupResize = function() {
        var self = this;
        if (typeof ResizeObserver === 'undefined') return;
        this._resizeObserver = new ResizeObserver(function() { self._onResize(); });
        this._resizeObserver.observe(this.container);
    };

    MolecularViewer.prototype._onResize = function() {
        if (!this.container || !this.renderer) return;
        var width = this.container.clientWidth, height = this.container.clientHeight;
        if (!width || !height) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    };

    MolecularViewer.prototype._pan = function(dx, dy) {
        var THREE = this.THREE;
        var panScale = this.spherical.radius * 0.0015;
        var right = new THREE.Vector3(), up = new THREE.Vector3(), ignored = new THREE.Vector3();
        this.camera.matrixWorld.extractBasis(right, up, ignored);
        this.target.x += (-right.x * dx + up.x * dy) * panScale;
        this.target.y += (-right.y * dx + up.y * dy) * panScale;
        this.target.z += (-right.z * dx + up.z * dy) * panScale;
    };

    MolecularViewer.prototype.resetView = function() {
        this.target = { x: 0, y: 0, z: 0 };
        this.spherical = { radius: 10, theta: 0.6, phi: 1.1 };
    };

    MolecularViewer.prototype._animate = function() {
        var self = this;
        function frame() {
            self._raf = requestAnimationFrame(frame);
            var x = self.target.x + self.spherical.radius * Math.sin(self.spherical.phi) * Math.cos(self.spherical.theta);
            var y = self.target.y + self.spherical.radius * Math.sin(self.spherical.phi) * Math.sin(self.spherical.theta);
            var z = self.target.z + self.spherical.radius * Math.cos(self.spherical.phi);
            self.camera.position.set(x, y, z);
            self.camera.lookAt(self.target.x, self.target.y, self.target.z);
            self.renderer.render(self.scene, self.camera);
        }
        frame();
    };

    MolecularViewer.prototype.destroy = function() {
        if (this._raf) cancelAnimationFrame(this._raf);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
    };

    MolecularViewer.CPK_COLOR = CPK_COLOR;
    MolecularViewer.version = '0.1';
    root.MolecularViewer = MolecularViewer;
}(typeof self !== 'undefined' ? self : this));
