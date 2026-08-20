import fs from 'node:fs';
import path from 'node:path';
import { extractChunks } from './chunker.js';
import { readDocument, selectIndexableFiles } from './documentReader.service.js';
import { generateEmbedding } from './embedding.service.js';
import { insertChunk, resetStore, countChunks, resetLexicalIndex, getDb } from './vectorStore.service.js';
import { upsertDocumentMeta } from './identity.service.js';
import { resetDiacriticsSozluk } from './diacritics.service.js';
import { recordVersion } from './versioning.service.js';
import { CHUNK_SIZE, CHUNK_OVERLAP } from '../config/constants.js';

export interface IngestedFile {
  file: string;
  chunks: number;
  /** Bu dosyanin yururlukteki surum numarasi. */
  version: number;
  /** Bu kosumda YENI surum acildi mi? (icerik degismisse) */
  versionCreated: boolean;
}

export interface IngestionReport {
  files: IngestedFile[];
  totalChunks: number;
  /** Bu kosumda surum acilan dokumanlar. */
  changed: string[];
}

export interface IngestionOptions {
  /** Surum kaydina yazilacak kullanici adi. Betiklerde 'sistem'. */
  actor?: string;
  /**
   * Dosya adina gore surum ustverisi. YALNIZCA yeni surum acilirsa kullanilir;
   * icerik degismemisse not ve tarih bir sey ifade etmez.
   */
  versionMeta?: Record<string, { note?: string; effectiveFrom?: string }>;
}

/**
 * Korpus dizinindeki tum .md dokumanlarini parcalara ayirir, yerel embedding
 * uretir ve vektor veritabanina yazar. Tamamen cevrim disi calisir.
 *
 * SURUMLEME (Sprint 2): her dosyanin metni indekslenmeden once surum kaydina
 * verilir. Icerik ozeti yururlukteki surumden farkliysa yeni surum acilir.
 * Boylece korpus dizinine ELLE kopyalanan bir dosya da gecmise yazilir —
 * surum gecmisi arayuzden gecilmis olmaya degil, INDEKSLENMIS OLANA dayanir.
 */
export async function runIngestion(
  corpusDir: string,
  options: IngestionOptions = {},
): Promise<IngestionReport> {
  if (!fs.existsSync(corpusDir)) {
    throw new Error(`Korpus dizini bulunamadi: ${corpusDir}`);
  }

  // Desteklenen bicimler ve ayni ada sahip dosyalarda oncelik sirasi
  // documentReader icinde tek yerde tanimli (.md > .docx > .pdf).
  const all = fs.readdirSync(corpusDir).sort();
  const files = selectIndexableFiles(all);

  if (!files.length) {
    throw new Error(`Korpus dizininde .md, .docx veya .pdf dokumani yok: ${corpusDir}`);
  }

  // Yeniden indeksleme her seferinde temiz baslar (tekrar kayit olusmaz).
  resetStore();
  resetLexicalIndex();
  // Korpus degisti: Turkce onarim sozlugu de korpustan turetiliyor.
  resetDiacriticsSozluk();

  const report: IngestionReport = { files: [], totalChunks: 0, changed: [] };
  const db = getDb();
  const actor = options.actor ?? 'sistem';

  for (const file of files) {
    const filePath = path.join(corpusDir, file);
    const read = await readDocument(filePath);
    const content = read.text;

    if (!content.trim()) {
      console.warn(`[Ingest Skip]: ${file} (metin cikarilamadi${read.ocrNote ? ` — ${read.ocrNote}` : ''})`);
      continue;
    }
    if (read.source === 'pdf-ocr') {
      console.log(`[Ingest OCR]: ${file} (taranmis PDF, metin OCR ile cikarildi)`);
    }

    // SURUM KAYDI — indekslemeden ONCE. Sebep: indeksleme yarida kalirsa
    // (embedding hatasi, disk dolmasi) surum kaydi yine de dogru olsun;
    // korpustaki dosya zaten degismis durumda.
    const { row: version, created } = recordVersion(db, {
      docTitle: file,
      content,
      source: read.source,
      bytes: fs.statSync(filePath).size,
      actor,
      ...options.versionMeta?.[file],
    });
    upsertDocumentMeta(db, file, read.source);
    if (created) report.changed.push(file);

    // Markdown basliklarina gore akilli chunking (350 token, 50 overlap)
    const chunks = extractChunks(content, { chunkSize: CHUNK_SIZE, overlap: CHUNK_OVERLAP });

    for (const chunk of chunks) {
      // Embedding metnine dokuman basligi + bolum basligi eklenir ("contextual
      // chunking"). Baslik, parca govdesinde gecmeyen konu sinyalini tasir:
      // orn. "Mobbing" kelimesi yalnizca dokuman basliginda gecerken, mobbing
      // sorgusu ilgili sikayet maddesini artik dogru esliyor. Govde (content)
      // degismeden saklanir; LLM'e yalnizca asil metin gider.
      const embeddingText = [chunk.documentTitle, chunk.sectionHeading, chunk.text]
        .filter(Boolean)
        .join('\n');

      const embedding = await generateEmbedding(embeddingText);
      insertChunk({
        docTitle: file,
        section: chunk.sectionHeading,
        content: chunk.text,
        vector: embedding,
      });
    }

    report.files.push({ file, chunks: chunks.length, version: version.version, versionCreated: created });
    console.log(
      `[Ingest Complete]: ${file} (${chunks.length} chunks indexed · s${version.version}${created ? ' YENİ' : ''})`,
    );
  }

  report.totalChunks = countChunks();

  // ONBELLEKLER BIR KEZ DAHA DUSURULUR — basta dusurmek yetmiyor.
  //
  // BM25 indeksi ve Turkce onarim sozlugu tembel kuruluyor: ilk ihtiyac
  // duyulan sorguda korpustan insa edilip surec omru boyunca saklaniyorlar.
  // Yeniden indeksleme sirasinda gelen bir /api/chat istegi bu insayi YARIM
  // KORPUS uzerinde tetikliyordu; islem bitince o yarim indeks onbellekte
  // kaliyor ve sonraki aramalar eksik veriyle calisiyordu. Sondaki dusurme,
  // yarista kim kazanirsa kazansin onbellegin taze korpustan kurulmasini
  // garanti eder.
  resetLexicalIndex();
  resetDiacriticsSozluk();

  return report;
}
