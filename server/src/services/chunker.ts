import { CHUNK_SIZE, CHUNK_OVERLAP } from '../config/constants.js';

export interface Chunk {
  text: string;
  sectionHeading: string;
  /** Dokumanin H1 basligi — embedding'e konu sinyali olarak eklenir. */
  documentTitle: string;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

/**
 * Token sayimi yaklasimi: yerel bir tokenizer'a bagimli kalmamak icin
 * kelime bazli sayim kullanilir. Turkce icin ~1 kelime ≈ 1.4 token oldugundan
 * chunkSize kelime cinsinden bu katsayiyla olceklenir.
 */
const WORDS_PER_TOKEN = 1 / 1.4;

const toWordBudget = (tokens: number) => Math.max(1, Math.round(tokens * WORDS_PER_TOKEN));

/**
 * Markdown basliklarina gore akilli parcalama.
 *
 * Once dokuman `##` (Madde) basliklarina bolunur; boylece her parca tek bir
 * maddeye ait kalir ve alinti (citation) dogrudan madde basligina isaret eder.
 * Bir madde kelime butcesini asarsa, kendi icinde overlap'li pencerelere bolunur.
 */
export function extractChunks(content: string, options: ChunkOptions = {}): Chunk[] {
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const overlap = options.overlap ?? CHUNK_OVERLAP;

  const maxWords = toWordBudget(chunkSize);
  const overlapWords = Math.min(toWordBudget(overlap), maxWords - 1);

  const lines = content.split(/\r?\n/);

  let docTitle = '';
  let currentHeading = '';
  let buffer: string[] = [];
  const sections: Chunk[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      sections.push({
        text,
        sectionHeading: currentHeading || docTitle || 'Genel',
        documentTitle: docTitle,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const h1 = /^#\s+(.*)$/.exec(line);
    const h2 = /^#{2,}\s+(.*)$/.exec(line);

    if (h1) {
      flush();
      docTitle = h1[1].trim();
      currentHeading = docTitle;
      continue;
    }
    if (h2) {
      flush();
      currentHeading = h2[1].trim();
      buffer.push(line.replace(/^#+\s+/, '').trim());
      continue;
    }
    buffer.push(line);
  }
  flush();

  // Butceyi asan bolumleri overlap'li pencerelere ayir.
  const chunks: Chunk[] = [];
  for (const section of sections) {
    const words = section.text.split(/\s+/).filter(Boolean);

    if (words.length <= maxWords) {
      chunks.push(section);
      continue;
    }

    const step = maxWords - overlapWords;
    for (let start = 0; start < words.length; start += step) {
      const window = words.slice(start, start + maxWords);
      if (!window.length) break;
      chunks.push({
        text: window.join(' '),
        sectionHeading: section.sectionHeading,
        documentTitle: section.documentTitle,
      });
      if (start + maxWords >= words.length) break;
    }
  }

  return chunks;
}
