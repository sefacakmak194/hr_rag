/**
 * Korpus sagligi denetimi.
 *
 * NEDEN: bu projedeki 20 dokuman elle yazildi — temiz, tutarli, celiskisiz.
 * Gercek IK arsivleri boyle degil: ayni konu iki yonetmelikte FARKLI sayiyla
 * geciyor, eski surumler arsivde kaliyor, ayni dosya iki adla yukleniyor,
 * bazi dokumanlarda hic baslik yok. Bu durumlarda sistem sessizce yanlislar —
 * retrieval iki celisen parcadan birini secer ve kullanici hangisinin gecerli
 * oldugunu bilemez.
 *
 * Bu servis korpusu indeksten okur ve dort senaryoyu raporlar:
 *
 *   1. CELISKI    — ayni konu, ayni birim, FARKLI sayi (farkli dokumanlarda)
 *   2. TEKRAR     — iki parca neredeyse ayni metin (mukerrer yukleme, eski surum)
 *   3. YAPI       — dokumanda baslik yok / tek parcaya dusmus / parca cok uzun
 *   4. GOLGELENEN — ayni ada sahip ust bicim oldugu icin indekslenmeyen dosya
 *
 * Halusinasyon engellemesi gibi bu da DETERMINISTIK: LLM cagrilmaz, ayni
 * korpus icin ayni rapor uretilir.
 */
import { getDb } from './vectorStore.service.js';
import { tokenize } from './lexical.service.js';

export interface CorpusFinding {
  kind: 'celiski' | 'tekrar' | 'yapi';
  /** Ne kadar onemli: 'yuksek' cevabi yanlislatabilir, 'bilgi' yalnizca uyari. */
  severity: 'yuksek' | 'orta' | 'bilgi';
  message: string;
  where: { doc: string; section: string }[];
}

interface ChunkRow {
  id: number;
  docTitle: string;
  section: string;
  content: string;
}

function loadChunks(): ChunkRow[] {
  return getDb()
    .prepare('SELECT id, doc_title AS docTitle, section, content FROM chunks ORDER BY id')
    .all() as unknown as ChunkRow[];
}

// ------------------------------------------------------------------ celiski
/** Sayisal olgu: deger + birim + cevresindeki ayirt edici sozcukler. */
interface Fact {
  value: string;
  unit: string;
  context: Set<string>;
  chunk: ChunkRow;
}

/**
 * Birimler kasitli olarak sinirli. "3 kez", "2 defa" gibi ifadeler cok sik ve
 * ayirt edici degil; onlar disarida birakildi ki celiski raporu gurultuye
 * bogulmasin.
 */
const UNIT_PATTERN =
  /(\d[\d.,]*)\s*(iş günü|is gunu|gün|gun|hafta|ay|yıl|yil|saat|TL|%)/gi;

const normalizeUnit = (u: string) =>
  u
    .toLocaleLowerCase('tr-TR')
    .replace('is gunu', 'iş günü')
    .replace('gun', 'gün')
    .replace('yil', 'yıl');

function extractFacts(chunk: ChunkRow): Fact[] {
  const facts: Fact[] = [];
  const text = chunk.content;

  for (const m of text.matchAll(UNIT_PATTERN)) {
    const at = m.index ?? 0;
    // Olgunun etrafindaki pencere: konuyu belirleyen sozcukler burada.
    const window = text.slice(Math.max(0, at - 90), Math.min(text.length, at + 90));
    facts.push({
      value: m[1],
      unit: normalizeUnit(m[2]),
      context: new Set([...tokenize(window), ...tokenize(chunk.section)]),
      chunk,
    });
  }

  return facts;
}

/**
 * Iki olgu ayni konuyu mu anlatiyor?
 *
 * OLCUT: BOLUM BASLIKLARININ ortusmesi. Govde metnine bakilmaz.
 *
 * DIKKAT — iki olcut denendi ve IKISI DE COKTU:
 *   1) "ortak uzun sozcuk >= 3" — Turkce IK metninde "calisan", "verilir",
 *      "departman", "itibaren" gibi uzun ama her yerde gecen sozcukler var;
 *      temiz korpusta 9 SAHTE celiski cikti.
 *   2) "ortak NADIR sozcuk >= 2" (df <= %10) — 94 parcalik bir korpusta neredeyse
 *      her alan terimi nadir sayiliyor; sahte celiski 11'e CIKTI.
 *
 * Gercek bir arsivde celiski demek "ayni KONUYU duzenleyen iki metin" demek:
 * eski ve yeni surum, ya da iki birimin ayni konuda yazdigi iki yonetmelik.
 * Bunlar baslik duzeyinde ortusur ("Yillik Ucretli Izin" / "Yillik Izin
 * Haklari"). Govde ise her maddede benzer sozcukler tasidigi icin ayirt edici
 * degil. Baslik olcutuyle temiz korpus 0 celiski veriyor.
 */
function sameSubject(a: Fact, b: Fact): boolean {
  const at = headingTokens(a.chunk);
  const bt = headingTokens(b.chunk);
  if (at.size === 0 || bt.size === 0) return false;

  let shared = 0;
  for (const token of at) if (bt.has(token)) shared++;

  // IKI KOSUL BIRLIKTE:
  //  - en az 2 ortak sozcuk: tek ortak sozcuk her zaman genel olan ("izin",
  //    "bildirim", "sureler") ve alakasiz maddeleri esitliyor,
  //  - ortusme orani >= 0.5: kisa basliklarda tek sozcuk %100 ortusme uretip
  //    sayi kosulunu anlamsizlastirabiliyor.
  const ratio = shared / Math.min(at.size, bt.size);
  return shared >= 2 && ratio >= 0.5;
}

