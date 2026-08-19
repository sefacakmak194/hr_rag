/**
 * Korpus esitleme: yeniden indeksleme kilidi ve bekleyen surumlerin
 * yururluge alinmasi (Sprint 2).
 *
 * Bu mantik daha once documents.route icinde duruyordu. Buraya tasindi cunku
 * artik sunucu acilisinda ve zamanlayicida da gerekiyor; bir HTTP rotasinin
 * kilit sahibi olmasi dogru degil.
 *
 * ---
 *
 * BEKLEYEN SURUM NEDIR
 *
 * Yururluk tarihi GELECEKTE olan surum. Dosyasi korpusa degil `PENDING_DIR`e
 * yazilir; korpus dizini her zaman YURURLUKTEKI metni tutar. Tarih gelince
 * dosya korpusa tasinir ve indeks yeniden kurulur.
 *
 * CAKISMA — bilincli olarak OTOMATIK COZULMEZ:
 * Bekleyen surum beklerken ayni dokuman baska bir yoldan degistirilirse
 * (elle kopyalama ya da yeni yukleme) bekleyen surum artik en yuksek numarali
 * surum degildir; tasinsa bile yururluge giremez. Bu durumda dosya beklemede
 * BIRAKILIR ve durum `cakisma` olarak raporlanir. Otomatik cozum iki yondan
 * birini sessizce secmek zorunda kalirdi: ya aradaki degisikligi ya da
 * planlanmis degisikligi yok saymak. Ikisi de kullanicinin bilmesi gereken
 * bir karar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CORPUS_DIR, PENDING_DIR } from '../config/constants.js';
import { runIngestion, type IngestionOptions } from './ingestion.service.js';
import { countChunks, resetStore, resetLexicalIndex, getDb } from './vectorStore.service.js';
import { resetDiacriticsSozluk } from './diacritics.service.js';
import {
  latestVersion,
  pendingVersion,
  withdrawVersion,
  type VersionRow,
} from './versioning.service.js';

// ------------------------------------------------------------------ kilit

let reindexing: Promise<void> | null = null;

/**
 * Korpusu bastan indeksler. Ayni anda yalnizca bir kosum olur; ikinci cagri
 * devam eden kosumu bekler ve ardindan kendi kosumunu yapar.
 */
export async function reindex(
  options: IngestionOptions = {},
): Promise<{ chunks: number; changed: string[]; error?: string }> {
  while (reindexing) await reindexing.catch(() => {});

  let done!: () => void;
  reindexing = new Promise<void>((r) => (done = r));

  try {
    const report = await runIngestion(CORPUS_DIR, options);
    return { chunks: countChunks(), changed: report.changed };
  } catch (error) {
    // Korpus bosaldiysa runIngestion hata atar; depo zaten sifirlanmis olur.
    resetStore();
    resetLexicalIndex();
    resetDiacriticsSozluk();
    return { chunks: 0, changed: [], error: (error as Error).message };
  } finally {
    done();
    reindexing = null;
  }
}

// -------------------------------------------------------------- bekleyenler

export interface PendingEntry {
  name: string;
  version: number;
  effectiveFrom: string;
  note: string | null;
  createdBy: string;
  /** Bekleyen surum artik en yuksek surum degil — elle mudahale gerekiyor. */
  conflict: boolean;
}

export function pendingDir(): string {
  return PENDING_DIR;
}

/** Bekleme dizinindeki dosyalar ve karsilik gelen surum kayitlari. */
export function listPending(now = new Date()): PendingEntry[] {
  if (!fs.existsSync(PENDING_DIR)) return [];

  const db = getDb();
  const entries: PendingEntry[] = [];

  for (const name of fs.readdirSync(PENDING_DIR).sort()) {
    const row = pendingVersion(db, name, now);
    if (!row) continue; // surumu geri cekilmis ya da tarihi gecmis; promote temizler
    entries.push({
      name,
      version: row.version,
      effectiveFrom: row.effectiveFrom,
      note: row.note,
      createdBy: row.createdBy,
      conflict: isConflicted(row),
    });
  }
  return entries;
}

/** Bekleyen surum, dokumanin en yuksek numarali surumu mu? */
function isConflicted(row: VersionRow): boolean {
  const latest = latestVersion(getDb(), row.docTitle);
  return !latest || latest.version !== row.version;
}

export interface PromotionResult {
  promoted: string[];
  conflicts: string[];
  indexedChunks?: number;
  error?: string;
}

/**
 * Yururluk tarihi gelmis bekleyen surumleri korpusa alir ve indeksi yeniler.
 *
 * Sunucu acilisinda ve saatlik olarak cagrilir. Hicbir sey tasinmadiysa
 * yeniden indeksleme YAPILMAZ — bos kosum korpus buyudukce pahalidir.
 */
export async function promoteDueVersions(now = new Date()): Promise<PromotionResult> {
  if (!fs.existsSync(PENDING_DIR)) return { promoted: [], conflicts: [] };

  const db = getDb();
  const promoted: string[] = [];
  const conflicts: string[] = [];
  const iso = now.toISOString();

  for (const name of fs.readdirSync(PENDING_DIR).sort()) {
    const source = path.join(PENDING_DIR, name);
    const row = latestVersion(db, name);

    // Surum kaydi yoksa ya da geri cekildiyse bekleyen dosyanin dayanagi yok.
    if (!row || row.withdrawnAt) {
      fs.rmSync(source, { force: true });
      continue;
    }
    if (row.effectiveFrom > iso) continue; // henuz zamani gelmedi

    // Bekleyen surum artik en yuksek surum degilse tasima YAPILMAZ (bkz. basliktaki not).
    const pending = pendingVersion(db, name, now);
    if (pending && isConflicted(pending)) {
      conflicts.push(name);
      continue;
    }

    fs.mkdirSync(CORPUS_DIR, { recursive: true });
    fs.copyFileSync(source, path.join(CORPUS_DIR, name));
    fs.rmSync(source, { force: true });
    promoted.push(name);
  }

  if (!promoted.length) return { promoted, conflicts };

  const result = await reindex({ actor: 'sistem' });
  return { promoted, conflicts, indexedChunks: result.chunks, error: result.error };
}

/**
 * Bekleyen surumu iptal eder: dosya bekleme dizininden silinir, surum satiri
 * GERI CEKILIR.
 *
 * Satir silinmez (tetikleyici zaten izin vermez) — denetimde "planlanmisti,
 * vazgecildi" izi kalmalidir. Yururlukteki surum etkilenmez.
 */
export function discardPending(name: string, now = new Date()): boolean {
  const db = getDb();
  const row = pendingVersion(db, name, now);
  const file = path.join(PENDING_DIR, name);

  if (!row && !fs.existsSync(file)) return false;

  fs.rmSync(file, { force: true });
  if (row) withdrawVersion(db, name, row.version, now);
  return true;
}
