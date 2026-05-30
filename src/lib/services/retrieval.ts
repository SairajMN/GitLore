import * as db from '@/lib/db';
import * as types from '@/types';
import { getRouter } from '@/lib/providers/router';

/**
 * Hybrid retrieval service combining lexical search, semantic search,
 * and graph expansion for maximum recall.
 */
export class RetrievalService {
  /**
   * Perform full hybrid retrieval for a query.
   * Runs lexical and exact-match searches in parallel, then expands via graph relations.
   */
  async retrieve(
    repoId: string,
    queryTerms: string[],
    entities: Array<{ type: string; value: string }>,
    limit = 20
  ): Promise<Array<types.Artifact & { relevanceScore: number; matchType: string }>> {
    const queryText = queryTerms.join(' ');
    const results = new Map<string, types.Artifact & { relevanceScore: number; matchType: string }>();

    // 1. Lexical (tsvector) search
    if (queryText.trim()) {
      const lexicalResults = await db.lexicalSearch(repoId, queryText, limit);
      for (const r of lexicalResults) {
        results.set(r.id, { ...r, relevanceScore: 0.7, matchType: 'lexical' });
      }

      // Also search individual query terms for better recall
      for (const term of queryTerms) {
        if (term.length > 2 && !results.has(term)) {
          const termResults = await db.lexicalSearch(repoId, term, 10);
          for (const r of termResults) {
            if (!results.has(r.id)) {
              results.set(r.id, { ...r, relevanceScore: 0.6, matchType: 'lexical_term' });
            }
          }
        }
      }
    }

    // 2. Exact match search for entity names, symbols
    for (const entity of entities) {
      const exactResults = await db.exactMatchSearch(repoId, entity.value, 10);
      for (const r of exactResults) {
        if (!results.has(r.id)) {
          results.set(r.id, { ...r, relevanceScore: 0.9, matchType: 'exact_match' });
        } else {
          // Boost existing
          const existing = results.get(r.id)!;
          existing.relevanceScore = Math.min(1.0, existing.relevanceScore + 0.2);
        }
      }
    }

    // 2b. Exact match search for each query term across title/description/content
    for (const term of queryTerms) {
      if (term.length > 2) {
        const termResults = await db.exactMatchSearch(repoId, term, 10);
        for (const r of termResults) {
          if (!results.has(r.id)) {
            results.set(r.id, { ...r, relevanceScore: 0.75, matchType: 'term_match' });
          } else {
            const existing = results.get(r.id)!;
            existing.relevanceScore = Math.min(1.0, existing.relevanceScore + 0.1);
          }
        }
      }
    }

    // 3. Symbol-based search
    for (const entity of entities) {
      const symbols = await db.searchSymbols(repoId, entity.value);
      for (const symbol of symbols) {
        if (symbol.artifact_id) {
          const artifact = await db.getArtifactById(symbol.artifact_id);
          if (artifact && !results.has(artifact.id)) {
            results.set(artifact.id, { ...artifact, relevanceScore: 0.85, matchType: 'symbol_match' });
          }
        }
      }
    }

    // 4. Graph expansion - for each hit, find related artifacts
    const currentIds = [...results.keys()];
    for (const id of currentIds.slice(0, 10)) {
      const related = await db.getRelatedArtifacts(id);
      for (const rel of related) {
        if (!results.has(rel.id)) {
          results.set(rel.id, {
            ...rel, relevanceScore: 0.5,
            matchType: `graph_expansion (${rel.relation_metadata?.relation_type || 'related'})`,
          });
        }
      }
    }

    // 5. Fallback: if no results found, return most recent artifacts from the repo
    if (results.size === 0) {
      const recentArtifacts = await db.getArtifactsByRepo(repoId, undefined);
      for (const a of recentArtifacts.slice(0, limit)) {
        results.set(a.id, { ...a, relevanceScore: 0.4, matchType: 'fallback_recent' });
      }
    }

    // Sort by relevance score
    return [...results.values()]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * Extract timeline events from artifacts.
   */
  async buildTimeline(
    repoId: string,
    artifacts: types.Artifact[]
  ): Promise<types.TimelineEvent[]> {
    const events: types.TimelineEvent[] = [];
    const seen = new Set<string>();

    for (const a of artifacts) {
      if (!a.date || seen.has(a.external_id || a.id)) continue;
      seen.add(a.external_id || a.id);

      events.push({
        date: a.date,
        artifact_type: a.artifact_type,
        title: a.title || '',
        description: a.description?.substring(0, 200),
        url: a.url || undefined,
        author: a.author || undefined,
      });
    }

    // Fetch more timeline data chronologically
    const repoArtifacts = await db.getArtifactsByRepo(repoId);
    for (const a of repoArtifacts) {
      if (!a.date || seen.has(a.external_id || a.id)) continue;
      seen.add(a.external_id || a.id);
      events.push({
        date: a.date,
        artifact_type: a.artifact_type,
        title: a.title || '',
        description: a.description?.substring(0, 200),
        url: a.url || undefined,
        author: a.author || undefined,
      });
    }

    // Sort chronologically
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return events.slice(-50); // Last 50 events
  }

  /**
   * Extract issue/PR numbers, commit hashes, and symbol references from query text.
   */
  extractEntities(text: string): Array<{ type: string; value: string }> {
    const entities: Array<{ type: string; value: string }> = [];

    // Issue/PR numbers (#123)
    const issueMatches = text.matchAll(/#(\d+)/g);
    for (const m of issueMatches) {
      entities.push({ type: 'issue_number', value: m[1] });
    }

    // Commit hashes (7-40 char hex)
    const commitMatches = text.matchAll(/\b([a-f0-9]{7,40})\b/g);
    for (const m of commitMatches) {
      if (!/(\d{4}-\d{2}-\d{2})/.test(m[1])) {
        entities.push({ type: 'commit_hash', value: m[1] });
      }
    }

    // Quoted symbol names
    const symbolMatches = text.matchAll(/['"](\w+)['"]/g);
    for (const m of symbolMatches) {
      entities.push({ type: 'symbol', value: m[1] });
    }

    // CamelCase/PascalCase words (likely symbols)
    const camelMatches = text.matchAll(/\b([A-Z][a-z]+[A-Z]\w+)\b/g);
    for (const m of camelMatches) {
      entities.push({ type: 'symbol', value: m[1] });
    }

    // File paths (containing / or .)
    const pathMatches = text.matchAll(/\b([\w./\\-]+\.[a-z]{2,4})\b/g);
    for (const m of pathMatches) {
      if (m[1].includes('/') || m[1].includes('.')) {
        entities.push({ type: 'file_path', value: m[1] });
      }
    }

    return entities;
  }
}
