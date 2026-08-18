export interface Citation {
  doc: string;
  section: string;
  score?: number;
  /** Parca icinde soruyla en ilgili cumle (evidence.service tarafindan secilir). */
  evidence?: string;
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
  /** Model bozuk metin uretti; icerik mevzuat alintisiyla degistirildi. */
  replaced?: boolean;
  streaming?: boolean;
  error?: boolean;
}

export interface HealthResponse {
  status: 'ready' | 'degraded';
  airGapped: boolean;
  embeddingModel: string;
  retrieval: { topK: number; similarityThreshold: number };
  index: { indexedChunks: number; documents: { docTitle: string; chunks: number }[] };
  foundry: {
    online: boolean;
    baseUrl: string | null;
    models: string[];
    activeModel: string | null;
    discovery: 'override' | 'cli' | 'fallback' | 'none';
    error?: string;
  };
}

export interface DocumentInfo {
  name: string;
  ext: string;
  bytes: number;
  modified: string;
  chunks: number;
}

export interface DocumentsResponse {
  corpusDir: string;
  documents: DocumentInfo[];
  indexedChunks: number;
  /** Ayni ada sahip .md bulundugu icin indekslenmeyen .pdf dosyalari. */
  shadowed: string[];
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
