import fs from 'node:fs';
import path from 'node:path';
import { extractChunks } from './chunker.js';
import { readDocument, selectIndexableFiles } from './documentReader.service.js';
import { generateEmbedding } from './embedding.service.js';
import { insertChunk, resetStore, countChunks, resetLexicalIndex } from './vectorStore.service.js';
import { CHUNK_SIZE, CHUNK_OVERLAP } from '../config/constants.js';

export interface IngestionReport {
  files: { file: string; chunks: number }[];
  totalChunks: number;
}

/**
 * Korpus dizinindeki tum .md dokumanlarini parcalara ayirir, yerel embedding
 * uretir ve vektor veritabanina yazar. Tamamen cevrim disi calisir.
 */
export async function runIngestion(corpusDir: string): Promise<IngestionReport> {
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

  const report: IngestionReport = { files: [], totalChunks: 0 };

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

    report.files.push({ file, chunks: chunks.length });
    console.log(`[Ingest Complete]: ${file} (${chunks.length} chunks indexed)`);
  }

  report.totalChunks = countChunks();
  return report;
}
