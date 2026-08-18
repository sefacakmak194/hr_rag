import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  FOUNDRY_BASE_URL_OVERRIDE,
  FOUNDRY_FALLBACK_BASE_URL,
  FOUNDRY_MODEL,
} from '../config/constants.js';

const execFileAsync = promisify(execFile);

export interface FoundryHealth {
  online: boolean;
  baseUrl: string | null;
  models: string[];
  activeModel: string | null;
  discovery: 'override' | 'cli' | 'fallback' | 'none';
  error?: string;
}

interface Resolved {
  baseUrl: string;
  discovery: FoundryHealth['discovery'];
}

let cached: Resolved | null = null;
let cachedModelId: string | null = null;

/** Kesfedilen uc noktayi unutur; Foundry yeniden baslatilip port degistiginde gerekir. */
function invalidate(): void {
  cached = null;
  cachedModelId = null;
}

/**
 * `foundry server status -o json` ciktisindan aktif daemon adresini okur.
 * Ornek: {"running":true,"state":"ready","webUrls":["http://127.0.0.1:57617"], ...}
 */
async function discoverViaCli(): Promise<string | null> {
  try {
    // shell:true kullanilmaz (DEP0190 uyarisi + argumanlar escape edilmez);
    // Windows'ta .exe uzantisi acikca verilerek PATH'ten dogrudan calistirilir.
    const bin = process.platform === 'win32' ? 'foundry.exe' : 'foundry';
    const { stdout } = await execFileAsync(bin, ['server', 'status', '-o', 'json'], {
      timeout: 15_000,
      windowsHide: true,
    });

    const parsed = JSON.parse(stdout.trim()) as { running?: boolean; webUrls?: string[] };
    if (!parsed.running || !parsed.webUrls?.length) return null;

    return `${parsed.webUrls[0].replace(/\/+$/, '')}/v1`;
  } catch {
    return null;
  }
}

/** Adayin gercekten OpenAI uyumlu bir uc oldugunu dogrular. */
async function probe(baseUrl: string, timeoutMs: number): Promise<string[] | null> {
  try {
    const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id);
  } catch {
    return null;
  }
}

/**
 * Uc noktayi sirayla cozer: acik override -> CLI kesfi -> sartname varsayilani.
 * Basarili aday onbelleklenir; baglanti koptugunda onbellek temizlenir.
 */
async function resolveEndpoint(timeoutMs: number): Promise<{ resolved: Resolved; models: string[] } | null> {
  const candidates: Resolved[] = [];

  if (FOUNDRY_BASE_URL_OVERRIDE) {
    candidates.push({ baseUrl: FOUNDRY_BASE_URL_OVERRIDE, discovery: 'override' });
  } else {
    if (cached) candidates.push(cached);
    const discovered = await discoverViaCli();
    if (discovered && discovered !== cached?.baseUrl) {
      candidates.push({ baseUrl: discovered, discovery: 'cli' });
    }
    candidates.push({ baseUrl: FOUNDRY_FALLBACK_BASE_URL, discovery: 'fallback' });
  }

  for (const candidate of candidates) {
    const models = await probe(candidate.baseUrl, timeoutMs);
    if (models) {
      cached = candidate;
      return { resolved: candidate, models };
    }
  }

  invalidate();
  return null;
}

/** Foundry Local calisiyor mu, hangi modeller yuklu? Yalnizca localhost'a istek atar. */
export async function checkFoundryHealth(timeoutMs = 4000): Promise<FoundryHealth> {
  const found = await resolveEndpoint(timeoutMs);

  if (!found) {
    return {
      online: false,
      baseUrl: FOUNDRY_BASE_URL_OVERRIDE ?? null,
      models: [],
      activeModel: null,
      discovery: 'none',
      error: 'Foundry Local daemon bulunamadi.',
    };
  }

  const { resolved, models } = found;

  // Katalog adi ile yuklu model kimligi birebir eslesmeyebilir (or. phi-3.5-mini
  // -> Phi-3.5-mini-instruct-generic-cpu). Sirayla: tam -> buyuk/kucuk harf duyarsiz
  // tam -> kismi eslesme.
  //
  // NOT: /models ucu yalnizca BELLEGE YUKLU olani degil, ONBELLEKTEKI tum varyantlari
  // listeler. Ayni takma ad altinda birden fazla varyant (trtrtx / cuda / cpu) cikabilir
  // ve bunlarin bir kismi makineye gore bozuk olabilir. Bu yuzden calisan varyanti
  // FOUNDRY_MODEL ile TAM kimligini vererek sabitlemek onerilir (bkz. .env.example).
  const lower = FOUNDRY_MODEL.toLowerCase();
  cachedModelId =
    models.find((m) => m === FOUNDRY_MODEL) ??
    models.find((m) => m.toLowerCase() === lower) ??
    models.find((m) => m.toLowerCase().includes(lower)) ??
    models[0] ??
    null;

  return {
    online: true,
    baseUrl: resolved.baseUrl,
    models,
    activeModel: cachedModelId,
    discovery: resolved.discovery,
  };
}

