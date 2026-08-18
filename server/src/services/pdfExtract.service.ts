/**
 * PDF metin cikarimi (tamamen yerel, saf JS).
 *
 * Sartname korpusu "(.md / .pdf)" olarak tanimlar ve gercek IK dokumanlari
 * genellikle PDF'tir. pdfjs-dist saf JavaScript'tir — native bagimlilik yok,
 * air-gapped calismayi bozmaz.
 *
 * Cikarilan metin markdown'a benzetilir: buyuk puntolu satirlar baslik (#/##)
 * olarak isaretlenir; boylece mevcut baslik-duyarli chunker degismeden calisir
 * ve alintilar yine "Madde N" duzeyinde kalir.
 */
import fs from 'node:fs';
import { moduleRequire } from '../config/constants.js';

// Modul cozumleme paketlenmis modda exe'nin yanindaki runtime/node_modules'e
// bakmali; ortak capa constants.ts icinde (bkz. moduleRequire).
const require = moduleRequire;

interface TextItem {
  str: string;
  transform: number[];
  height: number;
}

/** pdfjs'in Node yapisi; worker devre disi birakilir (tek surec). */
async function loadPdfjs() {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

export interface ExtractOptions {
  /**
   * Baslik sayilmasi icin gereken minimum punto orani (govde puntosuna gore).
   *
   * Uretilen PDF'lerde olculen degerler: govde 11.5pt, madde basligi 13.0pt,
   * dokuman basligi 18.0pt. Oran 1.15 secilirse esik 13.22 olur ve 13.0'luk
   * madde baslikari KACIRILIR (olculdu: tum dokumanlar tek bolume dustu).
   * 1.10 -> esik 12.65; madde basliklarini yakalar, govdeyi disarida birakir.
   */
  headingRatio?: number;
}

/**
 * PDF'ten markdown benzeri metin cikarir.
 *
 * Satirlar y konumuna gore gruplanir; her satirin ortalama punto buyuklugu
 * dokumanin GOVDE puntosuyla kiyaslanir. Belirgin buyuk satirlar baslik kabul
 * edilir: en buyuk `#`, digerleri `##`.
 */
export async function extractTextFromPdf(
  filePath: string,
  options: ExtractOptions = {},
): Promise<string> {
  const headingRatio = options.headingRatio ?? 1.10;

  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  interface Line { text: string; size: number }
  const lines: Line[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // Ayni satirdaki parcalari y koordinatina gore grupla.
    //
    // DIKKAT: pdfjs kelimeler arasindaki bosluklari AYRI item olarak yayar
    // (str: " ", height: 0). Bunlar atilirsa kelimeler birbirine yapisir
    // ("Sehirdisiisseyahatlerinde"). Bu yuzden yalnizca TAMAMEN bos stringler
    // elenir; bosluk item'lari korunur.
    const byRow = new Map<number, TextItem[]>();
    for (const raw of content.items as TextItem[]) {
      if (!('str' in raw) || raw.str === '') continue;
      const y = Math.round(raw.transform[5]);
      // 2pt tolerans: ayni satirdaki kucuk kaymalari birlestir.
      const key = [...byRow.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      const bucket = byRow.get(key) ?? [];
      bucket.push(raw);
      byRow.set(key, bucket);
    }

    const rows = [...byRow.entries()].sort((a, b) => b[0] - a[0]); // yukaridan asagi
    for (const [, items] of rows) {
      items.sort((a, b) => a.transform[4] - b.transform[4]); // soldan saga
      const text = items.map((i) => i.str).join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;

      // Punto ortalamasi yalnizca GERCEK karakter tasiyan item'lardan alinir;
      // bosluk item'larinin height'i 0 oldugu icin ortalamayi bozar.
      const sized = items.filter((i) => Math.abs(i.height || 0) > 0);
      if (!sized.length) continue;
      const size = sized.reduce((s, i) => s + Math.abs(i.transform[0] || i.height), 0) / sized.length;
      lines.push({ text, size });
    }
  }

  await doc.destroy?.();

  if (!lines.length) return '';

  // Govde puntosu = en sik gorulen boyut (yuvarlanmis).
  const freq = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const bodySize = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const maxSize = Math.max(...lines.map((l) => l.size));

  const out: string[] = [];
  for (const l of lines) {
    // Alt bilgi satirini at ("Kaynak dosya: ... · Şirket İçi Mevzuat Dokümanı")
    if (/^Kaynak dosya:/i.test(l.text)) continue;

    if (l.size >= bodySize * headingRatio) {
      const isTitle = l.size >= maxSize * 0.95;
      out.push('');
      out.push(`${isTitle ? '#' : '##'} ${l.text}`);
      out.push('');
    } else {
      out.push(l.text);
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
