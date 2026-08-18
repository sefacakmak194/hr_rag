/**
 * Korpustaki tum .md dokumanlarini PDF'e cevirir.
 *
 * Sartnamede korpus "(.md / .pdf)" olarak tanimlanmis; gercek IK dokumanlari da
 * genellikle PDF'tir. Bu script kaynak markdown'lari kurumsal gorunumlu PDF'lere
 * donusturur.
 *
 * YAKLASIM: Ek npm bagimliligi eklemez. Sistemde kurulu Chrome/Edge'i headless
 * modda kullanir (`--print-to-pdf`). Turkce karakterler ve sayfa duzeni tarayici
 * motoru tarafindan dogru islenir.
 *
 * Kullanim:  node scripts/md-to-pdf.mjs
 * Cikti   :  data/corpus-pdf/*.pdf
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(ROOT, 'data', 'corpus');
const OUT = path.join(ROOT, 'data', 'corpus-pdf');

// --------------------------------------------------------- tarayici bulma
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const browser = CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!browser) {
  console.error('\n  Chrome/Edge bulunamadi. CHROME_PATH ortam degiskeniyle yol verin.\n');
  process.exit(1);
}

// ------------------------------------------------- minimal markdown -> html
/** Korpusta kullanilan markdown alt kumesi icin yeterli donusturucu. */
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (/^#\s+/.test(line)) { closeList(); out.push(`<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`); continue; }
    if (/^##\s+/.test(line)) { closeList(); out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`); continue; }
    if (/^###\s+/.test(line)) { closeList(); out.push(`<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`); continue; }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

const CSS = `
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: "Segoe UI", "Calibri", Arial, sans-serif; font-size: 11.5pt; line-height: 1.6; color: #16202b; }
  h1 { font-size: 18pt; margin: 0 0 6pt; padding-bottom: 8pt; border-bottom: 2px solid #1f4e79; color: #1f4e79; }
  h2 { font-size: 13pt; margin: 18pt 0 5pt; color: #1f4e79; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  p  { margin: 0 0 7pt; text-align: justify; }
  ul { margin: 0 0 8pt 0; padding-left: 20pt; }
  li { margin-bottom: 3pt; }
  code { background: #eef2f7; padding: 1pt 4pt; border-radius: 3pt; font-size: 10pt; }
  .meta { margin-top: 4pt; color: #6b7785; font-size: 8.5pt; border-top: 1px solid #dde3ea; padding-top: 5pt; }
`;

// ---------------------------------------------------------------- calistir
if (!fs.existsSync(CORPUS)) {
  console.error(`\n  Korpus dizini yok: ${CORPUS}\n`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.md')).sort();
if (!files.length) {
  console.error('\n  Cevrilecek .md dosyasi yok.\n');
  process.exit(1);
}

console.log(`\n  Markdown -> PDF donusumu`);
console.log(`  Tarayici: ${browser}`);
console.log(`  Cikti   : ${OUT}\n`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phr-pdf-'));
let ok = 0;

for (const file of files) {
  const md = fs.readFileSync(path.join(CORPUS, file), 'utf-8');
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
${mdToHtml(md)}
<div class="meta">Kaynak dosya: ${file} · Şirket İçi Mevzuat Dokümanı</div>
</body></html>`;

  const htmlPath = path.join(tmp, file.replace(/\.md$/, '.html'));
  const pdfPath = path.join(OUT, file.replace(/\.md$/, '.pdf'));
  fs.writeFileSync(htmlPath, html, 'utf-8');

  try {
    execFileSync(
      browser,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file:///${htmlPath.replace(/\\/g, '/')}`,
      ],
      { stdio: 'ignore', timeout: 60_000 },
    );

    const size = fs.statSync(pdfPath).size;
    console.log(`  ${file.padEnd(48)} -> ${(size / 1024).toFixed(0).padStart(4)} KB`);
    ok++;
  } catch (error) {
    console.error(`  ${file}: BASARISIZ (${error.message.split('\n')[0]})`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n  ${ok}/${files.length} dokuman PDF'e cevrildi.\n`);
process.exit(ok === files.length ? 0 : 1);
