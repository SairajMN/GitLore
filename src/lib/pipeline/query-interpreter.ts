import * as types from '@/types';
import { getRouter } from '@/lib/providers/router';

/**
 * QueryInterpreter classifies intent, resolves entities, and detects time hints.
 */
export class QueryInterpreter {
  async interpret(text: string): Promise<types.QueryInterpretation> {
    const router = getRouter();

    // 1. Rule-based entity extraction (fast, no LLM needed)
    const entities = this.extractEntities(text);
    const timeHints = this.extractTimeHints(text);

    // 2. LLM-based intent classification
    try {
      const result = await router.extractStructured({
        text,
        schema: {
          intent: 'why | when | what_changed | dependency | rationale | edge_case | unknown',
          searchTerms: ['string'],
          confidence: 0.0,
        },
        instructions: 'Classify the user query intent for a code archaeology tool. Extract key search terms. Return JSON.',
        model: router.getModelForStage('queryClassification'),
      });

      const intent = (result.data.intent as types.QueryIntent) || 'unknown';
      const searchTerms = (result.data.searchTerms as string[]) || text.split(/\s+/).filter(t => t.length > 2);
      const confidence = (result.data.confidence as number) || 0.5;

      return { intent, entities, timeHints, searchTerms, confidence };
    } catch {
      // Fallback to rule-based classification
      const intent = this.classifyIntent(text);
      // Use all meaningful words (>= 2 chars) as search terms for better recall
      const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
        'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
        'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between',
        'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'this', 'that',
        'these', 'those', 'and', 'but', 'or', 'nor', 'not', 'so', 'what', 'which', 'who',
        'when', 'where', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
        'other', 'some', 'such', 'than', 'too', 'very', 'just', 'about', 'also', 'only']);
      const searchTerms = text
        .toLowerCase()
        .replace(/[^a-z0-9\s._/-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !stopWords.has(t));
      return { intent, entities, timeHints, searchTerms, confidence: 0.4 };
    }
  }

  private extractEntities(text: string): Array<{ type: string; value: string }> {
    const entities: Array<{ type: string; value: string }> = [];

    // Issue/PR numbers
    for (const m of text.matchAll(/#(\d+)/g)) {
      entities.push({ type: 'issue_number', value: m[1] });
    }

    // Commit hashes
    for (const m of text.matchAll(/\b([a-f0-9]{7,40})\b/g)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m[1])) {
        entities.push({ type: 'commit_hash', value: m[1] });
      }
    }

    // Quoted symbols
    for (const m of text.matchAll(/['"](\w+)['"]/g)) {
      entities.push({ type: 'symbol', value: m[1] });
    }

    // PascalCase (symbols/classes)
    for (const m of text.matchAll(/\b([A-Z][a-z]+[A-Z]\w+)\b/g)) {
      if (!entities.some(e => e.value === m[1])) {
        entities.push({ type: 'symbol', value: m[1] });
      }
    }

    // File paths
    for (const m of text.matchAll(/\b([\w./\\-]+\.[a-z]{2,4})\b/g)) {
      if (m[1].includes('/') || m[1].includes('\\')) {
        entities.push({ type: 'file_path', value: m[1] });
      }
    }

    return entities;
  }

  private extractTimeHints(text: string): Record<string, unknown> {
    const hints: Record<string, unknown> = {};

    // Version references
    const versionMatch = text.match(/v?(\d+\.\d+(?:\.\d+)?)/);
    if (versionMatch) hints.version = versionMatch[1];

    // Year references
    const yearMatch = text.match(/\b(20\d{2})\b/);
    if (yearMatch) hints.year = parseInt(yearMatch[1]);

    // Relative time references
    if (/\b(recent|latest|new)\b/i.test(text)) hints.recency = 'recent';
    if (/\b(old|legacy|original)\b/i.test(text)) hints.recency = 'old';
    if (/\b(future|upcoming|next)\b/i.test(text)) hints.recency = 'future';

    return hints;
  }

  private classifyIntent(text: string): types.QueryIntent {
    const lower = text.toLowerCase();

    if (/^why\b/.test(lower) || /\bwhy\b/.test(lower)) return 'why';
    if (/^when\b/.test(lower) || /\bwhen\b/.test(lower)) return 'when';
    if (/\bwhat changed\b/.test(lower) || /\bwhat.*change/.test(lower)) return 'what_changed';
    if (/\bdepend(ency|s|ent)\b/.test(lower)) return 'dependency';
    if (/\btradeoff|rationale|why|reason|motivation\b/.test(lower)) return 'rationale';
    if (/\bedge\s*case|exception|error case\b/.test(lower)) return 'edge_case';

    return 'unknown';
  }

  /** Check if the query is asking for a diagram/architecture visualization */
  static isDiagramQuery(text: string): boolean {
    const lower = text.toLowerCase();
    return /\b(diagram|flowchart|architecture|arch\b|system design|data flow|component|module|class diagram|sequence diagram|er diagram|erd|mermaid|visuali[sz]e|draw|graph|tree|hierarchy|dependency graph|call graph|overview|structure)\b/.test(lower);
  }
}
