/**
 * Degerlendirme icin YALITILMIS sunucu.
 *
 * NEDEN VAR: `npm run eval` 48 vaka kosuyor ve her vaka bir denetim satiri
 * yaziyor. Calisan sunucuya karsi kosturuldugunda bu satirlar KULLANICININ
 * gercek denetim kaydina dusuyordu — olculdu: tek kosum 70+ satir birakti,
 * hepsi `eval-gecici-...` adiyla. Denetim kaydi silinemez oldugu icin bu
 * gurultu kalicidir.
 *
 * COZUM: eval kendi sunucusunu, veritabaninin ANLIK KOPYASI uzerinde ayaga
 * kaldirir. Kosum bitince kopya da sunucu da silinir; gercek veritabani hic
 * dokunulmamis kalir.
 *
 * KOPYA `VACUUM INTO` ile alinir, dosya kopyalayarak DEGIL. Sunucu ayni dosyayi
 * acik tutarken duz kopya, yazma ortasina denk gelirse yirtik bir dosya
 * uretebilir. `VACUUM INTO` SQLite'in kendi tutarli anlik goruntu mekanizmasi;
 * olculdu: 94 parcalik veritabani icin 18 ms.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');

/**
 * `npx.cmd` Windows'ta spawn edilemez (Node 20+ `.cmd` icin `shell: true`
 * ister, o da DEP0190 uyarisi uretir). tsx'in JS giris noktasi node ile
 * dogrudan calistiriliyor — compare-models de ayni yolu kullaniyor.
 */
const TSX_CLI = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Isletim sisteminden bos bir port ister ve hemen birakir. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export interface EvalSandbox {
  base: string;
  dbPath: string;
  /** Hazir oturum cerezi — hesap kopyaya, sunucu ACILMADAN ONCE yazilir. */
  cookie: string;
  stop: () => Promise<void>;
}

/**
 * Veritabaninin anlik kopyasi uzerinde bir sunucu baslatir.
 *
 * `sourceDb` verilmezse `DB_PATH` ya da varsayilan `data/vectors.db` kullanilir.
 */
export async function startEvalSandbox(sourceDb?: string): Promise<EvalSandbox> {
  const source = sourceDb ?? process.env.DB_PATH ?? path.join(ROOT, 'data', 'vectors.db');
  if (!fs.existsSync(source)) {
    throw new Error(`Veritabani bulunamadi: ${source}. Once \`npm run ingest\` calistirin.`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-eval-'));
  const dbPath = path.join(dir, 'eval.db');

  // Tutarli anlik kopya. Yol SQL icine gomuluyor; tirnak ikilenerek kacisliyor.
  const src = new DatabaseSync(source, { readOnly: true });
  try {
    src.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  // OTURUM, SUNUCU ACILMADAN ONCE kopyaya yazilir.
  //
  // Boylece ayni dosyaya iki surecten es zamanli yazma hic olmaz — sunucu
  // ayaktayken ikinci bir baglantidan INSERT atmak SQLITE_BUSY riski tasirdi.
  // Hesap kopyayla birlikte silinecegi icin ayrica temizlik gerekmiyor.
  const { createUser, createSession } = await import('../server/src/services/identity.service.js');
  const snapshot = new DatabaseSync(dbPath);
  let cookie: string;
  try {
    const user = createUser(snapshot, {
      username: `eval-gecici-${Math.random().toString(36).slice(2, 10)}`,
      displayName: 'Degerlendirme (gecici)',
      password: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      // Tum korpusu gorebilmeli: vakalar erisim etiketine gore degil, cevap
      // kalitesine gore olculuyor.
      role: 'yonetici',
    });
    cookie = `hr_session=${createSession(snapshot, {
      userId: user.id,
      username: user.username,
      role: user.role,
    })}`;
  } finally {
    snapshot.close();
  }

  const port = await freePort();

  const child: ChildProcess = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      // Butunluk katmani anahtar uretir ve arsiv yazar; onlar da yalitilir ki
      // gercek `data/` dizinine dokunmasin.
      ARCHIVE_DIR: path.join(dir, 'arsiv'),
      AUDIT_KEY_PATH: path.join(dir, 'audit-signing.key'),
      AUDIT_PUBLIC_KEY_PATH: path.join(dir, 'audit-public.pem'),
      // Bekleyen surumler de gercek dizine yazilmasin.
      PENDING_DIR: path.join(dir, 'pending'),
    },
    stdio: 'ignore',
    windowsHide: true,
  });

  const base = `http://127.0.0.1:${port}`;

  const stop = async () => {
    child.kill();
    // Windows'ta ara surec dogabiliyor; port serbest kalana kadar bekle.
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      } catch {
        break;
      }
      await sleep(500);
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows'ta SQLite kilidi kalabilir; gecici dizin isletim sistemince
      // temizlenir.
    }
  };

  // Saglik bekle. Embedding modelinin isinmasi ayrica surer; ilk vaka bunu
  // tetikler, bu yuzden cagiran taraf bir isinma vakasi kosturmali.
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(`Yalitilmis sunucu baslatilamadi (cikis kodu ${child.exitCode}).`);
    }
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return { base, dbPath, cookie, stop };
    } catch {
      /* henuz ayakta degil */
    }
    await sleep(750);
  }

  await stop();
  throw new Error('Yalitilmis sunucu 60 saniyede hazir olmadi.');
}
