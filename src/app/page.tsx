'use client';

import { useState, useRef } from 'react';
import EvidenceCard from '@/components/EvidenceCard';
import TimelineView from '@/components/TimelineView';
import ConfidenceBadge from '@/components/ConfidenceBadge';
import EmptyState from '@/components/EmptyState';
import MermaidDiagram from '@/components/MermaidDiagram';

/** Simple markdown to HTML for answer text */
function renderMarkdown(text: string): string {
  return text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-[var(--bg)] px-1.5 py-0.5 rounded text-xs">$1</code>')
    // Code blocks (non-mermaid)
    .replace(/```(?!mermaid)(\w*)\n([\s\S]*?)```/g, '<pre class="bg-[var(--bg)] p-3 rounded-lg overflow-x-auto text-xs my-2"><code>$2</code></pre>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-4 mb-2">$1</h2>')
    // Bullet points
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm">$1</li>')
    // Line breaks for lists
    .replace(/(<li.*<\/li>\n?)+/g, (match) => `<ul class="my-2">${match}</ul>`)
    // Newlines to <br>
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

interface AnswerResponse {
  query_id: string;
  answer: {
    id: string;
    answer_text: string;
    confidence: number;
    uncertainty_notes?: string;
    hypotheses: Array<{ rank: number; explanation: string; confidence: number }>;
    synthesis_latency_ms?: number;
    model_used?: string;
    created_at: string;
  };
  evidence: Array<{
    id: string;
    artifact_id: string;
    relevance_score: number;
    excerpt?: string;
    claim?: string;
    citation_url?: string;
    is_direct: boolean;
    metadata: Record<string, unknown>;
  }>;
  timeline: Array<{
    date: string;
    artifact_type: string;
    title: string;
    description?: string;
    url?: string;
    author?: string;
  }>;
}

/** Renders answer text with both markdown and Mermaid diagrams */
function AnswerRenderer({ text }: { text: string }) {
  // Split on ```mermaid ... ``` blocks
  const parts = text.split(/(```mermaid\n[\s\S]*?```)/g);

  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed">
      {parts.map((part, i) => {
        const mermaidMatch = part.match(/^```mermaid\n([\s\S]*?)```$/);
        if (mermaidMatch) {
          return <MermaidDiagram key={i} code={mermaidMatch[1]} />;
        }
        // Render markdown for non-mermaid parts
        return (
          <div
            key={i}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(part) }}
          />
        );
      })}
    </div>
  );
}

