// Checks the Cardmarket product of every card against Cardmarket's own public catalogue, and corrects it when TCGdex is wrong.
//
// TCGdex sometimes gives one Cardmarket product to several different cards (for example the three Léviator promos XY60,
// XY106 and XY109 all point to Léviator-EX), so their links and prices would be those of another card.
// Cardmarket publishes its whole Pokémon catalogue (product names with their attacks) and its price guide every day:
//   https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json
//   https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json
// The workflow downloads them into ./cardmarket before the build. Without them, the build simply keeps the TCGdex products.
const fs = require('fs'), path = require('path');

const nk = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');
const LEVEL = /\s+(Lv\.\s?\d+|LV\.X)\b/gi;
const SYM = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy', N: 'Dragon', C: 'Colorless' };
const common = s => s.replace(LEVEL, '').replace(/\bProf\.\s*/g, 'Professor ').replace(/\bImpostor\b/g, 'Imposter').replace(/♂/g, ' M').replace(/♀/g, ' F').replace(/\s*(☆|★|Gold Star)/g, ' Star');
// Cardmarket names: "Gyarados EX [Stormy Seas | Splash Burn]", "Crobat [G] Lv.44 [Flash Bite | Toxic Fang]", "Alakazam [4] LV.X […]",
// "Unown [A] [Anger | Hidden Power]", "Bubbly [W] Energy", "Basic Grass Energy", "Boss's Orders - Corbeau", "Cacturne δ Delta Species […]"
function prodNames(n) {
  const m = n.match(/^(.*?)\s*\[([^\]]*)\]\s*$/), base = m ? m[1] : n;
  let b = common(base).replace(/\s*Delta Species/g, '').replace(/\[4\]/g, 'E4').replace(/\s+-\s+.*$/, '');
  if (/Energy$/.test(b)) b = b.replace(/\[([A-Z])\]/g, (x, k) => SYM[k] || k).replace(/^Basic\s+/, '');
  return { nk: nk(b), full: nk(common(n)), parts: new Set(m ? m[2].split('|').map(nk) : []) };
}
const cardName = c => nk(common(String(c.en || '')));
// other spellings of the card name: without a parenthesis ("Thought Wave Machine (Rocket's Secret Machine)"), with its letter ("Unown" A)
const cardAlts = c => [nk(common(String(c.en || '').replace(/\s*\([^)]*\)\s*$/, ''))), /^[A-Z!?]$/.test(c.lid) ? c.nk + nk(c.lid) : ''].filter(x => x && x !== c.nk);
// -1: another card; otherwise higher is closer (same attacks and abilities)
function score(c, p) {
  if (!c.nk || (p.nk !== c.nk && p.full !== c.nk && !c.alts.some(a => a === p.nk || a === p.full))) return -1;
  const a = c.moves, b = p.parts; let s = 5;
  for (const x of a) s += b.has(x) ? 1 : -0.5;
  for (const x of b) if (!a.has(x)) s -= 0.5;
  return s;
}
const lidKey = l => { const m = String(l).match(/^(\D*)(\d+)(.*)$/); return m ? [m[1], +m[2], m[3]] : [String(l), 0, '']; };
const byLid = (a, b) => { const x = lidKey(a.lid), y = lidKey(b.lid); return x[0].localeCompare(y[0]) || x[1] - y[1] || x[2].localeCompare(y[2]); };

function readJSON(dir, f) { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } }

