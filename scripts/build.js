// Builds the site for GitHub Pages:
//   1. reads every French card from the TCGdex card database (cloned into ./tcgdex by the workflow)
//   2. embeds that catalogue into src/template.html
//   3. writes site/ = index.html + the files from public/, and vision-list.json for scripts/vision-index.js
// Run locally with:  git clone --depth 1 https://github.com/tcgdex/cards-database.git tcgdex && node scripts/build.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..');
const ROOT = process.env.TCGDEX_DIR || path.join(REPO, 'tcgdex');
if (!fs.existsSync(path.join(ROOT, 'data'))) { console.error('TCGdex database not found in ' + ROOT); process.exit(1); }

function load(file) {
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/const (\w+)\s*:\s*\w+(\[\])?\s*=/, 'const $1 =')
    .replace(/export default (\w+)/, 'module.exports = $1')
    .replace(/\bset:\s*Set\b/, 'set: null')
    .replace(/\bserie:\s*serie\b/, 'serie: null')
    .replace(/\bas const\b/g, '')
    .replace(/<[A-Za-z]+>/g, '');
  const m = { exports: {} };
  try { vm.runInNewContext(src, { module: m, Set: null, serie: null }); } catch (e) { return null; }
  return m.exports;
}


const sets = [], cards = [], rarities = [], rarIdx = {};
const R = r => { r = r || 'None'; if (!(r in rarIdx)) { rarIdx[r] = rarities.length; rarities.push(r); } return rarIdx[r]; };
const TYPES = ['Grass','Fire','Water','Lightning','Psychic','Fighting','Darkness','Metal','Fairy','Dragon','Colorless'];
const VAR = { normal: 'n', reverse: 'r', holo: 'h', firstEdition: '1', wPromo: 'p', lenticular: 'l', metal: 'm' };
// variants that come out of booster packs, in master-set order later: normal, holo, reverse, patterned reverses
// (Poké Ball, Master Ball, Énergie, Team Rocket…). Stamped promos, jumbo cards and blister-only foils are left out.
const BOOSTER_FOIL = /ball|energy|rocket/;
function variantsOf(c) {
  const out = []; const add = k => { if (!out.includes(k)) out.push(k); }; const v = c.variants;
  if (Array.isArray(v)) {
    for (const x of v) {
      if (x.size && x.size !== 'standard') continue;
      const stamps = [].concat(x.stamp || []);
      if (stamps.includes('1st-edition') || x.subtype === '1st-edition' || x.subtype === 'first-edition') { add('1'); continue; }
      if (stamps.length) continue;
      const base = VAR[x.type]; if (!base) continue;
      if (x.subtype === 'shadowless') { add(base + '.shadowless'); continue; }
      if (x.foil) { if (BOOSTER_FOIL.test(x.foil) && (base === 'r' || base === 'h')) add(base + '.' + x.foil); continue; }
      add(base);
    }
  } else if (v && typeof v === 'object') { for (const k in v) if (v[k] && VAR[k]) add(VAR[k]); }
  if (!out.length) out.push(/Holo/.test(c.rarity || '') ? 'h' : 'n');
  return out.join('|');
}
// variants sold outside boosters (blister, deck or tin versions): they go at the end of a master-set binder as bonus cards.
// When a card exists both in normal and holo, the booster versions share one Cardmarket product; the other one is the bonus.
function bonusOf(c, serieId) {
  const v = c.variants; if (!Array.isArray(v) || serieId === 'mc') return '';
  const plain = v.filter(x => !x.foil && !x.subtype && !(x.stamp && [].concat(x.stamp).length) && (!x.size || x.size === 'standard'));
  const pid = t => { const x = plain.find(y => y.type === t); return x && x.thirdParty && x.thirdParty.cardmarket; };
  if (!plain.some(x => x.type === 'normal') || !plain.some(x => x.type === 'holo')) return '';
  const rev = pid('reverse'), n = pid('normal'), h = pid('holo');
  if (rev && n && h && n !== h){ if (n !== rev && h === rev) return 'n'; if (h !== rev && n === rev) return 'h'; }
  const r = c.rarity || '';
  if (serieId === 'sv' || serieId === 'me') return /^(Common|Uncommon)$/.test(r) ? 'h' : 'n';
  return /Holo/i.test(r) ? 'n' : 'h';
}
const base = path.join(ROOT, 'data'); let skipped = 0;
for (const serieName of fs.readdirSync(base).sort()) {
  const sDir = path.join(base, serieName);
  if (!fs.statSync(sDir).isDirectory() || serieName === 'Pokémon TCG Pocket') continue;
  const serie = load(path.join(base, serieName + '.ts')) || { name: {}, id: '' };
  for (const setName of fs.readdirSync(sDir).sort()) {
    const setDir = path.join(sDir, setName);
    if (!fs.statSync(setDir).isDirectory()) continue;
    const set = load(path.join(sDir, setName + '.ts'));
    if (!set || !set.name || !set.name.fr) { skipped++; continue; }
    const si = sets.length; let count = 0;
    for (const f of fs.readdirSync(setDir).sort()) {
      if (!f.endsWith('.ts')) continue;
      const c = load(path.join(setDir, f));
      if (!c || !c.name || !c.name.fr) continue;
      const t = (c.types && c.types[0]) ? TYPES.indexOf(c.types[0]) : -1;
      const cat = c.category === 'Trainer' ? 't' : c.category === 'Energy' ? 'e' : 'p';
      cards.push([si, f.replace(/\.ts$/, ''), c.name.fr, (c.name.en && c.name.en !== c.name.fr) ? c.name.en : 0, R(c.rarity), t, cat, variantsOf(c), (c.dexId && c.dexId[0]) || 0, bonusOf(c, serie.id) || 0]);
      count++;
    }
    if (!count) continue;
    sets.push({ id: set.id, s: serie.id, name: set.name.fr, en: set.name.en || '', serie: (serie.name && (serie.name.fr || serie.name.en)) || serieName,
      date: typeof set.releaseDate === 'string' ? set.releaseDate : '', total: (set.cardCount && set.cardCount.official) || 0,
      code: (set.abbreviations && (set.abbreviations.official || set.abbreviations.fr)) || '', oc: (set.abbreviations && set.abbreviations.fr && set.abbreviations.official && set.abbreviations.official !== set.abbreviations.fr) ? set.abbreviations.fr : '', n: count });
  }
}

