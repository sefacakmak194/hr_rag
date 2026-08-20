/**
 * Sohbet oturumu kimligi.
 *
 * Sekme omru boyunca sabit kalir; sunucudaki konusma hafizasi buna baglanir.
 * Sunucu bu kimligi TEK BASINA anahtar olarak kullanmaz — oturum acmis
 * kullanicinin kimligiyle birlestirir (bkz. chat.route.ts sessionKey). Yine de
 * cikista burada da silinir: aksi halde ayni sekmede giren bir sonraki
 * kullanici, sunucu ad alanlari ayri olsa bile onceki kullanicinin oturum
 * kimligini tasimaya devam eder.
 */
const KEY = 'phr-session-id';

const uid = () => Math.random().toString(36).slice(2);

export function getSessionId(): string {
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = uid() + uid();
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export function clearSessionId(): void {
  sessionStorage.removeItem(KEY);
}