// all: every TCGdex card {set, setOrder, lid, en, moves:[names], main:productId, fr:bool}
// returns { fixes: Map("set-lid" -> {id, price}), report }
function checkCardmarket(all, dir) {
  const list = readJSON(dir, 'products_singles_6.json'), guide = readJSON(dir, 'price_guide_6.json');
  if (!list || !list.products) return { fixes: new Map(), report: 'catalogue Cardmarket absent : produits TCGdex gardés tels quels' };
  const P = new Map();
  for (const p of list.products) P.set(p.idProduct, { id: p.idProduct, exp: p.idExpansion, name: p.name, ...prodNames(p.name) });
  const G = new Map(); if (guide && guide.priceGuides) for (const g of guide.priceGuides) G.set(g.idProduct, g);
  for (const c of all) { c.nk = cardName(c); c.alts = cardAlts(c); c.moves = new Set(c.moves.map(nk).filter(Boolean)); }

  // Cardmarket expansion of each TCGdex set: the one most of its cards point to
  const votes = new Map();
  for (const c of all) { const p = P.get(c.main); if (!p || score(c, p) < 0) continue;
    if (!votes.has(c.set)) votes.set(c.set, new Map()); const v = votes.get(c.set); v.set(p.exp, (v.get(p.exp) || 0) + 1); }
  for (const c of all) { const v = votes.get(c.set); c.exp = v ? [...v].sort((a, b) => b[1] - a[1])[0][0] : null; }

  // a product is trusted for a card when the names match and no other card with that name points to it
  const users = new Map();
  for (const c of all) if (c.main) { const k = c.main; if (!users.has(k)) users.set(k, []); users.get(k).push(c); }
  const owned = new Set(), todo = [];
  for (const c of all) {
    if (!c.main) continue;
    const p = P.get(c.main), named = p && score(c, p) >= 0;
    if (named && users.get(c.main).filter(o => score(o, p) >= 0).length === 1){ owned.add(c.main); continue; }
    // look for the right product in the expansion of the TCGdex one when it is the right Pokémon, otherwise in the set's usual expansion
    c.exp = named ? p.exp : c.exp;
    if (c.exp != null) todo.push(c);
  }
  // the others take a product of their expansion with the same name and attacks, not already trusted for another card.
  // Cards with the same name and attacks (holo and non-holo of the same Pokémon, for example) are paired in number order,
  // which is the order Cardmarket created them in.
  const byExp = new Map();
  for (const p of P.values()) { if (!byExp.has(p.exp)) byExp.set(p.exp, []); byExp.get(p.exp).push(p); }
  const groups = new Map();
  for (const c of todo) { if (!groups.has(c.exp)) groups.set(c.exp, []); groups.get(c.exp).push(c); }
  const pick = new Map(); let unique = 0, ordered = 0, kept = 0, lost = 0;
  for (const [exp, cs] of groups) {
    const pool = (byExp.get(exp) || []).filter(p => !owned.has(p.id));
    const clusters = new Map();
    for (const c of cs) {
      let best = -1, cands = [];
      for (const p of pool) { const s = score(c, p); if (s < 0) continue; if (s > best) { best = s; cands = [p.id]; } else if (s === best) cands.push(p.id); }
      if (!cands.length) { lost++; continue; }
      cands.sort((a, b) => a - b); const k = cands.join(',');
      if (!clusters.has(k)) clusters.set(k, []); clusters.get(k).push(c);
    }
    const used = new Set();
    for (const [k, members] of clusters) {
      const avail = k.split(',').map(Number).filter(id => !used.has(id));
      members.sort((a, b) => a.setOrder - b.setOrder || byLid(a, b));
      // one card and several possible products: keep the TCGdex one if it is among them, otherwise it cannot be told apart
      if (members.length === 1 && avail.length > 1) { const c = members[0]; if (avail.includes(c.main)) { used.add(c.main); kept++; } else lost++; continue; }
      if (avail.length < members.length) { lost += members.length; continue; }
      members.forEach((c, i) => { pick.set(c, avail[i]); used.add(avail[i]); if (avail.length > 1) ordered++; else unique++; });
    }
  }
  // what the app needs: only French cards whose product changes, or whose TCGdex product is certainly another card
  const fixes = new Map(); let changed = 0, dropped = 0;
  const priceOf = id => { const g = G.get(id); if (!g) return 0;
    return ['avg', 'low', 'trend', 'avg1', 'avg7', 'avg30', 'avg-holo', 'low-holo', 'trend-holo', 'avg1-holo', 'avg7-holo', 'avg30-holo'].map(k => g[k] == null ? null : +g[k]); };
  for (const c of todo) {
    if (!c.fr) continue;
    const id = pick.get(c);
    if (id != null) { if (id !== c.main) { fixes.set(c.set + '-' + c.lid, { id, price: priceOf(id) }); changed++; } continue; }
    const p = P.get(c.main);
    if (!p || score(c, p) < 0) { fixes.set(c.set + '-' + c.lid, { id: 0, price: 0 }); dropped++; }   // wrong card and no sure replacement: search by name
  }
  return { fixes, report: `Cardmarket : ${todo.length} produits TCGdex douteux, ${changed} corrigés (${unique} sûrs, ${ordered} dans l'ordre des numéros), ${kept} confirmés, ${dropped} remplacés par une recherche, ${lost} laissés tels quels` };
}
module.exports = { checkCardmarket };
