'use client';

import { useState, useEffect } from 'react';
import EmptyState from '@/components/EmptyState';

interface Watchlist {
  id: string;
  repository_id: string;
  name: string;
  query_filters: Record<string, unknown>;
  notify_on_update: boolean;
  created_at: string;
}

export default function WatchlistPage() {
  const [repoId, setRepoId] = useState('');
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (repoId) {
      loadWatchlists();
    }
  }, [repoId]);

  const loadWatchlists = async () => {
    try {
      const res = await fetch(`/api/watchlist?repository_id=${repoId}`);
      if (res.ok) {
        const data = await res.json();
        setWatchlists(data);
      }
    } catch { /* silent */ }
  };

  const createWatchlist = async () => {
    if (!repoId || !newName.trim()) return;
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repository_id: repoId, name: newName }),
      });
      if (res.ok) {
        setNewName('');
        loadWatchlists();
      }
    } catch { /* silent */ }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Watchlists</h1>
      <p className="text-sm text-[var(--muted)]">Monitor key symbols, files, or patterns across repository history.</p>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-md font-semibold mb-4">Repository</h2>
        <input
          className="search-input"
          placeholder="Repository ID (UUID)"
          value={repoId}
          onChange={e => setRepoId(e.target.value)}
        />
      </div>

      {repoId && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <h2 className="text-md font-semibold mb-4">Create Watchlist</h2>
          <div className="flex gap-3">
            <input
              className="search-input"
              placeholder="Watchlist name (e.g. 'Core API changes')"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createWatchlist()}
            />
            <button className="btn-primary" onClick={createWatchlist}>Create</button>
          </div>
        </div>
      )}

      {watchlists.length > 0 && (
        <div className="space-y-3">
          {watchlists.map(w => (
            <div key={w.id} className="evidence-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{w.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    Created {new Date(w.created_at).toLocaleDateString()}
                    {w.notify_on_update && ' • Notifications on'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {repoId && watchlists.length === 0 && (
        <EmptyState
          title="No watchlists yet"
          description="Create a watchlist to track changes to specific code areas."
          suggestions={[]}
          onSuggestionClick={() => {}}
        />
      )}
    </div>
  );
}
