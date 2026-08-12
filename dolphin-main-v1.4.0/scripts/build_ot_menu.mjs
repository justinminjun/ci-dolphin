/* Build menu_data.json for the New Faculty Orientation fortnight (Aug 3–14, 2026).

   The school's normal pipeline (Drive photo → Gemini OCR → lunch_menus) has no
   images for these two weeks — catering is published in a one-off Google Sheet
   instead. This turns that sheet into the same document shape both apps read.
   Docs are stamped manual:true so the weekly sync leaves them alone.           */

import { readFileSync, writeFileSync } from 'fs';

const CSV = process.argv[2];
const OUT = process.argv[3];
const FROM = '2026-08-03', TO = '2026-08-14';

/* ── minimal CSV reader (quoted fields contain commas + newlines) ── */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
// "Monday, August 3" / "Monday, August10"  → { iso, dayOfWeek }
function parseDate(s) {
  const m = s.match(/^(\w+),?\s*([A-Za-z]+)\s*(\d{1,2})/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return { iso: `2026-${String(mon).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`, dayOfWeek: m[1] };
}

const clean = (s) => s.replace(/\s+/g, ' ').trim().replace(/^[,/&]+|[,/&]+$/g, '').trim();
// Dishes are comma-separated; "/" belongs INSIDE a dish name ("w/ Soy sauce",
// "Pork Cutlet / Fried Shrimp") — only the Salad Bar line uses it as a separator.
const splitItems = (s, sep = /,/) => s.split(sep).map(clean).filter(x => x && x.length > 1);

/* One cell holds the whole meal: main list, a **Vegetarian) variant, a Salad Bar line */
function parseMenuCell(text) {
  const t = text.replace(/\r/g, '');
  const vegAt = t.search(/\*\*\s*Vegetarian/i);
  const saladAt = t.search(/Salad Bar\s*:/i);

  const mainEnd = Math.min(...[vegAt, saladAt].filter(i => i > -1).concat([t.length]));
  const main = splitItems(t.slice(0, mainEnd).replace(/^\s*Lunch\s*:?/i, ''));

  let veg = [];
  if (vegAt > -1) {
    const end = saladAt > vegAt ? saladAt : t.length;
    veg = splitItems(
      t.slice(vegAt, end)
        .replace(/\*\*\s*Vegetarian\)?/i, '')
        .replace(/\(\s*Others\s+(are\s+)?the\s+same\s*\)?/i, '')
    );
  }

  let salad = [];
  if (saladAt > -1) salad = splitItems(t.slice(saladAt).replace(/Salad Bar\s*:/i, ''), /[,/]/);

  return { main, veg, salad };
}

const rows = parseCsv(readFileSync(CSV, 'utf-8'));
const out = {};
let cur = null;

for (const raw of rows) {
  const r = [...raw, ...Array(12).fill('')];
  const d = parseDate(clean(r[2]));
  if (d) cur = d;
  if (!cur || cur.iso < FROM || cur.iso > TO) continue;

  const kind = clean(r[3]);
  if (!/^Lunch/i.test(kind)) continue;

  const cell = r[7] || '';
  const { main, veg, salad } = parseMenuCell(cell);
  const venue = clean(r[4]);

  // Off-site day (e.g. "Lunch at Orakai") — the cell holds a note, not a menu
  const offSite = !/School Pays/i.test(kind) || !/Lunch\s*:/i.test(cell);
  if (offSite || !main.length) {
    out[cur.iso] = {
      dayOfWeek: cur.dayOfWeek, holiday: false, manual: true, manualNote: 'New Faculty Orientation',
      msus: { korean: { items: [`${kind}${venue ? ` — ${venue}` : ''}`, 'Arranged by the orientation committee'], itemsKo: [] } },
      vs: null, pkk: null,
    };
    continue;
  }

  const vegLines = [
    ...veg.map(v => `Vegetarian: ${v}`),
    ...salad.map(s => `Salad Bar: ${s}`),
  ];
  // MS/US has a dedicated "Vegetarian & Salad" station; VS and PK/K do not,
  // so their single list carries the same lines with an explicit prefix.
  const flat = [...main, ...vegLines];

  out[cur.iso] = {
    dayOfWeek: cur.dayOfWeek,
    holiday: false,
    manual: true,
    manualNote: 'New Faculty Orientation catering (temporary — replaces the Drive photo sync)',
    msus: {
      korean: { items: main, itemsKo: [] },
      ...(vegLines.length ? { vegetarian: { items: vegLines.map(l => l.replace(/^Vegetarian: /, '')), itemsKo: [] } } : {}),
    },
    vs: { korean: { items: flat, itemsKo: [] } },
    pkk: { lunch: { items: flat, itemsKo: [] } },
  };
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`✅ ${Object.keys(out).length} days → ${OUT}`);
for (const [d, v] of Object.entries(out)) {
  console.log(`  ${d} ${v.dayOfWeek}: ${(v.msus?.korean?.items || []).length} main / ${(v.msus?.vegetarian?.items || []).length} veg+salad`);
}
