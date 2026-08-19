/**
 * Satir duzeyinde surum karsilastirmasi (Sprint 2).
 *
 * NEDEN KENDI YAZILIYOR: air-gapped kurulumda her yeni bagimlilik bir yuktur
 * (`diff` paketi ~200 KB ve tedarik zinciri yuzeyi acar). Ihtiyac duyulan sey
 * standart LCS; mevzuat dokumanlari birkac yuz satir oldugundan basit ve
 * okunabilir bir uygulama yeterli.
 *
 * TASARIM: once ORTAK BAS ve ORTAK SON kirpilir, LCS yalnizca ortada kalan
 * bloga uygulanir. Gercek mevzuat degisikligi tipik olarak birkac satiri
 * etkiler; bu kirpma 300 satirlik bir dokumani cogu zaman 10 satirlik bir
 * probleme indirir.
 */

export type DiffKind = 'ayni' | 'eklendi' | 'silindi' | 'atlandi';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** `atlandi` icin: gizlenen degismemis satir sayisi. */
  count?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /**
   * Metin LCS icin fazla buyuktu; karsilastirma satir satir degil BLOK olarak
   * yapildi (eski metnin tamami silindi + yeni metnin tamami eklendi).
   */
  truncated: boolean;
}

/**
 * LCS tablosu icin hucre tavani.
 *
 * 4M hucre x 4 bayt = 16 MB. Ustunde kalan dokumanlarda satir duzeyinde
 * karsilastirma yapmak yerine acikca "blok degisiklik" raporlanir — sessizce
 * dakikalarca calisip istegi asili birakmaktansa durumu soylemek dogru.
 */
const MAX_CELLS = 4_000_000;

/** Degismemis blogun kirpilmadan gosterilecek satir sayisi (baglam). */
const CONTEXT = 2;

const splitLines = (text: string): string[] => text.replace(/\r\n/g, '\n').split('\n');

export function diffLines(oldText: string, newText: string): DiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // Ortak bas
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  // Ortak son (basla cakismadan)
  let endA = a.length;
  let endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(head, endA);
  const midB = b.slice(head, endB);

  const ops: DiffLine[] = a.slice(0, head).map((text) => ({ kind: 'ayni' as const, text }));
  let truncated = false;

  if (midA.length * midB.length > MAX_CELLS) {
    truncated = true;
    for (const text of midA) ops.push({ kind: 'silindi', text });
    for (const text of midB) ops.push({ kind: 'eklendi', text });
  } else {
    ops.push(...lcsDiff(midA, midB));
  }

  for (const text of a.slice(endA)) ops.push({ kind: 'ayni', text });

  const added = ops.filter((o) => o.kind === 'eklendi').length;
  const removed = ops.filter((o) => o.kind === 'silindi').length;

  return { lines: collapseUnchanged(ops), added, removed, truncated };
}

/**
 * Klasik LCS: once tablo, sonra ileri yonlu yurume.
 *
 * `Int32Array` kullaniliyor — normal dizi ayni tabloda birkac kat fazla bellek
 * tutar ve bu fonksiyon her diff isteginde yeniden kosar.
 */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'ayni', text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      out.push({ kind: 'silindi', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'eklendi', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'silindi', text: a[i++] });
  while (j < m) out.push({ kind: 'eklendi', text: b[j++] });

  return out;
}

/**
 * Degismemis uzun bloklari tek bir `atlandi` satirina indirir.
 *
 * Degisikligin cevresinde CONTEXT kadar satir birakilir; aksi halde iki
 * kelimelik bir duzeltmeyi gormek icin 300 satir kaydirmak gerekirdi.
 */
function collapseUnchanged(ops: DiffLine[]): DiffLine[] {
  // Her `ayni` satir bir degisiklige yeterince yakin mi?
  const keep = new Array<boolean>(ops.length).fill(false);

  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind === 'ayni') continue;
    keep[i] = true;
    for (let d = 1; d <= CONTEXT; d++) {
      if (i - d >= 0) keep[i - d] = true;
      if (i + d < ops.length) keep[i + d] = true;
    }
  }

  const out: DiffLine[] = [];
  let skipped = 0;

  const flush = () => {
    if (!skipped) return;
    out.push({ kind: 'atlandi', text: `${skipped} satır değişmedi`, count: skipped });
    skipped = 0;
  };

  for (let i = 0; i < ops.length; i++) {
    if (keep[i]) {
      flush();
      out.push(ops[i]);
    } else {
      skipped++;
    }
  }
  flush();

  return out;
}