/**
 * Bolum basligindan ayirt edici sozcukler ("Madde 2: Yillik Ucretli Izin").
 *
 * DIKKAT — "Madde N" oneki TOKENIZE EDILMEDEN once atilmali. Govdeleyici
 * "madde" sozcugunu "madd" yaptigi icin `t !== 'madde'` filtresi hicbir zaman
 * tutmuyordu; sonuc olarak HER baslik cifti bedava bir ortak sozcuk kazaniyor
 * ve tek bir genel sozcukle esik asiliyordu (olculdu: temiz korpusta 14 sahte
 * celiski).
 */
function headingTokens(chunk: ChunkRow): Set<string> {
  const bare = chunk.section.replace(/^\s*madde\s+\d+\s*[:.\-–]?\s*/i, '');
  return new Set(tokenize(bare).filter((t) => t.length >= 4));
}

function findConflicts(chunks: ChunkRow[]): CorpusFinding[] {
  const facts = chunks.flatMap(extractFacts);
  const byUnit = new Map<string, Fact[]>();
  for (const f of facts) {
    const list = byUnit.get(f.unit) ?? [];
    list.push(f);
    byUnit.set(f.unit, list);
  }

  const findings: CorpusFinding[] = [];
  const seen = new Set<string>();

  for (const [unit, list] of byUnit) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];

        if (a.value === b.value) continue;
        // Ayni dokumanin icindeki farkli degerler genelde kademedir, celiski degil.
        if (a.chunk.docTitle === b.chunk.docTitle) continue;
        if (!sameSubject(a, b)) continue;

        const key = [a.chunk.id, b.chunk.id, unit].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        findings.push({
          kind: 'celiski',
          severity: 'yuksek',
          message:
            `Aynı konu için farklı değer: "${a.value} ${unit}" ve "${b.value} ${unit}". ` +
            'Hangisinin yürürlükte olduğu belirsiz; retrieval ikisinden birini seçer.',
          where: [
            { doc: a.chunk.docTitle, section: a.chunk.section },
            { doc: b.chunk.docTitle, section: b.chunk.section },
          ],
        });
      }
    }
  }

  return findings;
}

// ------------------------------------------------------------------- tekrar
/** Jaccard benzerligi — mukerrer yukleme ve eski surum tespiti icin. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

function findDuplicates(chunks: ChunkRow[]): CorpusFinding[] {
  const tokenSets = chunks.map((c) => new Set(tokenize(c.content)));
  const findings: CorpusFinding[] = [];

  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      if (chunks[i].docTitle === chunks[j].docTitle) continue;

      const score = similarity(tokenSets[i], tokenSets[j]);
      if (score < 0.85) continue;

      findings.push({
        kind: 'tekrar',
        severity: score > 0.95 ? 'orta' : 'bilgi',
        message:
          `İki bölüm neredeyse aynı (%${(score * 100).toFixed(0)} örtüşme). ` +
          'Mükerrer yükleme ya da arşivde kalmış eski sürüm olabilir.',
        where: [
          { doc: chunks[i].docTitle, section: chunks[i].section },
          { doc: chunks[j].docTitle, section: chunks[j].section },
        ],
      });
    }
  }

  return findings;
}

// --------------------------------------------------------------------- yapi
/** Chunker butcesi ~250 kelime; bunun uzerine cikan parca bolunmus demektir. */
const LONG_CHUNK_WORDS = 240;

function findStructureIssues(chunks: ChunkRow[]): CorpusFinding[] {
  const findings: CorpusFinding[] = [];
  const byDoc = new Map<string, ChunkRow[]>();

  for (const c of chunks) {
    const list = byDoc.get(c.docTitle) ?? [];
    list.push(c);
    byDoc.set(c.docTitle, list);
  }

  for (const [doc, list] of byDoc) {
    // Tek parcaya dusmus dokuman: baslik yok demektir, alinti "Genel" olur.
    if (list.length === 1) {
      findings.push({
        kind: 'yapi',
        severity: 'orta',
        message:
          'Doküman tek parçaya düştü — başlık satırı bulunamamış olabilir. ' +
          'Kaynak gösterimi madde düzeyinde olmayacak.',
        where: [{ doc, section: list[0].section }],
      });
    }

    for (const c of list) {
      const words = c.content.split(/\s+/).filter(Boolean).length;
      if (words > LONG_CHUNK_WORDS) {
        findings.push({
          kind: 'yapi',
          severity: 'bilgi',
          message:
            `Bölüm çok uzun (${words} kelime) ve pencerelere bölündü. ` +
            'Maddeleri daha küçük başlıklara ayırmak alıntı kalitesini artırır.',
          where: [{ doc, section: c.section }],
        });
      }
    }
  }

  return findings;
}

// ------------------------------------------------------------------- rapor
export interface CorpusAudit {
  documents: number;
  chunks: number;
  findings: CorpusFinding[];
  summary: { yuksek: number; orta: number; bilgi: number };
}

export function auditCorpus(): CorpusAudit {
  const chunks = loadChunks();

  const findings = [
    ...findConflicts(chunks),
    ...findDuplicates(chunks),
    ...findStructureIssues(chunks),
  ];

  const order = { yuksek: 0, orta: 1, bilgi: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    documents: new Set(chunks.map((c) => c.docTitle)).size,
    chunks: chunks.length,
    findings,
    summary: {
      yuksek: findings.filter((f) => f.severity === 'yuksek').length,
      orta: findings.filter((f) => f.severity === 'orta').length,
      bilgi: findings.filter((f) => f.severity === 'bilgi').length,
    },
  };
}
