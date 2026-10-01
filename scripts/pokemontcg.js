// Real scans for the sets TCGdex has not scanned (Classic Collections, Trainer Galleries, Shiny Vaults, promos, McDonald's…),
// taken from pokemontcg.io. They are English scans of the same card, so the app labels them "image EN".
//   node scripts/pokemontcg.js download   -> ./pokemontcg/<set>.json (run by the workflow before the build)
//   require('./pokemontcg').match(cards)  -> Map(tcgdexId -> image address template), used by scripts/build.js
const fs = require('fs'), path = require('path');
const DIR = process.env.POKEMONTCG_DIR || path.join(__dirname, '..', 'pokemontcg');

// TCGdex set -> pokemontcg.io set. byName: the cards are numbered differently (reprints keep their original number),
// so they are matched by name, in number order when a name appears twice.
const SETS = {
  '30th-c': { id: 'me55c', byName: true }, 'cel25cc': { id: 'cel25c', byName: true }, 'cel25': { id: 'cel25' },
  'swsh9tg': { id: 'swsh9tg' }, 'swsh10tg': { id: 'swsh10tg' }, 'swsh11tg': { id: 'swsh11tg' }, 'swsh12tg': { id: 'swsh12tg' },
  'swsh12.5gg': { id: 'swsh12pt5gg' }, 'swsh4.5sv': { id: 'swsh45sv' }, 'sm7.5': { id: 'sm75' }, 'sm3.5': { id: 'sm35' },
  'smp': { id: 'smp' }, 'swshp': { id: 'swshp' }, 'svp': { id: 'svp' }, 'hgssp': { id: 'hsp' }, 'pl3': { id: 'pl3' }, 'ecard2': { id: 'ecard2' },
  'tk-ex-latia': { id: 'tk1a' }, 'tk-ex-latio': { id: 'tk1b' }, 'tk-ex-p': { id: 'tk2a' }, 'tk-ex-m': { id: 'tk2b' },
  '2011bw': { id: 'mcd11' }, '2012bw': { id: 'mcd12' }, '2014xy': { id: 'mcd14' }, '2015xy': { id: 'mcd15' }, '2016xy': { id: 'mcd16' },
  '2017sm': { id: 'mcd17' }, '2018sm-fr': { id: 'mcd18' }, '2019sm-fr': { id: 'mcd19' }, '2021swsh': { id: 'mcd21' }, '2022swsh': { id: 'mcd22' },
};

async function download() {
  fs.mkdirSync(DIR, { recursive: true });
  let ok = 0;
  for (const { id } of Object.values(SETS)) {
    const file = path.join(DIR, id + '.json');
    try { if (Date.now() - fs.statSync(file).mtimeMs < 7 * 864e5) { ok++; continue; } } catch (e) {}   // refreshed once a week
    const all = [];
    for (let page = 1; page < 5; page++) {
      let j = null;
      for (let k = 0; k < 6 && !j; k++) {
        try {
          const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${id}&select=id,name,number,images&pageSize=250&page=${page}`, { headers: { 'user-agent': 'classeur-pokemon (github pages build)' } });
          if (r.ok) j = await r.json();
        } catch (e) {}
        if (!j) await new Promise(r => setTimeout(r, 3000 * (k + 1)));
      }
      if (!j) break;
      all.push(...j.data);
      if (all.length >= j.totalCount || !j.data.length) break;
    }
    if (all.length) { fs.writeFileSync(file, JSON.stringify(all)); ok++; }
    await new Promise(r => setTimeout(r, 2500));   // stay under the anonymous rate limit
  }
  console.log(`pokemontcg.io : ${ok}/${Object.keys(SETS).length} séries téléchargées`);
}

const nk = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');
const nm = s => nk(String(s || '').replace(/[☆★]|\bGold Star\b/g, ' Star').replace(/♂/g, ' M').replace(/♀/g, ' F')
  .replace(/\s+(Lv\.\s?\d+|LV\.X)\b/gi, '').replace(/\bProf\.\s*/g, 'Professor ').replace(/\bImpostor\b/g, 'Imposter').replace(/\bMega\s+/g, 'M '));
const num = s => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^([A-Z-]*)0*(\d)/, '$1$2');
// address with the size left open: {sl} = small/large (scrydex), {hires} = ''/_hires (pokemontcg.io)
function template(img) {
  const s = img && img.small, l = img && img.large; if (!s) return null;
  if (/\/small$/.test(s) && l === s.replace(/small$/, 'large')) return s.replace(/small$/, '{sl}');
  if (/\.png$/.test(s) && l === s.replace(/\.png$/, '_hires.png')) return s.replace(/\.png$/, '{hires}.png');
  return s;
}
// cards: [{id, set, lid, en, fr}]
function match(cards) {
  const out = new Map(); let sets = 0;
  const bySet = new Map(); for (const c of cards) if (SETS[c.set]) { if (!bySet.has(c.set)) bySet.set(c.set, []); bySet.get(c.set).push(c); }
  const lidKey = l => { const m = String(l).match(/^(\D*)(\d+)(.*)$/); return m ? [m[1], +m[2], m[3]] : [String(l), 0, '']; };
  const byLid = (a, b) => { const x = lidKey(a.lid), y = lidKey(b.lid); return x[0].localeCompare(y[0]) || x[1] - y[1] || x[2].localeCompare(y[2]); };
  for (const [set, cs] of bySet) {
    let list; try { list = JSON.parse(fs.readFileSync(path.join(DIR, SETS[set].id + '.json'), 'utf8')); } catch (e) { continue; }
    sets++;
    const used = new Set(), same = (c, p) => { const n = nm(p.name); return n && (n === nm(c.en) || n === nm(c.fr)); };
    // same number and same name
    for (const c of cs) {
      const p = list.find(p => !used.has(p.id) && num(p.number) === num(c.lid) && same(c, p));
      if (p) { const t = template(p.images); if (t) { out.set(c.id, t); used.add(p.id); } }
    }
    if (!SETS[set].byName) continue;
    // reprints: same name, paired in number order
    const groups = new Map();
    for (const c of cs.filter(c => !out.has(c.id)).sort(byLid)) { const k = nm(c.en) || nm(c.fr); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    for (const [k, g] of groups) {
      const ps = list.filter(p => !used.has(p.id) && (nm(p.name) === k || g.some(c => same(c, p))))
        .sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0) || String(a.number).localeCompare(String(b.number)));
      if (ps.length !== g.length) continue;
      g.forEach((c, i) => { const t = template(ps[i].images); if (t) { out.set(c.id, t); used.add(ps[i].id); } });
    }
  }
  return { images: out, report: `pokemontcg.io : ${out.size} scans anglais pour ${sets} séries sans scan TCGdex` };
}
module.exports = { SETS, match };
if (require.main === module && process.argv[2] === 'download') download().catch(e => { console.error(e); process.exit(0); });
