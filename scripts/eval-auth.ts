/**
 * Degerlendirme paketleri icin oturum acar.
 *
 * NEDEN GEREKLI: Sprint 1'de `/api/chat` kimlik dogrulamasi arkasina alindi.
 * `npm run eval` ve `npm run compare` o gunden beri her vakada HTTP 401
 * aliyordu — paketler kosuyor ama HICBIR SEYI olcmuyordu. Sessiz bir kayipti:
 * cikti "48 vaka KALDI" diyordu, sebep ise cevap kalitesi degil yetkisizlikti.
 *
 * IKI YOL:
 *
 *  1) EVAL_USER + EVAL_PASSWORD verilmisse normal giris yapilir. Uretim benzeri
 *     bir kurulumda dogru olan budur: paket de herkes gibi kapidan girer.
 *
 *  2) Verilmemisse GECICI bir hesap acilir, oturum alinir ve is bitince hesap
 *     da oturum da SILINIR. Boylece CI'da (bos veritabani) parola yonetmeden
 *     kosar ve geride kalici bir hesap birakmaz.
 *
 * Gecici hesabin parolasi rastgeledir ve hicbir yere yazilmaz; hesap zaten
 * kosum bitince silinir. Denetim satirlari kalir — sistem gercekten
 * sorgulandi, izinin silinmesi yanlis olurdu.
 */
import { randomBytes } from 'node:crypto';

export interface EvalSession {
  /** `Cookie:` basligi degeri; istek atmayan cagrilarda bos olabilir. */
  cookie: string;
  /** Gecici hesabi ve oturumu temizler. Kalici hesapta bir sey yapmaz. */
  close: () => void;
}

const SESSION_COOKIE = 'hr_session';

/**
 * Calisan sunucuya karsi bir oturum acar.
 *
 * Sunucuya erisilemezse ya da giris basarisiz olursa ACIKCA hata atar —
 * sessizce kimliksiz devam edip 48 vakayi 401 ile "basarisiz" saymak, bu
 * dosyanin var olma sebebi olan hatanin ta kendisi.
 */
export async function openEvalSession(base: string | null): Promise<EvalSession> {
  const user = process.env.EVAL_USER;
  const password = process.env.EVAL_PASSWORD;

  // `base` null ise (model karsilastirmasi: sunucu her model icin yeniden
  // spawn ediliyor, sabit bir adres yok) her zaman gecici hesap yolu kullanilir.
  if (base && user && password) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });

    if (!res.ok) {
      throw new Error(
        `EVAL_USER ile giris basarisiz (HTTP ${res.status}). Kullanici adi/parolayi kontrol edin.`,
      );
    }

    const setCookie = res.headers.get('set-cookie') ?? '';
    const token = /hr_session=([^;]+)/.exec(setCookie)?.[1];
    if (!token) throw new Error('Giris basarili fakat oturum cerezi donmedi.');

    return { cookie: `${SESSION_COOKIE}=${token}`, close: () => {} };
  }

  // ---------------------------------------------------------- gecici hesap
  const { getDb } = await import('../server/src/services/vectorStore.service.js');
  const { createUser, createSession } = await import('../server/src/services/identity.service.js');

  const db = getDb();
  const username = `eval-gecici-${randomBytes(4).toString('hex')}`;
  const created = createUser(db, {
    username,
    displayName: 'Degerlendirme (gecici)',
    password: randomBytes(24).toString('hex'),
    // Tum korpusu gorebilmeli: vakalar erisim etiketine gore degil, cevap
    // kalitesine gore olculuyor.
    role: 'yonetici',
  });
  const token = createSession(db, {
    userId: created.id,
    username: created.username,
    role: created.role,
  });

  return {
    cookie: `${SESSION_COOKIE}=${token}`,
    close: () => {
      try {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(created.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(created.id);
      } catch (error) {
        console.warn(`  [eval] gecici hesap silinemedi: ${(error as Error).message}`);
      }
    },
  };
}
