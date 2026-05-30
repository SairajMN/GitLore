'use client';

interface EmptyStateProps {
  title: string;
  description: string;
  suggestions: string[];
  onSuggestionClick: (suggestion: string) => void;
}

export default function EmptyState({ title, description, suggestions, onSuggestionClick }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="max-w-md mx-auto">
        <div className="text-4xl mb-4">🔍</div>
        <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">{title}</h3>
        <p className="text-sm text-[var(--muted)] mb-6">{description}</p>
        {suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wider">Try asking:</p>
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="block w-full text-left text-sm bg-[var(--card)] border border-[var(--border)] rounded-lg px-4 py-2.5 hover:border-[var(--primary)] transition-colors"
                onClick={() => onSuggestionClick(s)}
              >
                &ldquo;{s}&rdquo;
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
