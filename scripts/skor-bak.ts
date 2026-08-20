/** Tek sorgunun kapi skorunu ve en iyi parcasini gosterir. Tani amacli. */
import { generateQueryEmbedding } from '../server/src/services/embedding.service.js';
import { scoreAllChunks, SYSTEM_PRINCIPAL } from '../server/src/services/vectorStore.service.js';
import { expandQuery } from '../server/src/services/synonym.service.js';
import { SIMILARITY_THRESHOLD, LEXICAL_WEIGHT } from '../server/src/config/constants.js';

for (const q of process.argv.slice(2)) {
  const arama = expandQuery(q);
  const v = await generateQueryEmbedding(arama);
  const scored = scoreAllChunks(v, arama, SYSTEM_PRINCIPAL);
  let best = { s: -Infinity, doc: '', sec: '' };
  for (const c of scored) {
    const s = (1 - LEXICAL_WEIGHT) * c.vectorScore + LEXICAL_WEIGHT * c.lexicalScore;
    if (s > best.s) best = { s, doc: c.docTitle, sec: c.section };
  }
  const gecti = best.s >= SIMILARITY_THRESHOLD ? 'GECER' : 'KALIR';
  console.log(`  ${best.s.toFixed(4)} ${gecti}  ${q}`);
  console.log(`           → ${best.doc} · ${best.sec}`);
}