export class FoundryOfflineError extends Error {
  constructor(detail: string) {
    super(
      `Microsoft Foundry Local calismiyor (${detail}). ` +
        `Baslatmak icin: foundry model run ${FOUNDRY_MODEL}`,
    );
    this.name = 'FoundryOfflineError';
  }
}

async function requireEndpoint(): Promise<{ baseUrl: string; model: string }> {
  const health = await checkFoundryHealth();
  if (!health.online || !health.baseUrl) {
    throw new FoundryOfflineError(health.error ?? 'baglanti kurulamadi');
  }
  if (!health.activeModel) {
    throw new FoundryOfflineError('daemon calisiyor fakat yuklu model yok');
  }
  return { baseUrl: health.baseUrl, model: health.activeModel };
}

/**
 * Foundry Local'in OpenAI uyumlu /chat/completions ucundan token akisi alir.
 * SSE govdesi ayristirilarak her delta bir token olarak yield edilir.
 */
export async function* streamFromFoundryLocal(
  systemPrompt: string,
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): AsyncGenerator<string> {
  const { baseUrl, model } = await requireEndpoint();

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        // Sicaklik 0: bu bir mevzuat asistani, ayni soruya ayni cevabi vermeli.
        //
        // Onceki deger 0.1 idi ve GORUNMEZ bir kararsizlik yaratiyordu: eval
        // paketi ard arda kosumlarda 48/48, 45/48, 45/48 verdi ve BASARISIZ
        // VAKALAR HER SEFERINDE DEGISTI (amb-3/amb-5 bir kosumda, num-12/amb-13
        // digerinde). Yani bazi vakalar sinirdaydi ve olcum gurultuluydu;
        // duzeltilen sey sanilan hatalarin bir kismi aslinda ornekleme
        // gurultusuydu. 0 hem dogru urun davranisi hem de olculebilir bir hat.
        temperature: 0,
        top_p: 1,
        max_tokens: 800,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: userMessage },
        ],
      }),
    });
  } catch (error) {
    invalidate(); // port degismis olabilir; sonraki denemede yeniden kesfet
    throw new FoundryOfflineError((error as Error).message);
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Foundry Local hatasi: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    // AKIS ORTASINDA KOPMA — olculdu ve kullaniciya yanlis mesaj gosteriyordu.
    //
    // Yukaridaki try/catch yalnizca BAGLANTI KURULURKEN olusan hatayi yakalar.
    // Foundry daemon'i baglantiyi kabul edip sonra dusurdugunde ("SocketError:
    // other side closed") hata buradan ham sekilde cikiyordu: uc nokta onbellegi
    // temizlenmiyor ve kullanici FOUNDRY_OFFLINE yerine genel "islem sirasinda
    // bir hata olustu" mesajini goruyordu.
    //
    // Daemon uzun sure ayakta kalip model yukle/at dongusu yasadiginda tam
    // olarak bu davranisi gosteriyor (bkz. README, "Yanitlar birden yavasladi").
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (error) {
      invalidate(); // port degismis ya da daemon yeniden baslamis olabilir
      throw new FoundryOfflineError(
        `Foundry Local bağlantısı yanıt ortasında kesildi (${(error as Error).message}). ` +
          'Servisi yeniden başlatın: foundry server restart',
      );
    }

    const { done, value } = chunk;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;

      try {
        const parsed = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // Kismi/bozuk SSE satirlarini yok say.
      }
    }
  }
}
