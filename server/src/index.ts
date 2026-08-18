import express from 'express';
import path from 'node:path';
import { spawn } from 'node:child_process';
import chatRoute from './routes/chat.route.js';
import documentsRoute from './routes/documents.route.js';
import { checkFoundryHealth } from './services/foundryClient.service.js';
import { countChunks, listDocuments, SYSTEM_PRINCIPAL } from './services/vectorStore.service.js';
import { warmupEmbeddingModel } from './services/embedding.service.js';
import {
  SERVER_PORT,
  EMBEDDING_MODEL,
  FOUNDRY_MODEL,
  SIMILARITY_THRESHOLD,
  TOP_K,
  PUBLIC_DIR,
  HAS_STATIC_UI,
  IS_PACKAGED,
} from './config/constants.js';

const app = express();

// DIKKAT — sira onemli. Dokuman yukleme base64 govde tasir ve 1 MB'i asar;
// GLOBAL ayristirici once calistigi icin sinirin route icinde yukseltilmesi
// ISE YARAMAZ (govde zaten reddedilmis olur). Bu yuzden genis sinirli
// ayristirici o yola ONCE baglanir; body-parser govdeyi bir kez ayristirdiktan
// sonra ikinci ayristirici kendiliginden atlar.
app.use('/api/documents', express.json({ limit: '20mb' }));
app.use(express.json({ limit: '1mb' }));

// Air-gapped calisma: yalnizca yerel gelistirme istemcisine izin verilir.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/** Sistem durumu: indeks + Foundry Local runtime. */
app.get('/api/health', async (_req, res) => {
  const foundry = await checkFoundryHealth();
  let indexedChunks = 0;
  let documents: { docTitle: string; chunks: number }[] = [];
  let indexError: string | undefined;

  try {
    indexedChunks = countChunks();
    documents = listDocuments(SYSTEM_PRINCIPAL);
  } catch (error) {
    indexError = (error as Error).message;
  }

  res.json({
    status: foundry.online && indexedChunks > 0 ? 'ready' : 'degraded',
    airGapped: true,
    embeddingModel: EMBEDDING_MODEL,
    retrieval: { topK: TOP_K, similarityThreshold: SIMILARITY_THRESHOLD },
    index: { indexedChunks, documents, error: indexError },
    foundry,
  });
});

app.use('/api', chatRoute);
app.use('/api', documentsRoute);

// Paketlenmis modda arayuz de bu sunucudan servis edilir (ayri Vite gerekmez).
if (HAS_STATIC_UI) {
  app.use(express.static(PUBLIC_DIR));
  // SPA geri donusu: /api disindaki tum yollar index.html'e duser.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

app.listen(SERVER_PORT, () => {
  const url = `http://localhost:${SERVER_PORT}`;

  console.log(`\n  Private HR RAG API  →  ${url}`);
  console.log(`  Arayuz              →  ${HAS_STATIC_UI ? url : 'client dizininde `npm run dev` (http://localhost:5173)'}`);
  console.log(`  Embedding modeli    →  ${EMBEDDING_MODEL} (yerel / ONNX)`);

  try {
    console.log(`  Indekslenmis parca  →  ${countChunks()}`);
  } catch {
    console.log('  Indekslenmis parca  →  0 (once `npm run ingest` calistirin)');
  }

  // Foundry Local uc noktasi calisma aninda kesfedilir (dinamik port).
  checkFoundryHealth()
    .then((h) => {
      console.log(
        h.online
          ? `  Foundry Local       →  ${h.baseUrl} [${h.discovery}] · model: ${h.activeModel}`
          : `  Foundry Local       →  cevrimdisi (baslatmak icin: foundry model run ${FOUNDRY_MODEL})`,
      );
    })
    .catch(() => {});

  // Ilk sorgunun gecikmesini dusurmek icin embedding modelini isit.
  warmupEmbeddingModel()
    .then(() => {
      console.log('  Embedding modeli hazir.\n');
      // Paketlenmis modda kullaniciyi dogrudan arayuze goturur.
      if (IS_PACKAGED && HAS_STATIC_UI) {
        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        console.log('  Tarayici acildi. Kapatmak icin bu pencereyi kapatin.\n');
      }
    })
    .catch((e) => console.warn('  Embedding isitma basarisiz:', (e as Error).message, '\n'));
});
