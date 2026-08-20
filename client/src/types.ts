export interface Citation {
  doc: string;
  section: string;
  score?: number;
  /** Parca icinde soruyla en ilgili cumle (evidence.service tarafindan secilir). */
  evidence?: string;
  /** Yanitin dayandigi politika surumu (Sprint 2). */
  version?: number;
  versionId?: number;
  effectiveFrom?: string;
}

/** "Bu yanit su tarihli surume dayanmaktadir" bilgisi. */
export interface AnswerBasis {
  doc: string;
  version: number;
  effectiveFrom: string;
}

export interface AnswerDetails {
  /** Yanitin dayandigi maddenin TAM metni (birebir, uretilmemis). */
  primary: { doc: string; section: string; text: string };
  /** Baglama giren diger maddeler. */
  related: { doc: string; section: string }[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  details?: AnswerDetails;
  /** Yanitin dayandigi surum; mevzuat degistiginde gecmis yanit yaniltmasin. */
  basis?: AnswerBasis;
  /** Model bozuk metin uretti; icerik mevzuat alintisiyla degistirildi. */
  replaced?: boolean;
  streaming?: boolean;
  error?: boolean;
}

export interface DocumentInfo {
  name: string;
  ext: string;
  bytes: number;
  modified: string;
  chunks: number;
  /** Yururlukteki surum numarasi; surum kaydi yoksa null. */
  version: number | null;
  effectiveFrom: string | null;
  accessLabel: 'genel' | 'ik' | 'yonetici';
}

/** Yururluk tarihi henuz gelmemis, bekleme dizininde duran surum. */
export interface PendingVersion {
  name: string;
  version: number;
  effectiveFrom: string;
  note: string | null;
  createdBy: string;
  /** Bekleyen surum artik en yuksek surum degil — elle mudahale gerekiyor. */
  conflict: boolean;
}

export interface DocumentsResponse {
  corpusDir: string;
  pendingDir: string;
  documents: DocumentInfo[];
  pending: PendingVersion[];
  indexedChunks: number;
  /** Ayni ada sahip .md bulundugu icin indekslenmeyen .pdf dosyalari. */
  shadowed: string[];
}

export type VersionState = 'yururlukte' | 'bekliyor' | 'arsiv' | 'geri-cekildi';

export interface DocumentVersion {
  id: number;
  version: number;
  effectiveFrom: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  bytes: number;
  source: string;
  state: VersionState;
}

export interface VersionListResponse {
  docTitle: string;
  currentVersion: number | null;
  versions: DocumentVersion[];
}

export interface VersionTextResponse {
  docTitle: string;
  version: number;
  effectiveFrom: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  state: VersionState;
  content: string;
}

export interface DiffLine {
  kind: 'ayni' | 'eklendi' | 'silindi' | 'atlandi';
  text: string;
  count?: number;
}

export interface DiffResponse {
  docTitle: string;
  a: number;
  b: number;
  aEffectiveFrom: string;
  bEffectiveFrom: string;
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated: boolean;
}

export interface CorpusFinding {
  kind: 'celiski' | 'tekrar' | 'yapi';
  severity: 'yuksek' | 'orta' | 'bilgi';
  message: string;
  where: { doc: string; section: string }[];
}

export interface CorpusAudit {
  documents: number;
  chunks: number;
  findings: CorpusFinding[];
  summary: { yuksek: number; orta: number; bilgi: number };
}

/** Oturum acmis kullanici. */
export interface SessionUser {
  username: string;
  role: 'calisan' | 'ik' | 'yonetici';
}

/** `/api/auth/status` yaniti. */
export interface AuthStatus {
  /** Hic hesap yoksa true: giris yerine ilk kurulum ekrani gosterilir. */
  needsSetup: boolean;
  authenticated: boolean;
  user: SessionUser | null;
  sessionHours: number;
}

export interface AuditCitation {
  doc: string;
  section: string;
  /**
   * Yanitin dayandigi surumun degismez kimligi. Sprint 2 oncesi satirlarda
   * ve surum kaydi olusmadan indekslenmis dokumanlarda bulunmaz.
   */
  versionId?: number;
  version?: number;
}

export interface AuditRow {
  id: number;
  at: string;
  username: string;
  role: SessionUser['role'];
  /** Yalnizca kisitli dokumana erisimde dolu; genel erisimde null. */
  question: string | null;
  citations: AuditCitation[];
  answered: boolean;
  durationMs: number;
}

export interface AuditResponse {
  summary: { total: number; unanswered: number; users: number };
  /** Sunucunun belirledigi kapsam; istemci bunu secmez. */
  scope: 'tumu' | 'kendi';
  rows: AuditRow[];
}

/** Denetim kaydinin hash zinciri durumu (Sprint 3a). */
export interface IntegrityReport {
  ok: boolean;
  /** Zincire dahil satir sayisi. */
  chained: number;
  /** Zincir eklenmeden once yazilmis, dogrulanamayan satir sayisi. */
  preChain: number;
  chainHead: string;
  lastRowId: number | null;
  brokenAt?: number;
  reason?: string;
  sonArsiv: { dosya: string; sonSatir: number } | null;
  acikAnahtarParmakIzi: string;
  arsivDizini: string;
}

export interface ArchiveItem {
  dosya: string;
  bayt: number;
  olusturuldu: string;
  satirSayisi: number;
}

export interface ArchiveVerification {
  dosya: string;
  ok: boolean;
  imzaGecerli: boolean;
  zincirGecerli: boolean;
  satirSayisi: number;
  surumSayisi: number;
  olusturuldu: string;
  parmakIzi: string;
  anahtarEslesti?: boolean;
  sorunlar: string[];
}

/** Politika boslugu raporu (Sprint 4). */
export interface GapCluster {
  label: string;
  count: number;
  questions: { question: string; week: string; topScore: number }[];
  bestScore: number;
  /** Skor alaka esigine cok yakin: konu mevzuatta olabilir ama net degil. */
  nearMiss: boolean;
  firstWeek: string;
  lastWeek: string;
  /** En benzer diger kume — fazla bolme yonunde taraf tutuldugu icin gerekli. */
  relatedTo?: string;
}

export interface GapReport {
  currentWeek: string;
  totalQuestions: number;
  weeks: number;
  clusters: GapCluster[];
  byWeek: { week: string; count: number }[];
  threshold: number;
  retentionWeeks: number;
}
