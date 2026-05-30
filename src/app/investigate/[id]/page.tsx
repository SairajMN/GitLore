'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function InvestigationPage() {
  const { id } = useParams<{ id: string }>();
  const [investigation, setInvestigation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/investigation?id=${id}`);
        if (!res.ok) throw new Error('Investigation not found');
        const data = await res.json();
        setInvestigation(data);

        // If there's an answer, fetch it
        if (data.answer_id) {
          const ansRes = await fetch(`/api/answer/${data.answer_id}`);
          if (ansRes.ok) {
            const ansData = await ansRes.json();
            setInvestigation((prev: any) => ({ ...prev, answer: ansData.answer, evidence: ansData.evidence }));
          }
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-32 w-full" />
        <div className="skeleton h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="text-4xl mb-4">🔍</div>
        <h3 className="text-lg font-semibold mb-2">Investigation not found</h3>
        <p className="text-sm text-[var(--muted)]">{error}</p>
        <a href="/" className="btn-primary inline-block mt-4">Back to Search</a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h1 className="text-xl font-semibold mb-2">{investigation.title || investigation.query_text}</h1>
        <p className="text-sm text-[var(--muted)]">Shared investigation</p>
        {investigation.created_at && (
          <p className="text-xs text-[var(--muted)] mt-1">
            Created {new Date(investigation.created_at).toLocaleDateString()}
          </p>
        )}
      </div>

      {investigation.answer && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Answer</h2>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {investigation.answer.answer_text}
          </div>
        </div>
      )}

      {investigation.evidence && investigation.evidence.length > 0 && (
        <div>
          <h3 className="text-md font-semibold mb-3">
            Evidence ({investigation.evidence.length} sources)
          </h3>
          <div className="grid gap-3">
            {investigation.evidence.map((ev: any) => (
              <div key={ev.id} className="evidence-card">
                <p className="text-sm font-medium mb-1">{ev.claim}</p>
                <p className="text-sm text-[var(--muted)] mb-2">{ev.excerpt}</p>
                {ev.citation_url && (
                  <a href={ev.citation_url} target="_blank" rel="noopener noreferrer" className="citation-link text-xs">
                    View source →
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
