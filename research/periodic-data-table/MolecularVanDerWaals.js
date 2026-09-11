// UMD IIFE - MolecularVanDerWaals: molecular volume and surface area.
//
// No new chemistry model - a real, cited Van der Waals radius per element
// (Bondi, A. "van der Waals Volumes and Radii." J. Phys. Chem. 1964, 68,
// 3, 441-451 - the standard reference table every later VdW-radius table
// traces back to) placed at each atom's already-computed idealized 3D
// coordinate (MolecularGeometry.js), then real, standard computational
// geometry over that sphere model:
//   - VOLUME: Monte Carlo integration of the union of atomic spheres -
//     sample random points in a bounding box, count the fraction that
//     land inside ANY sphere, scale by box volume. A seeded PRNG keeps
//     results reproducible run to run (real Monte Carlo, not a fake
//     "random" that silently drifts between calls).
//   - SURFACE AREA: the real Shrake-Rupley algorithm (Shrake, A.;
//     Rupley, J.A. J. Mol. Biol. 1973, 79, 2, 351-371) - for each atom,
//     test points spread evenly over its own sphere (Fibonacci sphere
//     sampling) against every other atom's sphere; a point buried inside
//     another atom isn't exposed surface. probeRadiusAngstrom (default 0
//     = bare VdW/"contact" surface) can be set to 1.4 for the standard
//     water-probe Solvent-Accessible Surface Area (SASA) convention -
//     same algorithm, radii temporarily inflated by the probe.
//
// Elements with no cited VdW radius (this module covers Bondi's original
// main-group table) are named and excluded, same honesty discipline as
// every other module here - never a guessed radius.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./MolecularStructure', './MolecularGeometry'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./MolecularStructure.js'), require('./MolecularGeometry.js'));
    } else {
        root.MolecularVanDerWaals = factory(root.MolecularStructure, root.MolecularGeometry);
    }
}(typeof self !== 'undefined' ? self : this, function(MolecularStructure, MolecularGeometry) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularVanDerWaals requires MolecularStructure');
    if (!MolecularGeometry) throw new Error('MolecularVanDerWaals requires MolecularGeometry');

    // CITED: Bondi 1964, plus commonly-reproduced extensions for a few
    // main-group elements Bondi's original paper didn't cover (B, Si -
    // widely used modern values, e.g. Rowland & Taylor 1996). Angstroms.
    var VDW_RADIUS_ANGSTROM = {
        H: 1.20, He: 1.40, B: 1.65, C: 1.70, N: 1.55, O: 1.52, F: 1.47, Ne: 1.54,
        Si: 2.10, P: 1.80, S: 1.80, Cl: 1.75, Ar: 1.88,
        As: 1.85, Se: 1.90, Br: 1.85, Kr: 2.02,
        I: 1.98, Xe: 2.16
    };

    // Deterministic PRNG (mulberry32) - real Monte Carlo sampling, but
    // reproducible run to run so results are testable and don't silently
    // drift between page loads the way Math.random() would.
    function mulberry32(seed) {
        return function() {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function radiusOf(symbol, probeRadius) {
        var r = VDW_RADIUS_ANGSTROM[symbol];
        return r === undefined ? null : r + probeRadius;
    }

    function sphereList(geometry, probeRadius, unmatched) {
        var spheres = [];
        geometry.atoms.forEach(function(a) {
            var r = radiusOf(a.symbol, probeRadius);
            if (r === null) { unmatched.push(a.symbol); return; }
            spheres.push({ x: a.x, y: a.y, z: a.z, r: r });
        });
        return spheres;
    }

    // Monte Carlo union-of-spheres volume. sampleCount trades runtime for
    // precision; standardErrorAngstrom3 (from the binomial-proportion
    // standard error, scaled by the box volume) says how much to trust
    // the last significant figure - report it alongside the estimate,
    // never just the point value alone.
    function estimateVolume(spheres, sampleCount, seed) {
        if (spheres.length === 0) return { volumeAngstrom3: 0, standardErrorAngstrom3: 0, sampleCount: 0 };
        var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        spheres.forEach(function(s) {
            minX = Math.min(minX, s.x - s.r); maxX = Math.max(maxX, s.x + s.r);
            minY = Math.min(minY, s.y - s.r); maxY = Math.max(maxY, s.y + s.r);
            minZ = Math.min(minZ, s.z - s.r); maxZ = Math.max(maxZ, s.z + s.r);
        });
        var dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
        var boxVolume = dx * dy * dz;
        var rand = mulberry32(seed);
        var inside = 0;
        for (var i = 0; i < sampleCount; i++) {
            var px = minX + rand() * dx, py = minY + rand() * dy, pz = minZ + rand() * dz;
            for (var s = 0; s < spheres.length; s++) {
                var sp = spheres[s];
                var ddx = px - sp.x, ddy = py - sp.y, ddz = pz - sp.z;
                if (ddx * ddx + ddy * ddy + ddz * ddz <= sp.r * sp.r) { inside++; break; }
            }
        }
        var p = inside / sampleCount;
        var standardErrorP = Math.sqrt(Math.max(p * (1 - p), 0) / sampleCount);
        return {
            volumeAngstrom3: Math.round(p * boxVolume * 1000) / 1000,
            standardErrorAngstrom3: Math.round(standardErrorP * boxVolume * 1000) / 1000,
            sampleCount: sampleCount
        };
    }

    // Fibonacci sphere: pointCount points spread near-evenly over a unit
    // sphere - a standard, simple deterministic alternative to random
    // surface sampling for exactly this kind of per-atom point test.
    function fibonacciSpherePoints(pointCount) {
        var points = [];
        var goldenAngle = Math.PI * (3 - Math.sqrt(5));
        for (var i = 0; i < pointCount; i++) {
            var y = 1 - (i / (pointCount - 1)) * 2;
            var radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
            var theta = goldenAngle * i;
            points.push([Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY]);
        }
        return points;
    }

    // Real Shrake-Rupley: per-atom exposed-fraction times that atom's own
    // full sphere area, summed.
    function estimateSurfaceArea(spheres, pointsPerAtom) {
        if (spheres.length === 0) return { surfaceAreaAngstrom2: 0, pointsPerAtom: 0 };
        var unit = fibonacciSpherePoints(pointsPerAtom);
        var total = 0;
        spheres.forEach(function(atomSphere, ai) {
            var exposed = 0;
            unit.forEach(function(u) {
                var px = atomSphere.x + u[0] * atomSphere.r;
                var py = atomSphere.y + u[1] * atomSphere.r;
                var pz = atomSphere.z + u[2] * atomSphere.r;
                var buried = false;
                for (var j = 0; j < spheres.length; j++) {
                    if (j === ai) continue;
                    var other = spheres[j];
                    var ddx = px - other.x, ddy = py - other.y, ddz = pz - other.z;
                    if (ddx * ddx + ddy * ddy + ddz * ddz < other.r * other.r) { buried = true; break; }
                }
                if (!buried) exposed++;
            });
            var atomFullArea = 4 * Math.PI * atomSphere.r * atomSphere.r;
            total += atomFullArea * (exposed / unit.length);
        });
        return { surfaceAreaAngstrom2: Math.round(total * 1000) / 1000, pointsPerAtom: pointsPerAtom };
    }

    // molecule/structureResult/geometryResult follow this project's usual
    // passthrough convention. options.probeRadiusAngstrom: 0 (default) =
    // bare VdW/contact surface+volume; 1.4 = standard water-probe SASA
    // convention (surface area only - probe-inflated "volume" isn't a
    // standard quantity, so volume always uses the bare VdW radii).
    // options.volumeSampleCount (default 150000), options.surfacePointsPerAtom
    // (default 350) trade runtime for precision.
    function analyze(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var geometry = options.geometryResult || MolecularGeometry.generateIdealizedCoordinates(molecule, Object.assign({ structureResult: structure }, options));
        if (geometry.error) return geometry;

        var probeRadius = options.probeRadiusAngstrom || 0;
        var unmatchedVolume = [];
        var volumeSpheres = sphereList(geometry, 0, unmatchedVolume);
        var unmatchedSurface = [];
        var surfaceSpheres = probeRadius ? sphereList(geometry, probeRadius, unmatchedSurface) : volumeSpheres;
        if (!probeRadius) unmatchedSurface = unmatchedVolume;

        var volume = estimateVolume(volumeSpheres, options.volumeSampleCount || 150000, options.seed || 1);
        var surface = estimateSurfaceArea(surfaceSpheres, options.surfacePointsPerAtom || 350);

        function uniq(list) { return list.filter(function(s, i) { return list.indexOf(s) === i; }); }

        return {
            volume: Object.assign({ unmatchedElements: uniq(unmatchedVolume) }, volume),
            surfaceArea: Object.assign({ probeRadiusAngstrom: probeRadius, unmatchedElements: uniq(unmatchedSurface) }, surface),
            method: {
                volume: 'Monte Carlo union-of-spheres over Bondi (1964) Van der Waals radii, at MolecularGeometry.js idealized coordinates',
                surfaceArea: 'Shrake-Rupley (1973) rolling-point algorithm over the same sphere model' + (probeRadius ? ' (SASA, ' + probeRadius + ' A probe)' : ' (bare VdW/contact surface, no probe)')
            },
            version: '0.1'
        };
    }

    return {
        analyze: analyze,
        VDW_RADIUS_ANGSTROM: VDW_RADIUS_ANGSTROM,
        _estimateVolume: estimateVolume,
        _estimateSurfaceArea: estimateSurfaceArea,
        version: '0.1'
    };
}));
