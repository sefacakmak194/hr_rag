/**
 * Korpus indeksleme giris noktasi.
 * Kullanim:  cd server && npm run ingest
 */
import { runIngestion } from '../server/src/services/ingestion.service.js';
import { CORPUS_DIR, DB_PATH, EMBEDDING_MODEL } from '../server/src/config/constants.js';

const started = Date.now();

console.log('\n  Private HR RAG — Yerel Indeksleme');
console.log(`  Korpus   : ${CORPUS_DIR}`);
console.log(`  Veritabani: ${DB_PATH}`);
console.log(`  Embedding : ${EMBEDDING_MODEL} (on-device / ONNX)\n`);

try {
  const report = await runIngestion(CORPUS_DIR);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n  Toplam ${report.files.length} dokuman, ${report.totalChunks} parca indekslendi (${seconds}s).`);
  console.log('  Sonraki adim: npm start (API) + client dizininde npm run dev (UI)\n');
} catch (error) {
  console.error('\n  Indeksleme basarisiz:', (error as Error).message, '\n');
  process.exit(1);
}
