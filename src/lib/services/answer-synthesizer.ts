import * as types from '@/types';
import { getRouter } from '@/lib/providers/router';
import { QueryInterpreter } from '@/lib/pipeline/query-interpreter';

/**
 * AnswerSynthesizer generates grounded, evidence-based answers.
 * It NEVER invents historical rationale and always cites sources.
 */
export class AnswerSynthesizer {
  async synthesize(input: types.SynthesisInput): Promise<{
    answerText: string;
    confidence: number;
    uncertaintyNotes: string;
    hypotheses: types.Hypothesis[];
    modelUsed: string;
    latencyMs: number;
  }> {
    const start = Date.now();
    const router = getRouter();
    const evidenceContext = this.buildEvidenceContext(input.evidence);
    const isDiagram = QueryInterpreter.isDiagramQuery(input.originalQuestion);

    const systemPrompt = isDiagram
      ? `You are an expert software architect analyzing a codebase. Generate Mermaid diagrams to visualize the system.

RULES:
1. Analyze the evidence to understand the project structure, modules, and relationships.
2. Generate a valid Mermaid diagram that represents the system architecture/data flow/component structure.
3. Use appropriate diagram type: flowchart TB for architecture, flowchart LR for data flow, graph TD for dependencies, sequenceDiagram for interactions.
4. Add meaningful labels and descriptions to each node.
5. After the diagram, provide a brief explanation of what it shows.
6. Always wrap the Mermaid code in \`\`\`mermaid code fences.

Format your answer as:
**System Architecture:**

\`\`\`mermaid
[mermaid diagram code]
\`\`\`

**Explanation:** [brief explanation of the diagram]`
      : `You are an expert code archaeologist analyzing repository history. 
Your role: Explain why code exists the way it does, citing historical evidence.

RULES:
1. Only make claims supported by provided evidence. If insufficient, say so.
2. Cite every key claim with [TYPE: Title].
3. Distinguish: [EVIDENCE] = directly stated, [INFERRED] = logical conclusion, [MISSING] = not found.
4. Never invent commit messages, PR descriptions, or author intent.
5. If multiple explanations are plausible, present ranked hypotheses.
6. Be honest about uncertainty.
7. Prefer explicit discussion over inferred intent.`;

    const diagramInstructions = isDiagram
      ? `Based on the evidence (source files, commits, PRs, docs), generate a Mermaid diagram that visualizes the project's architecture, module relationships, or data flow. The diagram should be accurate to the codebase structure.`
      : '';

    const userPrompt = `## Query\n${input.originalQuestion}\n\n## Query Context\nIntent: ${input.query.intent}\nEntities: ${JSON.stringify(input.query.entities)}\nTime: ${JSON.stringify(input.query.timeHints)}\n\n## Evidence Pack\nCoverage: ${input.evidence.coverage}\nGaps: ${input.evidence.gaps.join('\n')}\n\n${evidenceContext}\n\n## Instructions\n${isDiagram ? diagramInstructions : `Write a concise answer that:
1. Directly answers the question
2. Cites evidence for each claim using [TYPE: Title]
3. Includes confidence assessment
4. Notes what is unknown
5. Includes timeline context where relevant
6. If insufficient evidence, state "Insufficient evidence" and show closest trail

Format:
**Answer:** [answer]
**Confidence:** [high/medium/low - explain why]
**Key Evidence:** [list with citations]
**Uncertainties:** [what's unknown]
**Timeline:** [key chronological events]`}`;


    try {
      const result = await router.generateText(
        { prompt: userPrompt, system: systemPrompt, temperature: 0.2, maxTokens: 2048 },
        'answerSynthesis'
      );
      const latency = Date.now() - start;
      return {
        answerText: result.text,
        confidence: this.extractConfidence(result.text),
        uncertaintyNotes: this.extractUncertainty(result.text),
        hypotheses: this.extractHypotheses(result.text),
        modelUsed: `${result.provider}/${result.model}`,
        latencyMs: latency,
      };
    } catch (err) {
      console.error(`[Synthesizer] LLM failed:`, err instanceof Error ? err.message : err);
      return {
        answerText: this.generateFallbackAnswer(input),
        confidence: 0.3,
        uncertaintyNotes: 'LLM synthesis failed. Evidence summary provided.',
        hypotheses: [],
        modelUsed: 'fallback',
        latencyMs: Date.now() - start,
      };
    }
  }

  private buildEvidenceContext(evidence: types.EvidencePack): string {
    return evidence.entries.map((e, i) =>
      `--- Source ${i + 1} ---\nType: ${e.artifact.artifact_type.toUpperCase()}\nTitle: ${e.artifact.title || 'Untitled'}\nAuthor: ${e.artifact.author || 'Unknown'}\nDate: ${e.artifact.date ? new Date(e.artifact.date).toISOString().split('T')[0] : 'Unknown'}\nURL: ${e.artifact.url || 'N/A'}\nRelevance: ${(e.relevanceScore * 100).toFixed(0)}%\nExcerpt: ${e.excerpt}`
    ).join('\n');
  }

  private extractConfidence(text: string): number {
    const lower = text.toLowerCase();
    if (lower.includes('confidence: high')) return 0.85;
    if (lower.includes('confidence: medium')) return 0.6;
    if (lower.includes('confidence: low')) return 0.3;
    if (lower.includes('insufficient evidence')) return 0.15;
    const citations = text.match(/\[.*?\]/g);
    return citations && citations.length >= 2 ? 0.6 : 0.4;
  }

  private extractUncertainty(text: string): string {
    const m = text.match(/\*\*uncertainties?\*\*:?\s*([^\n]*)/i);
    if (m) return m[1].trim();
    const m2 = text.match(/\[missing\].*?(?=\n|$)/gi);
    return m2 ? m2.join('; ') : '';
  }

  private extractHypotheses(text: string): types.Hypothesis[] {
    const h: types.Hypothesis[] = [];
    const h1 = text.match(/\*\*Hypothesis 1?\*\*:?\s*([^\n]*)/i);
    const h2 = text.match(/\*\*Hypothesis 2?\*\*:?\s*([^\n]*)/i);
    if (h1) h.push({ rank: 1, explanation: h1[1].trim(), confidence: 0.5, evidence_ids: [] });
    if (h2) h.push({ rank: 2, explanation: h2[1].trim(), confidence: 0.3, evidence_ids: [] });
    return h;
  }

  private generateFallbackAnswer(input: types.SynthesisInput): string {
    const ev = input.evidence;
    if (ev.entries.length === 0) {
      return '**Insufficient evidence found to answer this question.**\n\nThe repository does not contain artifacts that directly address this query. Consider rephrasing or checking if the repository has been fully indexed.';
    }

    const lines: string[] = [];
    lines.push(`Based on ${ev.entries.length} sources from repository history:\n`);

    // Group by type
    const byType: Record<string, typeof ev.entries> = {};
    for (const entry of ev.entries) {
      const type = entry.artifact.artifact_type;
      if (!byType[type]) byType[type] = [];
      byType[type].push(entry);
    }

    for (const [type, entries] of Object.entries(byType)) {
      const label = type === 'doc' ? 'Documentation' : type === 'pr' ? 'Pull Requests' : type === 'issue' ? 'Issues' : type === 'commit' ? 'Commits' : type.toUpperCase();
      lines.push(`**${label} (${entries.length}):**`);
      for (const entry of entries.slice(0, 3)) {
        const title = entry.artifact.title || 'Untitled';
        const author = entry.artifact.author ? ` by ${entry.artifact.author}` : '';
        const date = entry.artifact.date ? ` (${new Date(entry.artifact.date).toLocaleDateString()})` : '';
        // Show a cleaned excerpt (first 300 chars, skip JSON noise)
        let excerpt = entry.excerpt || '';
        // Try to extract readable text from JSON content
        try {
          const parsed = JSON.parse(excerpt);
          if (parsed.message) excerpt = parsed.message;
          else if (parsed.query) excerpt = `Query: ${parsed.query}`;
        } catch { /* not JSON, use as-is */ }
        excerpt = excerpt.replace(/```json[\s\S]*?```/g, '').replace(/```[\s\S]*?```/g, '').substring(0, 300).trim();
        if (excerpt) {
          lines.push(`- **${title}**${author}${date}\n  ${excerpt}`);
        } else {
          lines.push(`- **${title}**${author}${date}`);
        }
      }
    }

    if (ev.gaps.length > 0) {
      lines.push(`\n**Note:** ${ev.gaps[0]}`);
    }
    return lines.join('\n');
  }
}
