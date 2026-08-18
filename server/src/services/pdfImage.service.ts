/**
 * PDF icindeki gomulu goruntuleri cikarir (OCR icin).
 *
 * NEDEN ELDE YAZILDI: pdfjs bir sayfayi cizmek icin canvas ister; `canvas`
 * paketi native'dir ve "native bagimlilik yok" ilkesini bozar. pdfjs'in ic
 * nesne havuzundan (`page.objs`) goruntu okumak da denendi — operator listesi
 * alindiginda goruntuler henuz cozulmedigi icin bos donuyor (olculdu: 0 goruntu).
 *
 * Bu yuzden PDF'in kendisi okunuyor. Taranmis belgede ihtiyacimiz olan tek sey
 * sayfa basina bir buyuk goruntu XObject'i; onu bulmak icin tam bir PDF
 * ayristiricisi gerekmiyor:
 *
 *   <</Type /XObject /Subtype /Image /Width W /Height H
 *     /ColorSpace CS /BitsPerComponent 8 /Filter F /Length N>> stream ... endstream
 *
 * Desteklenen filtreler:
 *   /DCTDecode   -> govde zaten JPEG'dir, oldugu gibi kullanilir
 *   /FlateDecode -> zlib ile acilir, ham piksel olarak doner
 *
 * Desteklenmeyenler (JPX, CCITTFax, Indexed renk uzayi, 1 bit) atlanir; bu
 * durumda cagiran taraf kullaniciya "OCR yapilabilir goruntu bulunamadi" der.
 */
import zlib from 'node:zlib';

export interface PdfImage {
  width: number;
  height: number;
  /** Hazir kodlanmis goruntu (JPEG) — dogrudan OCR'a verilebilir. */
  jpeg?: Buffer;
  /** Ham piksel verisi — PNG'ye cevrilmesi gerekir. */
  raw?: { data: Buffer; channels: 1 | 3 | 4 };
}

/** `5 0 obj ... endobj` govdesini bulur (ICC kanal sayisi icin gerekli). */
function findObject(pdf: string, objNum: number): string | null {
  const re = new RegExp(`(?:^|[^0-9])${objNum}\\s+0\\s+obj\\b`, 'g');
  const m = re.exec(pdf);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = pdf.indexOf('endobj', start);
  return end === -1 ? pdf.slice(start) : pdf.slice(start, end);
}

/**
 * Renk uzayindan kanal sayisi.
 * ICCBased'te kanal sayisi ayri bir nesnenin `/N` alaninda durur.
 */
function channelsOf(colorSpace: string, pdf: string): 1 | 3 | 4 | null {
  if (/DeviceGray|\/CalGray/.test(colorSpace)) return 1;
  if (/DeviceRGB|\/CalRGB/.test(colorSpace)) return 3;
  if (/DeviceCMYK/.test(colorSpace)) return 4;

  const icc = /ICCBased\s+(\d+)\s+0\s+R/.exec(colorSpace);
  if (icc) {
    const body = findObject(pdf, Number(icc[1]));
    const n = body && /\/N\s+(\d+)/.exec(body);
    if (n) {
      const count = Number(n[1]);
      if (count === 1 || count === 3 || count === 4) return count;
    }
  }
  return null;
}

export interface ExtractOptions {
  /** Bu boyutun altindaki goruntuler atlanir (logo, imza, cizgi). */
  minSide?: number;
  /** En fazla kac goruntu dondurulecek. */
  limit?: number;
}

export function extractPdfImages(buffer: Buffer, options: ExtractOptions = {}): PdfImage[] {
  const minSide = options.minSide ?? 200;
  const limit = options.limit ?? 30;

  // latin1: bayt <-> karakter birebir eslesir, ofsetler kaymaz.
  const pdf = buffer.toString('latin1');
  const images: PdfImage[] = [];

  // Sozluk basini yakala; alanlar sirasiz olabildigi icin govde ayrica taranir.
  const dictRe = /<<((?:[^<>]|<<[^>]*>>)*?\/Subtype\s*\/Image(?:[^<>]|<<[^>]*>>)*?)>>\s*stream\r?\n/g;

  let match: RegExpExecArray | null;
  while ((match = dictRe.exec(pdf)) !== null && images.length < limit) {
    const dict = match[1];

    const width = Number(/\/Width\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const height = Number(/\/Height\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const length = Number(/\/Length\s+(\d+)/.exec(dict)?.[1] ?? 0);
    const bits = Number(/\/BitsPerComponent\s+(\d+)/.exec(dict)?.[1] ?? 8);

    if (!width || !height || !length) continue;
    if (width < minSide || height < minSide) continue;
    if (bits !== 8) continue; // 1 bit siyah-beyaz ve 16 bit desteklenmiyor

    const start = match.index + match[0].length;
    const body = buffer.subarray(start, start + length);

    if (/\/DCTDecode/.test(dict)) {
      images.push({ width, height, jpeg: Buffer.from(body) });
      continue;
    }

    if (!/\/FlateDecode/.test(dict)) continue;

    const colorSpace = /\/ColorSpace\s*(\[[^\]]*\]|\/[A-Za-z]+)/.exec(dict)?.[1] ?? '';
    const channels = channelsOf(colorSpace, pdf);
    if (!channels) continue;

    let data: Buffer;
    try {
      data = zlib.inflateSync(body);
    } catch {
      continue; // bozuk ya da beklenenden farkli kodlanmis akis
    }

    const expected = width * height * channels;
    if (data.length < expected) continue;

    images.push({ width, height, raw: { data: data.subarray(0, expected), channels } });
  }

  return images;
}
