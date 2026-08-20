import type { Citation } from '../types';

/** Doküman dosya adını okunabilir bir başlığa çevirir. */
function prettyDoc(doc: string): string {
  return doc
    .replace(/\.md$/i, '')
    .replace(/^\d+_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toLocaleUpperCase('tr-TR'));
}

export function CitationBadge({ citation }: { citation: Citation }) {
  // Kanit cumlesi varsa alinti acilabilir olur: kullanici cevabin DAYANDIGI
  // cumleyi dokumana gitmeden gorur. Kanit yoksa duz satir olarak kalir.
  // Skor bilerek yazilmiyor: okuyucunun karari "hangi madde", "0.87" degil.
  // Sayi guven veriyormus gibi duruyor ama okuyucu onu yorumlayamaz.
  const body = (
    <>
      <span className="cite-doc">{prettyDoc(citation.doc)}</span>
      <span className="cite-sep">→</span>
      <span className="cite-section">{citation.section}</span>
    </>
  );

  if (!citation.evidence) {
    return (
      <div className="cite" title={`${citation.doc} → ${citation.section}`}>
        <div className="cite-flat">{body}</div>
      </div>
    );
  }

  return (
    <details className="cite cite--open">
      <summary title={`${citation.doc} → ${citation.section}`}>{body}</summary>
      <p className="cite-evidence">“{citation.evidence}”</p>
    </details>
  );
}

export function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="cites">
      <div className="label">Kaynaklar</div>
      <div className="cites-list">
        {citations.map((c, i) => (
          <CitationBadge key={`${c.doc}-${c.section}-${i}`} citation={c} />
        ))}
      </div>
    </div>
  );
}

export default CitationBadge;
