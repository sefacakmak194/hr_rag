/**
 * DOCX metin cikarimi.
 *
 * NEDEN: kurumlarin yonetmelikleri cogunlukla Word dosyasi. Korpus yalnizca
 * .md ve .pdf kabul ettigi surece "kendi dokumanlarinizi yukleyin" vaadi
 * pratikte calismiyor.
 *
 * NASIL: mammoth, DOCX'i Markdown'a cevirir ve BASLIK STILLERINI korur
 * (Heading 1 -> `#`, Heading 2 -> `##`). Bu tam olarak mevcut baslik-duyarli
 * chunker'in bekledigi bicim; yani PDF tarafinda oldugu gibi ayri bir baslik
 * sezgisi yazmaya gerek kalmiyor ve alintilar "Madde N" duzeyinde kaliyor.
 *
 * mammoth saf JavaScript'tir (zip icin jszip kullanir), native bagimlilik
 * getirmez ve air-gapped calismayi bozmaz.
 */
import { moduleRequire } from '../config/constants.js';

const require = moduleRequire;

/**
 * Markdown cikisini korpus bicimine yaklastirir.
 *
 * mammoth'un urettigi markdown fazladan bos satir ve kacis karakteri tasiyor;
 * ayrica Word'de baslik STILI kullanilmamis dokumanlarda hic `#` cikmaz —
 * o durumda chunker tek parcaya duser ve yukleme akisi kullaniciyi uyarir.
 */
function tidyMarkdown(md: string): string {
  return md
    // mammoth ozel karakterleri kacirir ("Madde 1\. Konu"); geri al.
    .replace(/\\([.\-*_#[\]()])/g, '$1')
    // Word'den gelen sert satir sonlari
    .replace(/\r\n?/g, '\n')
    // Ucten fazla bos satiri ikiye indir
    .replace(/\n{3,}/g, '\n\n')
    // Baslik satirlarindaki fazla bosluklar
    .replace(/^(#{1,6})\s+/gm, '$1 ')
    .trim();
}

/**
 * "Madde 1: Konu" gibi satirlari baslik yapar.
 *
 * DIKKAT — bu yalnizca dokumanda HIC markdown basligi yoksa uygulanir. Word
 * dosyalarinda maddeler sik sik duz paragraf olarak yazilir; boyle bir
 * dokuman chunker tarafindan tek parcaya dusurulur ve alinti "Genel" olur.
 * Oruntu kasitli olarak dar: satirin BASINDA "Madde <sayi>" ve ardindan
 * ayirici bir isaret aranir.
 */
export function promoteMaddeHeadings(md: string): string {
  if (/^#{1,6}\s+/m.test(md)) return md;

  return md
    .split('\n')
    .map((line) => {
      const m = /^(Madde\s+\d+\s*[:.\-–]\s*.+)$/i.exec(line.trim());
      return m ? `## ${m[1]}` : line;
    })
    .join('\n');
}

export async function extractTextFromDocx(filePath: string): Promise<string> {
  const mammoth = require('mammoth');

  const result = await mammoth.convertToMarkdown({ path: filePath });
  const markdown = tidyMarkdown(String(result?.value ?? ''));

  return promoteMaddeHeadings(markdown);
}
