'use client';

interface EvidenceCardProps {
  artifactId: string;
  relevanceScore: number;
  excerpt: string;
  claim: string;
  citationUrl?: string;
  isDirect: boolean;
  metadata: Record<string, unknown>;
}

export default function EvidenceCard({
  relevanceScore,
  excerpt,
  claim,
  citationUrl,
  isDirect,
  metadata,
}: EvidenceCardProps) {
  const artifactType = (metadata?.artifact_type as string) || 'unknown';
  const author = (metadata?.author as string) || undefined;
  const date = (metadata?.date as string) || undefined;

  const typeColors: Record<string, string> = {
    commit: 'bg-blue-500/20 text-blue-400',
    pr: 'bg-green-500/20 text-green-400',
    issue: 'bg-yellow-500/20 text-yellow-400',
    doc: 'bg-purple-500/20 text-purple-400',
    adr: 'bg-pink-500/20 text-pink-400',
    release_note: 'bg-cyan-500/20 text-cyan-400',
    snapshot: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <div className={`evidence-card ${isDirect ? 'border-[var(--primary)]/30' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${typeColors[artifactType] || 'bg-gray-500/20 text-gray-400'}`}>
            {artifactType.toUpperCase()}
          </span>
          {isDirect && (
            <span className="text-xs font-medium text-[var(--success)]">Direct evidence</span>
          )}
        </div>
        <span className="text-xs text-[var(--muted)]">
          {(relevanceScore * 100).toFixed(0)}% relevant
        </span>
      </div>
      <p className="text-sm font-medium text-[var(--foreground)] mb-1">{claim}</p>
      <p className="text-sm text-[var(--muted)] mb-2 line-clamp-3">{excerpt}</p>
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <div className="flex gap-3">
          {author && <span>{author}</span>}
          {date && <span>{new Date(date).toLocaleDateString()}</span>}
        </div>
        {citationUrl && (
          <a href={citationUrl} target="_blank" rel="noopener noreferrer" className="citation-link">
            View source →
          </a>
        )}
      </div>
    </div>
  );
}