export default function Home() {
  const [repoInput, setRepoInput] = useState('');
  const [queryText, setQueryText] = useState('');
  const [repoId, setRepoId] = useState<string | null>(null);
  const [repoName, setRepoName] = useState('');
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [saving, setSaving] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const handleConnectRepo = async () => {
    const match = repoInput.match(/github\.com\/([^/]+)\/([^/\s]+)/) || repoInput.match(/^([^/]+)\/([^/\s]+)$/);
    if (!match) { setError('Enter a GitHub repo as "owner/repo" or full URL'); return; }
    const [, owner, name] = match;
    setError(null);
    setIndexing(true);
    setRepoName(`${owner}/${name}`);

    try {
      const res = await fetch('/api/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect repo');
      setRepoId(data.repository.id);

      const pollInterval = setInterval(async () => {
        const statusRes = await fetch(`/api/index-status?id=${data.repository.id}`);
        const statusData = await statusRes.json();
        if (statusData.job_status === 'completed' || statusData.job_status === 'failed') {
          clearInterval(pollInterval);
          setIndexing(false);
          if (statusData.job_status === 'failed') setError('Indexing failed. Try again.');
        }
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to connect repository');
      setIndexing(false);
    }
  };

  const handleQuery = async () => {
    if (!repoId || !queryText.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repository_id: repoId, text: queryText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Query failed');
      setResult(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      setError(err.message || 'Query failed');
    } finally { setLoading(false); }
  };

  const handleSaveInvestigation = async () => {
    if (!result || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/investigation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository_id: repoId, query_text: queryText, answer_id: result.answer.id, title: queryText.substring(0, 100) }) });
      const data = await res.json();
      if (res.ok) { navigator.clipboard.writeText(`${window.location.origin}/investigate/${data.id}`); alert('Saved! Share link copied.'); }
    } catch { alert('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleFeedback = async (type: string) => {
    if (!result) return;
    try { await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer_id: result.answer.id, feedback_type: type }) }); } catch { }
  };

  return (
    <div className="space-y-8">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-2">Connect a Repository</h2>
        <p className="text-sm text-[var(--muted)] mb-4">Analyze history from any public GitHub repo</p>
        <div className="flex gap-3">
          <input className="search-input" placeholder="owner/repo or full URL" value={repoInput} onChange={e => setRepoInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleConnectRepo()} disabled={indexing} />
          <button className="btn-primary whitespace-nowrap" onClick={handleConnectRepo} disabled={indexing}>{indexing ? 'Indexing...' : repoId ? 'Reindex' : 'Connect'}</button>
        </div>
        {repoId && !indexing && <p className="text-xs text-[var(--success)] mt-2">Connected to {repoName}</p>}
      </div>

      <div className="space-y-3">
        <input className="search-input text-lg py-4" placeholder={repoId ? 'Ask why code exists this way...' : 'Connect a repo first'} value={queryText} onChange={e => setQueryText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleQuery()} disabled={!repoId || loading} />
        <div className="flex justify-end">
          <button className="btn-primary" onClick={handleQuery} disabled={!repoId || !queryText.trim() || loading}>{loading ? 'Analyzing...' : 'Ask GitLore'}</button>
        </div>
      </div>

      {error && <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-red-400 text-sm">{error}</div>}

      {/* Results */}
      {result && (
        <div ref={resultRef} className="space-y-6">
          {/* Answer */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Answer</h2>
                <ConfidenceBadge confidence={result.answer.confidence} />
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={handleSaveInvestigation}>Save & Share</button>
                <button className="btn-secondary text-xs" onClick={() => setShowTimeline(!showTimeline)}>
                  {showTimeline ? 'Hide Timeline' : 'Show Timeline'}
                </button>
              </div>
            </div>
            <AnswerRenderer text={result.answer.answer_text} />
            {result.answer.synthesis_latency_ms && <p className="text-xs text-[var(--muted)] mt-4">Synthesized in {(result.answer.synthesis_latency_ms / 1000).toFixed(1)}s using {result.answer.model_used}</p>}
          </div>

          {/* Hypotheses */}
          {result.answer.hypotheses.length > 0 && (
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
              <h3 className="text-md font-semibold mb-3">Alternative Hypotheses</h3>
              {result.answer.hypotheses.map(h => (
                <div key={h.rank} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-[var(--warning)]">Hypothesis {h.rank}</span>
                    <ConfidenceBadge confidence={h.confidence} compact />
                  </div>
                  <p className="text-sm text-[var(--foreground)]">{h.explanation}</p>
                </div>
              ))}
            </div>
          )}

          {/* Evidence Cards */}
          <div>
            <h3 className="text-md font-semibold mb-3">Evidence ({result.evidence.length} sources)</h3>
            <div className="grid gap-3">
              {result.evidence.map(ev => (
                <EvidenceCard key={ev.id} artifactId={ev.artifact_id} relevanceScore={ev.relevance_score} excerpt={ev.excerpt || ''} claim={ev.claim || ''} citationUrl={ev.citation_url} isDirect={ev.is_direct} metadata={ev.metadata as Record<string, unknown>} />
              ))}
            </div>
          </div>

          {/* Timeline */}
          {showTimeline && result.timeline.length > 0 && (
            <div>
              <h3 className="text-md font-semibold mb-3">Timeline ({result.timeline.length} events)</h3>
              <TimelineView events={result.timeline} />
            </div>
          )}

          {/* Feedback */}
          <div className="flex items-center gap-3 pt-2 border-t border-[var(--border)]">
            <span className="text-xs text-[var(--muted)]">Was this helpful?</span>
            {(['helpful', 'unhelpful', 'inaccurate', 'missing_evidence'] as const).map(type => (
              <button key={type} className="btn-secondary text-xs" onClick={() => handleFeedback(type)}>
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty states */}
      {!result && !loading && !error && repoId && (
        <EmptyState title="Ask a question about this repository" description="GitLore analyzes commits, PRs, issues, and docs to explain why code evolved the way it did." suggestions={['Why does this function still support the old format?', 'When was this edge case introduced?', 'Show me the system architecture diagram', 'What is the project structure?', 'What tradeoff explains this implementation?']} onSuggestionClick={(s: string) => setQueryText(s)} />
      )}
      {!repoId && !error && (
        <EmptyState title="Welcome to GitLore" description="Connect a GitHub repository to start exploring its history. GitLore traces commits, PRs, issues, and decisions to explain why code exists the way it does." suggestions={[]} onSuggestionClick={() => { }} />
      )}
    </div>
  );
}


