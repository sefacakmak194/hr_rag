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
  // cumleyi dokumana gitmeden gorur. Kanit yoksa duz rozet olarak kalir.
  const body = (
    <>
      <span className="citation-doc">{prettyDoc(citation.doc)}</span>
      <span className="citation-sep">→</span>
      <span className="citation-section">{citation.section}</span>
      {citation.score !== undefined && (
        <span className="citation-score">{citation.score.toFixed(2)}</span>
      )}
    </>
  );

  if (!citation.evidence) {
    return (
      <span className="citation" title={`${citation.doc} → ${citation.section}`}>
        {body}
      </span>
    );
  }

  return (
    <details className="citation citation-expandable">
      <summary title={`${citation.doc} → ${citation.section}`}>{body}</summary>
      <p className="citation-evidence">“{citation.evidence}”</p>
    </details>
  );
}

export function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="citations">
      <span className="citations-label">Kaynaklar</span>
      <div className="citations-row">
        {citations.map((c, i) => (
          <CitationBadge key={`${c.doc}-${c.section}-${i}`} citation={c} />
        ))}
      </div>
    </div>
  );
}

export default CitationBadge;