if (cards.length < 15000) { console.error('Only ' + cards.length + ' cards found: the TCGdex layout may have changed, deployment stopped.'); process.exit(1); }
const built = new Date().toISOString().slice(0, 10);
const catalog = JSON.stringify({ v: 2, built, rarities, types: TYPES, sets, cards }).replace(/<\//g, '<\\/');

const SITE = path.join(REPO, 'site');
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });
const template = fs.readFileSync(path.join(REPO, 'src', 'template.html'), 'utf8');
if (!template.includes('/*CATALOG*/')) { console.error('Placeholder /*CATALOG*/ missing from src/template.html'); process.exit(1); }
if (!template.includes('/*VISION*/')) { console.error('Placeholder /*VISION*/ missing from src/template.html'); process.exit(1); }
const visionCore = fs.readFileSync(path.join(REPO, 'src', 'vision-core.js'), 'utf8');
fs.writeFileSync(path.join(SITE, 'index.html'), template.replace('/*CATALOG*/', () => catalog).replace('/*VISION*/', () => visionCore));
// card list for scripts/vision-index.js
fs.writeFileSync(path.join(REPO, 'vision-list.json'), JSON.stringify(cards.map(c => ({ id: sets[c[0]].id + '-' + c[1], s: sets[c[0]].s, set: sets[c[0]].id, lid: c[1] }))));
const stamp = built + '-' + (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 7);
for (const f of fs.readdirSync(path.join(REPO, 'public'))) {
  const src = path.join(REPO, 'public', f);
  if (f === 'sw.js') fs.writeFileSync(path.join(SITE, f), fs.readFileSync(src, 'utf8').replace('__BUILD__', stamp));
  else fs.copyFileSync(src, path.join(SITE, f));
}
console.log(`Catalogue: ${cards.length} cartes, ${sets.length} séries (skipped ${skipped}). Site écrit dans site/ (${stamp}).`);
