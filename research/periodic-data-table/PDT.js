// UMD IIFE - Periodic Data Table (PDT)
// FIXED PARSER - handles "H2O2" correctly
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PDT = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {

    // ================================================================
    // 1. ELEMENT DATA (Full Periodic Table)
    // ================================================================
    const elementData = [
        [1, "H", "Hydrogen", 1, "s", 1, 2],
        [2, "He", "Helium", 1, "s", 2, 2],
        [3, "Li", "Lithium", 2, "s", 1, 2],
        [4, "Be", "Beryllium", 2, "s", 2, 2],
        [5, "B", "Boron", 2, "p", 1, 6],
        [6, "C", "Carbon", 2, "p", 2, 6],
        [7, "N", "Nitrogen", 2, "p", 3, 6],
        [8, "O", "Oxygen", 2, "p", 4, 6],
        [9, "F", "Fluorine", 2, "p", 5, 6],
        [10, "Ne", "Neon", 2, "p", 6, 6],
        [11, "Na", "Sodium", 3, "s", 1, 2],
        [12, "Mg", "Magnesium", 3, "s", 2, 2],
        [13, "Al", "Aluminium", 3, "p", 1, 6],
        [14, "Si", "Silicon", 3, "p", 2, 6],
        [15, "P", "Phosphorus", 3, "p", 3, 6],
        [16, "S", "Sulfur", 3, "p", 4, 6],
        [17, "Cl", "Chlorine", 3, "p", 5, 6],
        [18, "Ar", "Argon", 3, "p", 6, 6],
        [19, "K", "Potassium", 4, "s", 1, 2],
        [20, "Ca", "Calcium", 4, "s", 2, 2],
        [21, "Sc", "Scandium", 4, "d", 1, 10],
        [22, "Ti", "Titanium", 4, "d", 2, 10],
        [23, "V", "Vanadium", 4, "d", 3, 10],
        [24, "Cr", "Chromium", 4, "d", 5, 10],
        [25, "Mn", "Manganese", 4, "d", 5, 10],
        [26, "Fe", "Iron", 4, "d", 6, 10],
        [27, "Co", "Cobalt", 4, "d", 7, 10],
        [28, "Ni", "Nickel", 4, "d", 8, 10],
        [29, "Cu", "Copper", 4, "d", 10, 10],
        [30, "Zn", "Zinc", 4, "d", 10, 10],
        [31, "Ga", "Gallium", 4, "p", 1, 6],
        [32, "Ge", "Germanium", 4, "p", 2, 6],
        [33, "As", "Arsenic", 4, "p", 3, 6],
        [34, "Se", "Selenium", 4, "p", 4, 6],
        [35, "Br", "Bromine", 4, "p", 5, 6],
        [36, "Kr", "Krypton", 4, "p", 6, 6],
        [37, "Rb", "Rubidium", 5, "s", 1, 2],
        [38, "Sr", "Strontium", 5, "s", 2, 2],
        [39, "Y", "Yttrium", 5, "d", 1, 10],
        [40, "Zr", "Zirconium", 5, "d", 2, 10],
        [41, "Nb", "Niobium", 5, "d", 4, 10],
        [42, "Mo", "Molybdenum", 5, "d", 5, 10],
        [43, "Tc", "Technetium", 5, "d", 5, 10],
        [44, "Ru", "Ruthenium", 5, "d", 7, 10],
        [45, "Rh", "Rhodium", 5, "d", 8, 10],
        [46, "Pd", "Palladium", 5, "d", 10, 10],
        [47, "Ag", "Silver", 5, "d", 10, 10],
        [48, "Cd", "Cadmium", 5, "d", 10, 10],
        [49, "In", "Indium", 5, "p", 1, 6],
        [50, "Sn", "Tin", 5, "p", 2, 6],
        [51, "Sb", "Antimony", 5, "p", 3, 6],
        [52, "Te", "Tellurium", 5, "p", 4, 6],
        [53, "I", "Iodine", 5, "p", 5, 6],
        [54, "Xe", "Xenon", 5, "p", 6, 6],
        [55, "Cs", "Caesium", 6, "s", 1, 2],
        [56, "Ba", "Barium", 6, "s", 2, 2],
        [57, "La", "Lanthanum", 6, "d", 1, 10],
        [58, "Ce", "Cerium", 6, "f", 1, 14],
        [59, "Pr", "Praseodymium", 6, "f", 3, 14],
        [60, "Nd", "Neodymium", 6, "f", 4, 14],
        [61, "Pm", "Promethium", 6, "f", 5, 14],
        [62, "Sm", "Samarium", 6, "f", 6, 14],
        [63, "Eu", "Europium", 6, "f", 7, 14],
        [64, "Gd", "Gadolinium", 6, "f", 7, 14],
        [65, "Tb", "Terbium", 6, "f", 9, 14],
        [66, "Dy", "Dysprosium", 6, "f", 10, 14],
        [67, "Ho", "Holmium", 6, "f", 11, 14],
        [68, "Er", "Erbium", 6, "f", 12, 14],
        [69, "Tm", "Thulium", 6, "f", 13, 14],
        [70, "Yb", "Ytterbium", 6, "f", 14, 14],
        [71, "Lu", "Lutetium", 6, "d", 1, 10],
        [72, "Hf", "Hafnium", 6, "d", 2, 10],
        [73, "Ta", "Tantalum", 6, "d", 3, 10],
        [74, "W", "Tungsten", 6, "d", 4, 10],
        [75, "Re", "Rhenium", 6, "d", 5, 10],
        [76, "Os", "Osmium", 6, "d", 6, 10],
        [77, "Ir", "Iridium", 6, "d", 7, 10],
        [78, "Pt", "Platinum", 6, "d", 9, 10],
        [79, "Au", "Gold", 6, "d", 10, 10],
        [80, "Hg", "Mercury", 6, "d", 10, 10],
        [81, "Tl", "Thallium", 6, "p", 1, 6],
        [82, "Pb", "Lead", 6, "p", 2, 6],
        [83, "Bi", "Bismuth", 6, "p", 3, 6],
        [84, "Po", "Polonium", 6, "p", 4, 6],
        [85, "At", "Astatine", 6, "p", 5, 6],
        [86, "Rn", "Radon", 6, "p", 6, 6],
        [87, "Fr", "Francium", 7, "s", 1, 2],
        [88, "Ra", "Radium", 7, "s", 2, 2],
        [89, "Ac", "Actinium", 7, "d", 1, 10],
        [90, "Th", "Thorium", 7, "f", 2, 14],
        [91, "Pa", "Protactinium", 7, "f", 2, 14],
        [92, "U", "Uranium", 7, "f", 3, 14],
        [93, "Np", "Neptunium", 7, "f", 4, 14],
        [94, "Pu", "Plutonium", 7, "f", 6, 14],
        [95, "Am", "Americium", 7, "f", 7, 14],
        [96, "Cm", "Curium", 7, "f", 7, 14],
        [97, "Bk", "Berkelium", 7, "f", 9, 14],
        [98, "Cf", "Californium", 7, "f", 10, 14],
        [99, "Es", "Einsteinium", 7, "f", 11, 14],
        [100, "Fm", "Fermium", 7, "f", 12, 14],
        [101, "Md", "Mendelevium", 7, "f", 13, 14],
        [102, "No", "Nobelium", 7, "f", 14, 14],
        [103, "Lr", "Lawrencium", 7, "d", 1, 10],
        [104, "Rf", "Rutherfordium", 7, "d", 2, 10],
        [105, "Db", "Dubnium", 7, "d", 3, 10],
        [106, "Sg", "Seaborgium", 7, "d", 4, 10],
        [107, "Bh", "Bohrium", 7, "d", 5, 10],
        [108, "Hs", "Hassium", 7, "d", 6, 10],
        [109, "Mt", "Meitnerium", 7, "d", 7, 10],
        [110, "Ds", "Darmstadtium", 7, "d", 8, 10],
        [111, "Rg", "Roentgenium", 7, "d", 9, 10],
        [112, "Cn", "Copernicium", 7, "d", 10, 10],
        [113, "Nh", "Nihonium", 7, "p", 1, 6],
        [114, "Fl", "Flerovium", 7, "p", 2, 6],
        [115, "Mc", "Moscovium", 7, "p", 3, 6],
        [116, "Lv", "Livermorium", 7, "p", 4, 6],
        [117, "Ts", "Tennessine", 7, "p", 5, 6],
        [118, "Og", "Oganesson", 7, "p", 6, 6]
    ];

    // ================================================================
    // 2. BONDING TYPE (AS NUMBERS)
    // ================================================================
    function getBondingType(V, block, occ, cap) {
        if (V === 0) return { type: "inert", value: 0 };
        // Half-filled p-subshell (max V is cap/2, not 4 — e.g. N/P/As/Sb/Bi
        // at occ=3, cap=6 reach V=3; carbon-group occ=2 only reaches V=2).
        if (V === cap / 2 && cap === 6) return { type: "amphoteric", value: [-1, 1] };
        if (block === "s" || block === "p") {
            if (occ <= cap / 2) {
                return { type: "donor", value: 1 };
            } else {
                return { type: "acceptor", value: -1 };
            }
        }
        if (block === "d" || block === "f") {
            if (occ <= cap / 2) {
                return { type: "donor", value: 1 };
            } else {
                return { type: "acceptor", value: -1 };
            }
        }
        return { type: "unknown", value: null };
    }

    // ================================================================
    // 3. FVT PHYSICS ENGINE
    // ================================================================
    function computeFVTPhysics(Z, occ, cap, period, block) {
        const half = cap / 2;
        const V = half - Math.abs(occ - half);
        const S = occ - V;
        const Z_eff = Z - S;
        const bonding = getBondingType(V, block, occ, cap);

        const n = period;
        const slater_radius = (n * n) / Z_eff;
        const orbital_energy = -13.6 * (Z_eff * Z_eff) / (n * n);

        let unpaired_spins = 0;
        if (cap === 10) {
            if (occ <= 5) unpaired_spins = occ;
            else unpaired_spins = 10 - occ;
        } else if (cap === 14) {
            if (occ <= 7) unpaired_spins = occ;
            else unpaired_spins = 14 - occ;
        } else {
            unpaired_spins = (occ % 2 === 0) ? 0 : 1;
        }
        const magnetic_moment = Math.sqrt(unpaired_spins * (unpaired_spins + 2));

        let coordination = "Unknown";
        if (cap === 2) coordination = "Linear";
        else if (cap === 6) coordination = "Tetrahedral/Octahedral";
        else if (cap === 10) {
            if (occ <= 4) coordination = "Tetrahedral";
            else if (occ <= 6) coordination = "Octahedral";
            else if (occ <= 8) coordination = "Square Planar";
            else coordination = "Linear/Complex";
        } else if (cap === 14) coordination = "Complex (f-block)";

        const IE = -orbital_energy;
        const EA = IE * 0.2;
        const electronegativity = (IE + EA) / 2;

        let crystal_structure = "Unknown";
        if (V === 0) crystal_structure = "Close-packed (noble gas)";
        else if (V === cap / 2 && cap === 6) crystal_structure = "Tetrahedral (diamond-like)";
        else if (cap === 10 && occ >= 6) crystal_structure = "BCC/FCC (metal)";
        else if (cap === 6 && occ >= 4) crystal_structure = "Covalent network";
        else crystal_structure = "Variable";

        const lattice_constant = 2 * slater_radius * 1.2;
        const heat_capacity = 3 * (n + 1);
        const config_entropy = occ * Math.log(occ + 1) * 0.1;

        return {
            Z: Z,
            occ: occ,
            cap: cap,
            period: period,
            block: block,
            V: Math.round(V * 100) / 100,
            S: Math.round(S * 100) / 100,
            Z_eff: Math.round(Z_eff * 100) / 100,
            half_filled: half,
            bonding: bonding,
            slater_radius: Math.round(slater_radius * 1000) / 1000,
            orbital_energy: Math.round(orbital_energy * 100) / 100,
            principal_quantum: n,
            unpaired_spins: unpaired_spins,
            magnetic_moment: Math.round(magnetic_moment * 100) / 100,
            electronegativity: Math.round(electronegativity * 100) / 100,
            ionization_energy: Math.round(IE * 100) / 100,
            electron_affinity: Math.round(EA * 100) / 100,
            coordination: coordination,
            crystal_structure: crystal_structure,
            lattice_constant: Math.round(lattice_constant * 1000) / 1000,
            heat_capacity: Math.round(heat_capacity * 100) / 100,
            config_entropy: Math.round(config_entropy * 100) / 100
        };
    }

    // ================================================================
    // 4. BUILD THE DATASET
    // ================================================================
    const byZ = {};
    const bySymbol = {};
    const byBlock = { s: [], p: [], d: [], f: [] };
    const byType = { donor: [], acceptor: [], inert: [], amphoteric: [] };
    const allElements = [];

    for (const [Z, symbol, name, period, block, occ, cap] of elementData) {
        const phys = computeFVTPhysics(Z, occ, cap, period, block);
        const element = {
            Z: Z,
            symbol: symbol,
            name: name,
            period: period,
            block: block,
            occupancy: occ,
            capacity: cap,
            ...phys
        };
        byZ[Z] = element;
        bySymbol[symbol] = element;
        byBlock[block].push(element);
        byType[element.bonding.type].push(element);
        allElements.push(element);
    }

    // ================================================================
    // 5. FIXED PARSER
    // ================================================================
    function parseFormula(formula) {
        // Remove spaces
        formula = formula.replace(/\s/g, '');

        // Split by '+'
        const parts = formula.split('+');
        const result = [];

        for (const part of parts) {
            if (part === '') continue;

            // Match coefficient and formula
            // e.g., "2H2O" → coeff=2, formula="H2O"
            const coeffMatch = part.match(/^(\d+)?([A-Z][a-z]?.*)$/);
            if (!coeffMatch) {
                return { error: `Invalid token: "${part}"` };
            }
            const coeff = coeffMatch[1] ? parseInt(coeffMatch[1]) : 1;
            const formulaPart = coeffMatch[2];

            // Parse the formula part into elements and counts
            // e.g., "H2O" → [{symbol:"H",count:2}, {symbol:"O",count:1}]
            const elementMatches = formulaPart.match(/([A-Z][a-z]?)(\d*)/g);
            if (!elementMatches) {
                return { error: `Invalid formula: "${formulaPart}"` };
            }

            for (const match of elementMatches) {
                const elemMatch = match.match(/([A-Z][a-z]?)(\d*)/);
                if (!elemMatch) continue;
                const symbol = elemMatch[1];
                const count = elemMatch[2] ? parseInt(elemMatch[2]) : 1;
                if (!bySymbol[symbol]) {
                    return { error: `Unknown element: "${symbol}"` };
                }
                result.push({ symbol: symbol, count: coeff * count });
            }
        }

        return result;
    }

    // ================================================================
    // 6. STABILITY CHECKER
    // ================================================================
    function checkStability(formula) {
        const parsed = parseFormula(formula);
        if (parsed.error) return { error: parsed.error };

        let sum = 0;
        let hasAmphoteric = false;
        let amphotericOptions = [];

        for (const entry of parsed) {
            const el = bySymbol[entry.symbol];
            if (!el) return { error: `Unknown element: ${entry.symbol}` };
            const v = el.V;
            const type = el.bonding.value;
            if (Array.isArray(type)) {
                hasAmphoteric = true;
                amphotericOptions.push({
                    symbol: entry.symbol,
                    count: entry.count,
                    v: v,
                    options: type
                });
            } else {
                sum += entry.count * v * type;
            }
        }

        if (hasAmphoteric) {
            const results = [];
            const indices = amphotericOptions.map(() => 0);
            const maxIndices = amphotericOptions.map(opt => opt.options.length);

            function tryCombination(depth, currentSum) {
                if (depth === amphotericOptions.length) {
                    results.push(currentSum);
                    return;
                }
                const opt = amphotericOptions[depth];
                for (let i = 0; i < opt.options.length; i++) {
                    const sign = opt.options[i];
                    const newSum = currentSum + opt.count * opt.v * sign;
                    tryCombination(depth + 1, newSum);
                }
            }
            tryCombination(0, sum);

            const balanced = results.some(s => s === 0);
            return {
                formula: formula,
                parsed: parsed,
                sum: results,
                balanced: balanced,
                message: balanced ? "✅ Stable molecule" : "❌ Unstable molecule"
            };
        }

        return {
            formula: formula,
            parsed: parsed,
            sum: sum,
            balanced: (sum === 0),
            message: (sum === 0) ? "✅ Stable molecule" : "❌ Unstable molecule"
        };
    }

    // ================================================================
    // 7. EQUATION BALANCER
    // ================================================================
    function balanceEquation(equation) {
        const parts = equation.split('=');
        if (parts.length !== 2) {
            return { error: "Equation must contain '='" };
        }

        const left = parseFormula(parts[0].trim());
        const right = parseFormula(parts[1].trim());
        if (left.error) return { error: left.error };
        if (right.error) return { error: right.error };

        const elements = {};

        for (const entry of left) {
            if (!elements[entry.symbol]) elements[entry.symbol] = 0;
            elements[entry.symbol] += entry.count;
        }

        for (const entry of right) {
            if (!elements[entry.symbol]) elements[entry.symbol] = 0;
            elements[entry.symbol] -= entry.count;
        }

        let balanced = true;
        const imbalances = [];
        for (const [symbol, count] of Object.entries(elements)) {
            if (count !== 0) {
                balanced = false;
                imbalances.push({ symbol, difference: count });
            }
        }

        // V(p) sum for the equation
        let leftV = 0;
        for (const entry of left) {
            const el = bySymbol[entry.symbol];
            if (Array.isArray(el.bonding.value)) continue;
            leftV += entry.count * el.V * el.bonding.value;
        }

        let rightV = 0;
        for (const entry of right) {
            const el = bySymbol[entry.symbol];
            if (Array.isArray(el.bonding.value)) continue;
            rightV += entry.count * el.V * el.bonding.value;
        }

        return {
            equation: equation,
            left: left,
            right: right,
            leftV: leftV,
            rightV: rightV,
            balanced: balanced,
            imbalances: imbalances,
            message: balanced ? "✅ Equation is balanced" : "❌ Equation is not balanced"
        };
    }

    // ================================================================
    // 8. COMMAND PARSER
    // ================================================================
    function run(command) {
        if (typeof command !== 'string') {
            return { error: "Command must be a string." };
        }

        const cmd = command.trim();

        // --- help ---
        if (cmd.toLowerCase() === 'help') {
            return {
                help: `
                PDT.run("all")                    - Show all elements
                PDT.run("help")                   - Show this help
                PDT.run("stable H2O")             - Check if molecule is stable
                PDT.run("stable H2O2")            - Check stability
                PDT.run("solve 2H + 2O = H2O2")   - Balance a chemical equation
                PDT.run("get Fe")                 - Get element data
                PDT.run("get 26")                 - Get element by atomic number
                PDT.run("block d")                - Show all d-block elements
                PDT.run("type donor")             - Show all donors
                `
            };
        }

        // --- all ---
        if (cmd.toLowerCase() === 'all') {
            return { elements: allElements };
        }

        // --- stable ---
        if (cmd.toLowerCase().startsWith('stable ')) {
            const formula = cmd.slice(7).trim();
            const result = checkStability(formula);
            if (result.error) return { error: result.error };
            return result;
        }

        // --- solve ---
        if (cmd.toLowerCase().startsWith('solve ')) {
            const equation = cmd.slice(6).trim();
            const result = balanceEquation(equation);
            if (result.error) return { error: result.error };
            return result;
        }

        // --- get ---
        if (cmd.toLowerCase().startsWith('get ')) {
            const key = cmd.slice(4).trim();
            if (bySymbol[key]) return { element: bySymbol[key] };
            const num = parseInt(key);
            if (!isNaN(num) && byZ[num]) return { element: byZ[num] };
            // Case-insensitive fallback
            const lowerKey = key.toLowerCase();
            for (const [sym, el] of Object.entries(bySymbol)) {
                if (sym.toLowerCase() === lowerKey) {
                    return { element: el };
                }
            }
            return { error: `Element "${key}" not found.` };
        }

        // --- block ---
        if (cmd.toLowerCase().startsWith('block ')) {
            const block = cmd.slice(6).trim().toLowerCase();
            if (byBlock[block]) return { elements: byBlock[block] };
            return { error: `Block "${block}" not found. Use s, p, d, or f.` };
        }

        // --- type ---
        if (cmd.toLowerCase().startsWith('type ')) {
            const type = cmd.slice(5).trim().toLowerCase();
            if (byType[type]) return { elements: byType[type] };
            return { error: `Type "${type}" not found. Use donor, acceptor, inert, or amphoteric.` };
        }

        return { error: `Unknown command: "${command}". Try PDT.run("help")` };
    }

    // ================================================================
    // 9. EXPORT
    // ================================================================
    return {
        byZ: byZ,
        bySymbol: bySymbol,
        byBlock: byBlock,
        byType: byType,
        all: allElements,
        run: run,
        get: function(key) {
            if (bySymbol[key]) return bySymbol[key];
            const num = parseInt(key);
            if (!isNaN(num) && byZ[num]) return byZ[num];
            return null;
        },
        stable: checkStability,
        solve: balanceEquation,
        compute: computeFVTPhysics,
        version: "1.0",
        date: "2026-09-06",
        author: "Pooled Impact"
    };
}));