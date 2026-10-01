// Weekly visual index of every French card, used by the camera to recognise a card without choosing its set.
//   node scripts/vision-index.js   (after scripts/build.js, which writes vision-list.json)
// Downloads each card scan once (kept in vision-cache/ between runs), computes its compact descriptor with the
// exact same code as the app (src/vision-core.js), and writes site/vision-index.json + site/vision-<hash>.bin.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const sharp = require('sharp');
const Vision = require('../src/vision-core.js');
const REPO = path.join(__dirname, '..'), SITE = path.join(REPO, 'site'), CACHE_DIR = path.join(REPO, 'vision-cache');
const CACHE = path.join(CACHE_DIR, `desc-${Vision.C_DIM}.json`);
const API = process.env.TCGDEX_API || 'https://api.tcgdex.net/v2/fr';
const ASSETS = process.env.TCGDEX_ASSETS || 'https://assets.tcgdex.net';
const CONCURRENCY = +(process.env.VISION_CONCURRENCY || 12);

async function get(url, tries = 3){
  for (let k = 0; k < tries; k++){
    try{
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'classeur-pokemon (github pages build)' } });
      clearTimeout(t);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    }catch(e){ if (k === tries - 1) return undefined; await new Promise(r => setTimeout(r, 800 * (k + 1))); }
  }
}
async function pool(items, n, fn){ const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

(async () => {
  const list = JSON.parse(fs.readFileSync(path.join(REPO, 'vision-list.json'), 'utf8')); // [{id, s, set, lid}]
  // exact French scan addresses from TCGdex (cards without a French scan fall back to the English one)
  let frImage = new Map();
  try{ const buf = await get(API + '/cards'); if (buf) for (const c of JSON.parse(buf.toString('utf8'))) if (c.image) frImage.set(c.id, c.image); }catch(e){}
  console.log(`TCGdex: ${frImage.size} scans français connus`);
  const known = new Set(list.map(c => c.id));
  for (const [id, img] of frImage) if (!known.has(id) && !img.includes('/tcgp/')) list.push({ id, live: true });   // cards newer than the card database (TCG Pocket left out)
  const jobs = list.map(c => {
    const en = c.s ? `${ASSETS}/en/${c.s}/${c.set}/${encodeURIComponent(c.lid)}` : null;
    const fr = frImage.get(c.id) || (c.s ? `${ASSETS}/fr/${c.s}/${c.set}/${encodeURIComponent(c.lid)}` : null);
    const alt = c.alt ? `${ASSETS}/${c.alt}` : null;   // older print with the same artwork, for cards without a scan
    return { id: c.id, urls: [...new Set([fr, en, alt].filter(Boolean))] };
  }).filter(j => j.urls.length);

  let cache = {};
  try{ cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); }catch(e){}
  const out = new Map(); let fromCache = 0, computed = 0, missing = 0, failed = 0, done = 0;
  await pool(jobs, CONCURRENCY, async j => {
    const hit = cache[j.id];
    if (hit && j.urls.includes(hit.u)){ out.set(j.id, Buffer.from(hit.q, 'base64')); fromCache++; }
    else {
      let ok = false;
      for (const u of j.urls){
        const buf = await get(u + '/low.webp');
        if (buf === undefined){ failed++; break; }
        if (buf === null) continue;
        try{
          const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const img = { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
          const q = Vision.quantize(Vision.compact(Vision.fromRGBA(img)));
          const b = Buffer.from(q.buffer, q.byteOffset, q.length);
          out.set(j.id, b); cache[j.id] = { u, q: b.toString('base64') }; computed++; ok = true; break;
        }catch(e){ /* unreadable image: try the next address */ }
      }
      if (!ok && !out.has(j.id)) missing++;
    }
    if (++done % 2000 === 0) console.log(`  ${done}/${jobs.length}`);
  });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (const id of Object.keys(cache)) if (!out.has(id)) delete cache[id];
  fs.writeFileSync(CACHE, JSON.stringify(cache));

  const ids = [...out.keys()].sort();
  if (ids.length < +(process.env.VISION_MIN || 1000)){ console.log(`Seulement ${ids.length} empreintes : index non publié, la caméra utilisera le mode par série.`); return; }
  const bin = Buffer.concat(ids.map(id => out.get(id)));
  const hash = crypto.createHash('sha1').update(bin).digest('hex').slice(0, 10);
  fs.mkdirSync(SITE, { recursive: true });
  fs.writeFileSync(path.join(SITE, `vision-${hash}.bin`), bin);
  fs.writeFileSync(path.join(SITE, 'vision-index.json'), JSON.stringify({ v: 1, dim: Vision.C_DIM, n: ids.length, bin: `vision-${hash}.bin`, built: new Date().toISOString().slice(0, 10), ids }));
  console.log(`Empreintes : ${ids.length} cartes (${fromCache} reprises du cache, ${computed} calculées, ${missing} sans scan, ${failed} échecs réseau). ${(bin.length / 1e6).toFixed(1)} Mo.`);
})().catch(e => { console.error(e); process.exit(1); });
