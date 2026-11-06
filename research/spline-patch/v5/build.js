// Bundle MechanismLab_v5.html with its scripts inlined: one self-contained file for the artifact.
//   node build.js  →  dist/MechanismLab_v5.bundle.html
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const dir = __dirname, sha = s => crypto.createHash('sha256').update(s).digest('hex');
const src = fs.readFileSync(path.join(dir, 'MechanismLab_v5.html'), 'utf8');
const inlined = [];
const out = src.replace(/<script src="([^"]+)"><\/script>/g, (m, file) => {
  const code = fs.readFileSync(path.join(dir, file), 'utf8');
  inlined.push(`     ${sha(code)}  research/spline-patch/v5/${file}`);
  return `<script>/* research/spline-patch/v5/${file} · sha256 ${sha(code)} */\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
});
const header = `<!-- Mechanism Lab v5, bundled from research/spline-patch/v5/MechanismLab_v5.html (sha256 ${sha(src)}).\n     ${inlined.length} files inlined, listed with their sha256 below; scripts load from nothing outside this file.\n${inlined.join('\n')}\n-->\n`;
const final = out.replace(/(<title>[^<]*<\/title>\n)/, `$1${header}`);
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'MechanismLab_v5.bundle.html'), final);
console.log('wrote dist/MechanismLab_v5.bundle.html', final.length, 'bytes');
