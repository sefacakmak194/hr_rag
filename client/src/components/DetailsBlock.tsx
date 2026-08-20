import type { AnswerDetails } from '../types';

/** Doküman dosya adını okunabilir bir başlığa çevirir. */
function prettyDoc(doc: string): string {
  return doc
    .replace(/\.(md|pdf)$/i, '')
    .replace(/^\d+_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toLocaleUpperCase('tr-TR'));
}

/**
 * "Dayanak" bloğu — yanıtın altında maddenin TAM metni.
 *
 * Neden burada: kullanıcı daha ayrıntılı yanıt istiyor, ama küçük modelden
 * ayrıntı istemek cevabı bozuyor. Ayrıntı mevzuatın kendisinden geliyor;
 * bu metin birebir korpustan okunur, üretilmez.
 */
export default function DetailsBlock({ details }: { details: AnswerDetails }) {
  const { primary, related } = details;

  return (
    <details className="dayanak" open>
      <summary>
        <span className="dayanak-label">Dayanak</span>
        <span className="dayanak-src">
          {prettyDoc(primary.doc)} · {primary.section}
        </span>
      </summary>

      <p className="dayanak-text">{primary.text}</p>

      {related.length > 0 && (
        <div className="dayanak-related">
          <div className="label">Bağlama giren diğer maddeler</div>
          <ul>
            {related.map((r, i) => (
              <li key={`${r.doc}-${r.section}-${i}`}>
                {prettyDoc(r.doc)} · {r.section}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
