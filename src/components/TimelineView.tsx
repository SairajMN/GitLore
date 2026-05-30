'use client';

interface TimelineEvent {
  date: string;
  artifact_type: string;
  title: string;
  description?: string;
  url?: string;
  author?: string;
}

interface TimelineViewProps {
  events: TimelineEvent[];
}

const typeColors: Record<string, string> = {
  commit: 'bg-blue-500',
  pr: 'bg-green-500',
  issue: 'bg-yellow-500',
  doc: 'bg-purple-500',
  adr: 'bg-pink-500',
  release_note: 'bg-cyan-500',
  snapshot: 'bg-gray-500',
};

export default function TimelineView({ events }: TimelineViewProps) {
  // Deduplicate by title+date
  const seen = new Set<string>();
  const unique = events.filter(e => {
    const key = `${e.date}-${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="space-y-0">
      {unique.map((event, i) => (
        <div key={i} className="flex gap-4">
          <div className="flex flex-col items-center" style={{ width: '20px' }}>
            <div className={`timeline-dot ${typeColors[event.artifact_type] || 'bg-gray-500'}`} />
            {i < unique.length - 1 && <div className="timeline-line flex-1" />}
          </div>
          <div className="pb-6 flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[var(--muted)]">
                {new Date(event.date).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${typeColors[event.artifact_type] || 'bg-gray-500'} bg-opacity-20 text-white`}>
                {event.artifact_type.toUpperCase()}
              </span>
            </div>
            <p className="text-sm font-medium truncate">{event.title}</p>
            {event.description && (
              <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-2">{event.description}</p>
            )}
            <div className="flex items-center gap-3 mt-1">
              {event.author && <span className="text-xs text-[var(--muted)]">{event.author}</span>}
              {event.url && (
                <a href={event.url} target="_blank" rel="noopener noreferrer" className="text-xs citation-link">
                  View →
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
