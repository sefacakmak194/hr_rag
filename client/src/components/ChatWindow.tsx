import { useEffect, useRef, useState } from 'react';
import { CitationList } from './CitationBadge';
import DetailsBlock from './DetailsBlock';
import type { AnswerBasis, AnswerDetails, Citation, Message } from '../types';

const SUGGESTIONS = [
  'Ne iş yaparsın?',
  '5 yıllık çalışan kaç gün yıllık izin kullanabilir?',
  'Maaşlar hangi gün ödeniyor?',
  'Kreş desteği ne kadar?',
  'İstifa edersem ihbar süresi ne kadar?',
  'Ne konuşuyorduk?',
];

const uid = () => Math.random().toString(36).slice(2);

/** Oturum kimligi sekme omru boyunca sabit kalir; sunucu hafizasi buna baglanir. */
const SESSION_KEY = 'phr-session-id';
function getSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uid() + uid();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

const fmtTime = (d: Date) =>
  d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Turlarin saati: mesaj nesnesi sunucudan gelmiyor, ilk gorulduğu an yazilir.
  const stampRef = useRef<Map<string, string>>(new Map());
  // Yanit suresi: kullanicinin bekledigi sure, sunucunun raporladigi degil.
  const [durations, setDurations] = useState<Record<string, number>>({});

  const stamp = (id: string) => {
    let s = stampRef.current.get(id);
    if (!s) {
      s = fmtTime(new Date());
      stampRef.current.set(id, s);
    }
    return s;
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const patchLast = (patch: (m: Message) => Message) =>
    setMessages((prev) => {
      const next = [...prev];
      const i = next.length - 1;
      if (i >= 0) next[i] = patch(next[i]);
      return next;
    });

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    const answerId = uid();
    const started = performance.now();

    setInput('');
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: 'user', content: trimmed },
      { id: answerId, role: 'assistant', content: '', streaming: true, citations: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, sessionId: getSessionId() }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(detail || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let pendingEvent: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');

          if (line.startsWith('event:')) {
            pendingEvent = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith('data:')) {
            if (line === '') pendingEvent = null;
            continue;
          }

          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            patchLast((m) => ({ ...m, streaming: false }));
            continue;
          }

          let parsed: {
            token?: string;
            citations?: Citation[];
            basis?: AnswerBasis;
            error?: string;
            text?: string;
            reason?: string;
            primary?: AnswerDetails['primary'];
            related?: AnswerDetails['related'];
          };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }

          if (pendingEvent === 'metadata' && parsed.citations) {
            patchLast((m) => ({ ...m, citations: parsed.citations, basis: parsed.basis }));
          } else if (pendingEvent === 'replace' && parsed.text) {
            // Model anlamsiz metin uretti; yerine mevzuatin birebir alintisi.
            patchLast((m) => ({ ...m, content: parsed.text!, replaced: true }));
          } else if (pendingEvent === 'details' && parsed.primary) {
            // Dayanak metni: modelin urettigi degil, mevzuatin kendisi.
            patchLast((m) => ({
              ...m,
              details: { primary: parsed.primary!, related: parsed.related ?? [] },
            }));
          } else if (pendingEvent === 'error' && parsed.error) {
            patchLast((m) => ({
              ...m,
              content: parsed.error!,
              streaming: false,
              error: true,
            }));
          } else if (parsed.token) {
            patchLast((m) => ({ ...m, content: m.content + parsed.token }));
          }
        }
      }

      patchLast((m) => ({ ...m, streaming: false }));
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        patchLast((m) => ({
          ...m,
          content: `Bağlantı hatası: ${(error as Error).message}`,
          streaming: false,
          error: true,
        }));
      } else {
        patchLast((m) => ({ ...m, streaming: false }));
      }
    } finally {
      setDurations((prev) => ({ ...prev, [answerId]: performance.now() - started }));
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function resetConversation() {
    await fetch('/api/session/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: getSessionId() }),
    }).catch(() => {});
    sessionStorage.removeItem(SESSION_KEY);
    stampRef.current.clear();
    setDurations({});
    setMessages([]);
  }

  const turns = messages.filter((m) => m.role === 'user').length;

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <div className="eyebrow">01 / Sohbet</div>
          <h2 className="view-title">
            {turns ? `Oturum · ${turns} tur` : 'Şirket içi mevzuata sorun'}
          </h2>
        </div>
        {messages.length > 0 && (
          <div className="view-actions">
            <button type="button" className="btn" onClick={resetConversation} disabled={busy}>
              Yeni sohbet
            </button>
          </div>
        )}
      </header>

      <div className="view-body view-body--flush">
        <div className="chat">
          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>
                  Yanıtlar yalnızca kurumsal doküman kaynaklarında üretilir ve kaynak maddesiyle
                  birlikte gösterilir.
                </p>
                <div className="suggest">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={s} type="button" onClick={() => ask(s)}>
                      <span className="suggest-no">{String(i + 1).padStart(2, '0')}</span>
                      <span className="suggest-q">{s}</span>
                      <span className="suggest-go">→</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`turn turn--${m.role}${m.error ? ' turn--error' : ''}`}
              >
                <div className="turn-meta">
                  {m.role === 'user' ? 'Siz' : 'Asistan'}
                  <br />
                  <span className="turn-time">
                    {m.role === 'user'
                      ? stamp(m.id)
                      : durations[m.id] !== undefined
                        ? `${(durations[m.id] / 1000).toFixed(1)}s`
                        : ''}
                  </span>
                </div>

                <div className="turn-body">
                  <div className="turn-text">
                    {m.replaced && (
                      <span className="replaced-note">
                        Yanıt üretimi başarısız oldu; mevzuat metni birebir gösteriliyor.
                      </span>
                    )}
                    {m.streaming && !m.content ? (
                      <span className="thinking">yanıt üretiliyor…</span>
                    ) : (
                      m.content
                    )}
                    {m.streaming && m.content && <span className="caret" />}
                  </div>

                  {m.role === 'assistant' && !m.streaming && m.details && (
                    <DetailsBlock details={m.details} />
                  )}
                  {m.role === 'assistant' && !m.streaming && m.citations && (
                    <CitationList citations={m.citations} />
                  )}
                </div>
              </div>
            ))}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Örn: Babalık izni kaç gün?"
              disabled={busy}
              autoFocus
            />
            <button type="submit" className="btn btn--solid" disabled={busy || !input.trim()}>
              {busy ? '…' : 'Sor'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ChatWindow;
