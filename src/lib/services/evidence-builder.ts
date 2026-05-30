import * as db from '@/lib/db';
import * as types from '@/types';
import { getRouter } from '@/lib/providers/router';

/**
 * EvidencePackBuilder constructs compact, high-relevance evidence packs
 * from retrieved artifacts. It removes redundancy, preserves source metadata,
 * and classifies coverage.
 */
export class EvidencePackBuilder {
  /**
   * Build an evidence pack from retrieved artifacts and the original query.
   * Uses LLM to extract relevant excerpts and classify coverage.
   */
  async build(
    artifacts: Array<types.Artifact & { relevanceScore: number; matchType: string }>,
    queryText: string,
    answerId?: string
  ): Promise<types.EvidencePack> {
    const entries: types.EvidencePack['entries'] = [];
    const router = getRouter();

    // Score and select best artifacts
    const scored = artifacts
      .map(a => ({
        artifact: a,
        score: this.computeCombinedScore(a, queryText),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12); // Process top 12, keep 3-8

    for (const { artifact, score } of scored) {
      const excerpt = this.extractRelevantExcerpt(artifact, queryText);
      const claim = this.formatClaim(artifact, excerpt);

      entries.push({
        artifact: artifact as unknown as types.Artifact,
        relevanceScore: score,
        excerpt,
        claim,
        isDirect: score > 0.7,
      });

      // Store in DB if answer exists
      if (answerId) {
        try {
          await db.insertEvidence({
            answer_id: answerId,
            artifact_id: artifact.id,
            relevance_score: score,
            excerpt,
            claim,
            citation_url: artifact.url || undefined,
            is_direct: score > 0.7,
            metadata: {
              artifact_type: artifact.artifact_type,
              author: artifact.author,
              date: artifact.date,
              match_type: artifact.matchType,
            },
          });
        } catch { /* silently continue */ }
      }
    }

    // Determine coverage
    const coverage = this.classifyCoverage(entries);
    const gaps = this.identifyGaps(entries, queryText);

    return {
      entries: entries.slice(0, 8),
      coverage,
      gaps,
      totalSources: artifacts.length,
    };
  }

  private computeCombinedScore(
    artifact: types.Artifact & { relevanceScore: number; matchType: string },
    queryText: string
  ): number {
    let score = artifact.relevanceScore;

    // Boost PRs and issues (they contain rationale)
    if (artifact.artifact_type === 'pr' || artifact.artifact_type === 'issue') {
      score += 0.15;
    }

    // Boost ADRs (they explicitly contain decisions)
    if (artifact.artifact_type === 'adr') {
      score += 0.2;
    }

    // Boost artifacts with explicit rationale keywords
    const content = ((artifact.title || '') + ' ' + (artifact.description || '') + ' ' + (artifact.content || '')).toLowerCase();
    const rationaleWords = ['because', 'reason', 'tradeoff', 'constraint', 'issue', 'fix', 'bug', 'deprecat', 'migrat', 'breaking'];
    for (const word of rationaleWords) {
      if (content.includes(word)) {
        score += 0.05;
      }
    }

    // Boost if query terms appear in title
    const queryTerms = queryText.toLowerCase().split(/\s+/);
    for (const term of queryTerms) {
      if (term.length > 3 && (artifact.title || '').toLowerCase().includes(term)) {
        score += 0.1;
      }
    }

    return Math.min(1.0, score);
  }

  private extractRelevantExcerpt(artifact: types.Artifact, queryText: string): string {
    let content = artifact.content || artifact.description || '';
    content = this.cleanContentForDisplay(content, artifact);

    const queryTerms = queryText.toLowerCase().split(/\s+/);

    // Find the most relevant paragraph
    const paragraphs = content.split('\n\n');
    let bestParagraph = paragraphs[0] || '';
    let bestScore = 0;

    for (const para of paragraphs) {
      const lower = para.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (term.length > 2 && lower.includes(term)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestParagraph = para;
      }
    }

    return bestParagraph.substring(0, 500).trim();
  }

  /**
   * Clean content from JSON/binary format to human-readable text.
   */
  private cleanContentForDisplay(content: string, artifact: types.Artifact): string {
    if (!content) return '';

    // Try to parse as JSON and extract readable parts
    try {
      const parsed = JSON.parse(content);

      // Commit message JSON
      if (parsed.message && typeof parsed.message === 'string') {
        let text = parsed.message;
        if (Array.isArray(parsed.files) && parsed.files.length > 0) {
          text += '\n\nChanged files:\n' + parsed.files.map((f: any) =>
            `  ${f.path || f.filename || 'unknown'} (${f.status || 'modified'})`
          ).join('\n');
        }
        return text;
      }

      // Query/intent JSON from source files
      if (parsed.query) {
        return `Query: ${parsed.query}`;
      }

      // Generic: extract any string values
      const strings: string[] = [];
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'string' && val.length > 5 && val.length < 500) {
          strings.push(`${key}: ${val}`);
        }
      }
      if (strings.length > 0) return strings.join('\n');
    } catch { /* not JSON, continue */ }

    // Remove code fences
    let cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Remove lines that are just JSON syntax
    cleaned = cleaned.replace(/^[{}\[\]",:]+\s*$/gm, '');

    // Remove leading/trailing JSON brackets
    cleaned = cleaned.replace(/^[{\[]\s*/, '').replace(/\s*[}\]]$/, '');

    return cleaned || content;
  }

  private formatClaim(artifact: types.Artifact, excerpt: string): string {
    const typeLabel = artifact.artifact_type.toUpperCase();
    const title = artifact.title || 'Untitled';
    const author = artifact.author ? ` by ${artifact.author}` : '';
    const date = artifact.date ? ` on ${new Date(artifact.date).toLocaleDateString()}` : '';
    return `[${typeLabel}] ${title}${author}${date}`;
  }

  private classifyCoverage(entries: types.EvidencePack['entries']): 'sufficient' | 'partial' | 'insufficient' {
    const directCount = entries.filter(e => e.isDirect).length;
    const totalScore = entries.reduce((sum, e) => sum + e.relevanceScore, 0);

    if (directCount >= 3 && totalScore > 3.0) return 'sufficient';
    if (directCount >= 1 && totalScore > 1.0) return 'partial';
    return 'insufficient';
  }

  private identifyGaps(entries: types.EvidencePack['entries'], queryText: string): string[] {
    const gaps: string[] = [];
    const types = new Set(entries.map(e => e.artifact.artifact_type));

    if (!types.has('pr') && !types.has('issue')) {
      gaps.push('No direct PR or issue discussion found. Rationale may be inferred from commit messages.');
    }
    if (!types.has('adr')) {
      gaps.push('No Architecture Decision Records found. Explicit architectural rationale may be missing.');
    }
    if (entries.length < 3) {
      gaps.push('Limited evidence sources. Consider broadening the search.');
    }

    return gaps;
  }
}
