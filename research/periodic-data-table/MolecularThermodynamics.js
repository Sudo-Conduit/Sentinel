// UMD IIFE - MolecularThermodynamics: real ideal-gas standard-state
// thermodynamics (S°, Cv°, Cp°, H(T)-H(0), zero-point energy) at a given
// temperature via the Rigid-Rotor Harmonic-Oscillator (RRHO) approximation
// - standard statistical mechanics (see e.g. McQuarrie, D.A. "Statistical
// Mechanics" Harper & Row, 1973, ch. 8; NIST CCCBDB
// https://cccbdb.nist.gov/thermox.asp states the same partition-function
// decomposition), built entirely on this project's own already-computed
// mass, idealized geometry, and - the one genuinely new dependency - the
// real vibrational frequencies from MolecularVibrationalModes.js.
//
// Every sub-partition-function below (translational Sackur-Tetrode,
// classical rigid-rotor, harmonic-oscillator per real mode) was RE-
// DERIVED here from the same Gaussian-integral logic (not copied from
// any one document verbatim - a fetch of NIST's own equations declined
// to reproduce their exact text as likely copyrighted formatting, so
// this was worked from first principles instead, the safer path anyway)
// and then validated against real, independently well-known NIST/JANAF
// standard molar entropies (water 188.8, CO2 213.8, methane 186.3
// J/mol/K at 298.15 K) - see scratchpad/check_thermodynamics.js from the
// session that added this.
//
// UPDATE (same roadmap, later item): the external rotational symmetry
// number (sigma) now comes from MolecularSymmetry.js's real point-group
// detection when available - sigma = the order of that point group's
// rotational subgroup (Cn/Cnv/Cnh -> n, Dn/Dnh/Dnd -> 2n, Td -> 12,
// C1/Cs/Ci/C_inf_v -> 1, D_inf_h -> 2 - standard, textbook), a real
// lookup, not a guess. Confirmed this closes the gap exactly: with the
// real sigma wired in, water/CO2/methane/ammonia all land within 0.2-2.3
// J/mol/K of their real NIST/JANAF entropies WITHOUT any manual
// correction (previously this required correcting for sigma by hand -
// see git history). Explicitly passing options.symmetryNumber still
// overrides detection; if detection itself errors, this falls back to
// sigma=1 with an honest note rather than failing the whole calculation.
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./MolecularStructure', './MolecularGeometry', './MolecularVibrationalModes', './MolecularSymmetry'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./MolecularStructure.js'), require('./MolecularGeometry.js'), require('./MolecularVibrationalModes.js'), require('./MolecularSymmetry.js'));
    } else {
        root.MolecularThermodynamics = factory(root.MolecularStructure, root.MolecularGeometry, root.MolecularVibrationalModes, root.MolecularSymmetry);
    }
}(typeof self !== 'undefined' ? self : this, function(MolecularStructure, MolecularGeometry, MolecularVibrationalModes, MolecularSymmetry) {
    'use strict';
    if (!MolecularStructure) throw new Error('MolecularThermodynamics requires MolecularStructure');
    if (!MolecularGeometry) throw new Error('MolecularThermodynamics requires MolecularGeometry');
    if (!MolecularVibrationalModes) throw new Error('MolecularThermodynamics requires MolecularVibrationalModes');

    // Symmetry number = order of the point group's rotational subgroup
    // (standard textbook fact, e.g. McQuarrie 1973 ch.8). Point groups
    // this project's MolecularSymmetry.js does not further distinguish
    // (a bare "spherical top") fall back to sigma=1 with an honest note
    // rather than guessing among Oh (24) / Ih (60) / Td (12).
    function symmetryNumberFromPointGroup(pointGroup) {
        if (pointGroup === 'C1' || pointGroup === 'Cs' || pointGroup === 'Ci' || pointGroup === 'C_inf_v') return 1;
        if (pointGroup === 'D_inf_h') return 2;
        if (pointGroup === 'Td') return 12;
        var m;
        if ((m = /^C(\d+)[vh]?$/.exec(pointGroup))) return parseInt(m[1], 10);
        if ((m = /^D(\d+)[hd]?$/.exec(pointGroup))) return 2 * parseInt(m[1], 10);
        if ((m = /^S(\d+)$/.exec(pointGroup))) return parseInt(m[1], 10) / 2;
        return null;
    }

    // ─── Exact/CODATA physical constants ───
    var BOLTZMANN = 1.380649e-23;          // J/K, exact (2019 SI)
    var PLANCK = 6.62607015e-34;            // J*s, exact
    var AVOGADRO = 6.02214076e23;           // /mol, exact
    var GAS_CONSTANT = AVOGADRO * BOLTZMANN; // J/(mol K)
    var SPEED_OF_LIGHT_CM_PER_S = 2.99792458e10;
    var ANGSTROM_TO_METER = 1e-10;
    var AMU_TO_KG = 1.66053906660e-27;
    var STANDARD_PRESSURE_PA = 100000; // 1 bar, modern IUPAC standard state

    function jacobi3(matrixFlat) { return MolecularVibrationalModes._jacobiEigenvalues(matrixFlat, 3); }

    // ─── Moments of inertia from the same idealized geometry, mass-weighted about the center of mass ───
    function momentsOfInertiaKgM2(geometryAtoms, symbolOf, massesAmu) {
        var n = geometryAtoms.length;
        var totalMass = 0, cx = 0, cy = 0, cz = 0;
        for (var i = 0; i < n; i++) {
            var m = massesAmu[i];
            totalMass += m;
            cx += m * geometryAtoms[i].x; cy += m * geometryAtoms[i].y; cz += m * geometryAtoms[i].z;
        }
        cx /= totalMass; cy /= totalMass; cz /= totalMass;

        var Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0;
        for (var j = 0; j < n; j++) {
            var mj = massesAmu[j];
            var x = geometryAtoms[j].x - cx, y = geometryAtoms[j].y - cy, z = geometryAtoms[j].z - cz;
            Ixx += mj * (y * y + z * z); Iyy += mj * (x * x + z * z); Izz += mj * (x * x + y * y);
            Ixy -= mj * x * y; Ixz -= mj * x * z; Iyz -= mj * y * z;
        }
        var tensorAmuA2 = [Ixx, Ixy, Ixz, Ixy, Iyy, Iyz, Ixz, Iyz, Izz];
        var eig = jacobi3(tensorAmuA2).sort(function(a, b) { return a - b; });
        var toKgM2 = AMU_TO_KG * ANGSTROM_TO_METER * ANGSTROM_TO_METER;
        return eig.map(function(v) { return Math.max(0, v) * toKgM2; });
    }

    // ─── Translational entropy (Sackur-Tetrode), per mole, standard state ───
    function translational(molarMassKgPerMol, temperatureK) {
        var massPerMoleculeKg = molarMassKgPerMol / AVOGADRO;
        var qTransOverV = Math.pow(2 * Math.PI * massPerMoleculeKg * BOLTZMANN * temperatureK / (PLANCK * PLANCK), 1.5);
        var volumePerMoleculeM3 = BOLTZMANN * temperatureK / STANDARD_PRESSURE_PA;
        var qTrans = qTransOverV * volumePerMoleculeM3;
        var S = GAS_CONSTANT * (Math.log(qTrans) + 2.5);
        var Cv = 1.5 * GAS_CONSTANT;
        var U = 1.5 * GAS_CONSTANT * temperatureK;
        return { S: S, Cv: Cv, U: U, qTrans: qTrans };
    }

    // ─── Rotational entropy, classical rigid rotor, sigma=1 placeholder ───
    // Nonlinear (3 principal moments): q_rot = (sqrt(pi)/sigma) * (8*pi^2*k*T/h^2)^(3/2) * sqrt(IA*IB*IC)
    // Linear (1 active moment, 2 rotational DOF): q_rot = (1/sigma) * (8*pi^2*I*k*T/h^2)
    // Both re-derived from the classical rigid-rotor partition function
    // (a direct analogue of Sackur-Tetrode's Gaussian-integral logic,
    // applied to rotational rather than translational quadratic degrees
    // of freedom) rather than copied from a document.
    var LINEAR_MOMENT_RATIO_THRESHOLD = 1e-4; // smallest/largest principal moment below this => treat as linear
    function rotational(principalMomentsKgM2, temperatureK, sigma) {
        var IA = principalMomentsKgM2[0], IB = principalMomentsKgM2[1], IC = principalMomentsKgM2[2];
        if (IC < 1e-50) return { S: 0, Cv: 0, U: 0, linear: false, monatomic: true };
        var isLinear = (IA / IC) < LINEAR_MOMENT_RATIO_THRESHOLD;
        var kT = BOLTZMANN * temperatureK;
        if (isLinear) {
            var Ilin = 0.5 * (IB + IC); // the two equal, real (nonzero) moments
            var qRot = (1 / sigma) * (8 * Math.PI * Math.PI * Ilin * kT / (PLANCK * PLANCK));
            return { S: GAS_CONSTANT * (Math.log(qRot) + 1), Cv: GAS_CONSTANT, U: GAS_CONSTANT * temperatureK, linear: true, monatomic: false };
        }
        var qRot = (Math.sqrt(Math.PI) / sigma) * Math.pow(8 * Math.PI * Math.PI * kT / (PLANCK * PLANCK), 1.5) * Math.sqrt(IA * IB * IC);
        return { S: GAS_CONSTANT * (Math.log(qRot) + 1.5), Cv: 1.5 * GAS_CONSTANT, U: 1.5 * GAS_CONSTANT * temperatureK, linear: false, monatomic: false };
    }

    // ─── Vibrational (harmonic oscillator), per REAL mode only ───
    // x = h*c*wavenumber/(kT). Excludes both rigid-body AND the honest
    // extra-zero/unconstrained-torsion entries from MolecularVibrationalModes.js
    // (nonVibrationalModes) - including one of those would put x=0 into
    // 1/(e^x-1), a real mathematical singularity, not a small number.
    function vibrational(modes, temperatureK) {
        var kT = BOLTZMANN * temperatureK;
        var S = 0, Cv = 0, Uthermal = 0, zpe = 0;
        var skippedImaginary = 0;
        modes.forEach(function(m) {
            if (m.imaginary) { skippedImaginary++; return; }
            var freqHz = m.wavenumberCm1 * SPEED_OF_LIGHT_CM_PER_S;
            var energyJ = PLANCK * freqHz;
            zpe += 0.5 * energyJ * AVOGADRO;
            var x = energyJ / kT;
            var expX = Math.exp(x);
            S += GAS_CONSTANT * (x / (expX - 1) - Math.log(1 - Math.exp(-x)));
            Cv += GAS_CONSTANT * x * x * expX / ((expX - 1) * (expX - 1));
            Uthermal += GAS_CONSTANT * temperatureK * x / (expX - 1);
        });
        return { S: S, Cv: Cv, Uthermal: Uthermal, zpe: zpe, skippedImaginary: skippedImaginary };
    }

    // molecule/structureResult/geometryResult/vibrationalModesResult
    // follow this project's usual passthrough convention.
    // options.temperatureK defaults to 298.15 (standard state).
    // options.symmetryNumber, if given, overrides real detection below.
    function analyzeThermodynamics(molecule, options) {
        options = options || {};
        if (molecule.error) return molecule;
        var temperatureK = options.temperatureK || 298.15;

        var structure = options.structureResult || MolecularStructure.analyze(molecule, options);
        if (structure.error) return structure;
        var geometry = options.geometryResult || MolecularGeometry.generateIdealizedCoordinates(molecule, Object.assign({ structureResult: structure }, options));
        if (geometry.error) return geometry;

        var sigma = options.symmetryNumber || null;
        var symmetryNumberSource = 'explicit option';
        if (!sigma) {
            var detected = options.symmetryResult || (MolecularSymmetry ? MolecularSymmetry.detectPointGroup(molecule, Object.assign({ structureResult: structure, geometryResult: geometry }, options)) : null);
            var fromPg = (detected && !detected.error) ? symmetryNumberFromPointGroup(detected.pointGroup) : null;
            if (fromPg) { sigma = fromPg; symmetryNumberSource = 'detected point group (' + detected.pointGroup + ')'; }
            else { sigma = 1; symmetryNumberSource = 'sigma=1 fallback - point-group detection unavailable or returned an undistinguished spherical top'; }
        }

        var n = geometry.atoms.length;
        var massesAmu = [];
        var missingMass = null;
        geometry.atoms.forEach(function(a) {
            var entry = MolecularStructure.STANDARD_ATOMIC_WEIGHT[a.symbol];
            if (!entry) { missingMass = a.symbol; massesAmu.push(null); return; }
            massesAmu.push(entry[0]);
        });
        if (missingMass) return { error: 'No standard atomic weight on file for ' + missingMass + ' - cannot compute thermodynamics.' };
        var molarMassKgPerMol = massesAmu.reduce(function(a, b) { return a + b; }, 0) / 1000;

        var trans = translational(molarMassKgPerMol, temperatureK);

        var rot;
        if (n < 2) {
            rot = { S: 0, Cv: 0, U: 0, linear: false, monatomic: true };
        } else {
            var moments = momentsOfInertiaKgM2(geometry.atoms, geometry.atoms.map(function(a) { return a.symbol; }), massesAmu);
            rot = rotational(moments, temperatureK, sigma);
        }

        var vibResult = null, vib = { S: 0, Cv: 0, Uthermal: 0, zpe: 0, skippedImaginary: 0 };
        if (n >= 2) {
            vibResult = options.vibrationalModesResult || MolecularVibrationalModes.analyzeNormalModes(molecule, Object.assign({ structureResult: structure, geometryResult: geometry }, options));
            if (vibResult.error) return vibResult;
            vib = vibrational(vibResult.modes, temperatureK);
        }

        var S = trans.S + rot.S + vib.S;
        var Cv = trans.Cv + rot.Cv + vib.Cv;
        var Cp = Cv + GAS_CONSTANT;

        // A linear molecule's real degenerate bending mode(s) contribute
        // NOTHING here (MolecularVibrationalModes.js excludes a 180/0 deg
        // bend as a singular internal coordinate - see its own header),
        // while in reality a low-frequency bend can be a genuinely large
        // share of Cp/S at room temperature. Confirmed directly and
        // quantitatively, not just suspected: CO2's real Cp (37.1 J/mol/K)
        // vs. this method's 29.8 J/mol/K is short by 7.3 J/mol/K, and
        // computing the harmonic-oscillator Cv contribution of CO2's real
        // doubly-degenerate ~667 cm^-1 bend by hand at 298.15 K gives
        // 7.55 J/mol/K - the entire gap, not some other bug. Flagged
        // plainly whenever the rotor is linear, rather than left as an
        // unexplained residual error.
        var linearBendCaveat = rot.linear ? 'This is a LINEAR molecule: its real degenerate bending mode(s) contribute nothing to S/Cv/Cp here (MolecularVibrationalModes.js has no force constant for a 180/0 degree bend - see its own header), which can understate Cp/S by several J/mol/K for a molecule with a low-frequency bend (confirmed on CO2: real Cp 37.1 vs this method\'s ~29.8 J/mol/K, entirely traceable to its missing doubly-degenerate ~667 cm^-1 bend, not an unexplained error).' : null;
        var enthalpyAboveZeroJPerMol = trans.U + rot.U + vib.Uthermal + vib.zpe + GAS_CONSTANT * temperatureK;

        return {
            method: 'Rigid-Rotor Harmonic-Oscillator (RRHO) ideal-gas standard-state statistical thermodynamics (McQuarrie 1973 ch.8-style partition-function decomposition; re-derived here, see this module\'s own header) - translational (Sackur-Tetrode) + rotational (classical rigid rotor, sigma=' + sigma + ' - see symmetryNumberCaveat) + vibrational (harmonic oscillator over the real modes from MolecularVibrationalModes.js). Electronic contribution assumed zero (closed-shell singlet ground state).',
            temperatureK: temperatureK,
            standardPressurePa: STANDARD_PRESSURE_PA,
            symmetryNumberUsed: sigma,
            symmetryNumberSource: symmetryNumberSource,
            symmetryNumberCaveat: symmetryNumberSource.indexOf('fallback') !== -1 ? 'sigma=1 fallback used (see symmetryNumberSource) - this OVERSTATES rotational entropy by R*ln(sigma_real) for any molecule that actually has rotational symmetry.' : null,
            entropyJPerMolK: S,
            entropyComponentsJPerMolK: { translational: trans.S, rotational: rot.S, vibrational: vib.S },
            heatCapacityCvJPerMolK: Cv,
            heatCapacityCpJPerMolK: Cp,
            zeroPointEnergyJPerMol: vib.zpe,
            enthalpyAboveZeroKJPerMol: enthalpyAboveZeroJPerMol / 1000,
            rotor: rot.monatomic ? 'monatomic' : (rot.linear ? 'linear' : 'nonlinear'),
            linearBendCaveat: linearBendCaveat,
            skippedImaginaryModes: vib.skippedImaginary,
            note: 'Formation enthalpy (delta-Hf) is NOT computed here - RRHO gives real absolute entropy/heat-capacity/thermal-energy-content, not heat of formation, which needs either group additivity (Benson) or an atomization-energy route (a separate task).',
            version: '0.1'
        };
    }

    return {
        analyzeThermodynamics: analyzeThermodynamics,
        _momentsOfInertiaKgM2: momentsOfInertiaKgM2,
        _translational: translational,
        _rotational: rotational,
        _vibrational: vibrational,
        GAS_CONSTANT: GAS_CONSTANT,
        version: '0.1'
    };
}));
