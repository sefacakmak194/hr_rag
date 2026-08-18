import {
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  E5_QUERY_PREFIX,
  E5_PASSAGE_PREFIX,
} from '../config/constants.js';

type FeatureExtractor = (
  text: string | string[],
  opts: { pooling: 'mean' | 'cls' | 'none'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

/**
 * Embedding modelini tembel (lazy) yukler ve surec omru boyunca tekrar kullanir.
 *
 * Model ONNX Runtime uzerinde tamamen yerelde calisir. Ilk calistirmada model
 * dosyalari HuggingFace'ten indirilip ~/.cache altina yazilir (tek seferlik
 * bootstrap); sonrasinda `TRANSFORMERS_OFFLINE=1` ile tam air-gapped calisir.
 */
async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      // Uzak model sunucusuna erisimi yalnizca ilk indirmede kullan.
      env.allowLocalModels = true;
      if (process.env.TRANSFORMERS_OFFLINE === '1') {
        env.allowRemoteModels = false;
      }
      const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL, {
        dtype: 'fp32',
      });
      return pipe as unknown as FeatureExtractor;
    })();
  }
  return extractorPromise;
}

async function embed(text: string, prefix: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const output = await extractor(prefix + text.replace(/\s+/g, ' ').trim(), {
    pooling: 'mean',
    normalize: true,
  });

  const vector = Float32Array.from(output.data);
  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding boyutu beklenenden farkli: ${vector.length} (beklenen ${EMBEDDING_DIM}). ` +
        `EMBEDDING_DIM sabitini ${EMBEDDING_MODEL} modeline gore guncelleyin.`,
    );
  }
  return vector;
}

/** Indekslenecek dokuman parcasi icin embedding uretir. */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  return embed(text, E5_PASSAGE_PREFIX);
}

/** Kullanici sorgusu icin embedding uretir (E5 asimetrik prefix). */
export async function generateQueryEmbedding(text: string): Promise<Float32Array> {
  return embed(text, E5_QUERY_PREFIX);
}

/** Modeli onceden isitir; ilk sorgunun gecikmesini dusurur. */
export async function warmupEmbeddingModel(): Promise<void> {
  await generateQueryEmbedding('isinma sorgusu');
}

/** Iki normalize vektor arasindaki kosinus benzerligi. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
