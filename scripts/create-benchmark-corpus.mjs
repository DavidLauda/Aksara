import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = new URL('../benchmarks/', import.meta.url);
await mkdir(new URL('fixtures/', root), { recursive: true });
const region = (id, text, box, referenceTranslation) => ({ id, text, box, referenceTranslation });
const real = [
  { id: 'real-package', file: '../tests/fixtures/comic-context.png', kind: 'real', tags: ['wrapped-sentence', 'literal-context'],
    regions: [region('package', 'We got this mysterious package.', { x: 170, y: 45, width: 185, height: 115 }, 'Kami mendapat paket misterius ini.')],
    reviewNotes: 'Got refers to receiving a package, not encouragement. Kami/kita depends on the audience; both can be valid.' },
  { id: 'real-two-bubbles', file: '../tests/fixtures/comic-two-bubbles.png', kind: 'real', tags: ['two-speakers', 'interjection', 'nonstandard-word'],
    regions: [region('empty', "Huh? There's nothing inside.", { x: 10, y: 8, width: 205, height: 105 }, 'Hah? Tidak ada apa-apa di dalamnya.'), region('box', "It's just an empty cardbox.", { x: 180, y: 120, width: 150, height: 115 }, 'Ini hanya kotak kardus kosong.')],
    reviewNotes: 'Preserve the interjection and negation. Cardbox is the original nonstandard spelling; the Indonesian reference is an interpretation, not an authoritative exact answer.' },
];
const synthetic = [
  { id: 'wrapped-parcel', tags: ['wrapped-sentence'], bubbles: [{ lines: ['We found a', 'strange little', 'parcel.'], reference: 'Kami menemukan sebuah paket kecil yang aneh.' }] },
  { id: 'two-speakers', tags: ['two-speakers', 'negation'], bubbles: [{ lines: ['Did you open it?'], reference: 'Apakah kamu sudah membukanya?' }, { lines: ['No, it is', 'still sealed.'], reference: 'Belum, benda itu masih tersegel.' }] },
  { id: 'negation', tags: ['negation', 'imperative'], bubbles: [{ lines: ["Don't open", 'that box!'], reference: 'Jangan buka kotak itu!' }] },
  { id: 'idiom', tags: ['idiom', 'context-contrast'], bubbles: [{ lines: ['We got this!'], reference: 'Kita pasti bisa!' }], reviewNotes: 'Here the isolated exclamation is encouragement. Contrast with receiving a package in real-package.' },
  { id: 'punctuation', tags: ['punctuation', 'question'], bubbles: [{ lines: ['Wait...', 'Is that mine?'], reference: 'Tunggu... Apakah itu milikku?' }] },
  { id: 'caption-and-dialogue', tags: ['caption', 'separate-regions'], bubbles: [{ lines: ['Later that night.'], reference: 'Malam harinya.', caption: true }, { lines: ['Where is', 'the key?'], reference: 'Di mana kuncinya?' }] },
  { id: 'small-text', tags: ['small-text', 'wrapped-sentence'], fontSize: 23, bubbles: [{ lines: ['Please leave the', 'package by the door.'], reference: 'Tolong letakkan paketnya di dekat pintu.' }] },
  { id: 'indonesian-negation', tags: ['indonesian', 'negation'], sourceLanguage: 'ind_Latn', targetLanguage: 'eng_Latn', bubbles: [{ lines: ['Jangan buka', 'kotak itu!'], reference: 'Do not open that box!' }] },
];
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cases = [];
for (const item of real) {
  const bytes = await readFile(new URL(item.file, root)), { width, height } = await sharp(bytes).metadata();
  cases.push({ ...item, sourceLanguage: 'eng_Latn', targetLanguage: 'ind_Latn', width, height,
    provenance: 'User-supplied War and Peas screenshot; development-only crop. No redistribution rights inferred.', sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const item of synthetic) {
  const width = 960, height = 560, fontSize = item.fontSize ?? 44, regions = [];
  const shapes = item.bubbles.map((bubble, index) => {
    const count = item.bubbles.length;
    const x = count === 1 ? 220 : 40 + index * 460, y = count === 1 ? 130 : 75 + index * 120;
    const w = count === 1 ? 520 : 420, h = Math.max(130, bubble.lines.length * fontSize * 1.3 + 70);
    regions.push(region(`r${index + 1}`, bubble.lines.join(' '), { x: x + 12, y: y + 12, width: w - 24, height: h - 24 }, bubble.reference));
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${bubble.caption ? 2 : 60}" fill="white" stroke="#222" stroke-width="3"/>${bubble.caption ? '' : `<path d="M${x + 70} ${y + h - 1} l-20 28 55-28" fill="white" stroke="#222" stroke-width="3"/>`}<text font-family="Arial" font-size="${fontSize}" fill="#111" text-anchor="middle">${bubble.lines.map((line, row) => `<tspan x="${x + w / 2}" y="${y + 40 + fontSize * .5 + row * fontSize * 1.3}">${escape(line)}</tspan>`).join('')}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="3" y="3" width="954" height="554" fill="#c8d9e6" stroke="#222" stroke-width="5"/>${shapes}</svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  const file = `fixtures/${item.id}.png`; await writeFile(new URL(file, root), bytes);
  cases.push({ id: item.id, kind: 'synthetic', file, tags: item.tags, sourceLanguage: item.sourceLanguage ?? 'eng_Latn', targetLanguage: item.targetLanguage ?? 'ind_Latn',
    width, height, sha256: createHash('sha256').update(bytes).digest('hex'), regions,
    provenance: 'Aksara-authored controlled SVG text/bubble layout, rasterized with Sharp and local Arial. No real comic artwork.',
    reviewNotes: item.reviewNotes ?? 'Reference is an authored meaning guide; equivalent translations are valid.' });
}
await writeFile(new URL('corpus.json', root), JSON.stringify({ schemaVersion: 1, id: 'aksara-starter-v1', description: 'Two real panels and eight controlled layout cases. Not a representative real-comic evaluation set.', cases }, null, 2) + '\n');
console.log(`Prepared ${cases.length} annotated cases (${real.length} real, ${synthetic.length} synthetic).`);
