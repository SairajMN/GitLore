import * as types from '@/types';
import * as db from '@/lib/db';
import { QueryInterpreter } from './query-interpreter';
import { RetrievalService } from '@/lib/services/retrieval';
import { EvidencePackBuilder } from '@/lib/services/evidence-builder';
import { AnswerSynthesizer } from '@/lib/services/answer-synthesizer';
import { IngestionService } from '@/lib/services/ingestion';
import { SymbolExtractor } from '@/lib/services/symbol-extractor';

/**
 * PipelineOrchestrator coordinates the full query pipeline:
 * Query Interpretation → Retrieval → Evidence Builder → Answer Synthesis
 */
export class PipelineOrchestrator {
  private queryInterpreter = new QueryInterpreter();
  private retrievalService = new RetrievalService();
  private evidenceBuilder = new EvidencePackBuilder();
  private answerSynthesizer = new AnswerSynthesizer();
  private ingestionService?: IngestionService;
  private symbolExtractor = new SymbolExtractor();

  /**
   * Ingest a repository (step 1 of onboarding).
   */
  async ingestRepo(owner: string, name: string, token?: string) {
    this.ingestionService = new IngestionService(token);
    return this.ingestionService.ingestRepository(owner, name);
  }

  /**
   * Run the full query pipeline: interpret → retrieve → build evidence → synthesize.
   */
  async runQuery(repoId: string, text: string): Promise<types.QueryResponse> {
    // 1. Query Interpretation
    const interpretation = await this.queryInterpreter.interpret(text);
    console.log(`[Orchestrator] Intent: ${interpretation.intent}, Search terms: ${JSON.stringify(interpretation.searchTerms)}, Entities: ${interpretation.entities.length}`);

    // 2. Store the query
    const query = await db.insertQuery({
      repository_id: repoId,
      text,
      intent: interpretation.intent,
      entities: interpretation.entities,
      time_hints: interpretation.timeHints,
    });

    // 3. Retrieve artifacts (hybrid search)
    const artifacts = await this.retrievalService.retrieve(
      repoId, interpretation.searchTerms, interpretation.entities
    );
    console.log(`[Orchestrator] Retrieved ${artifacts.length} artifacts: ${artifacts.map(a => `${a.artifact_type}:${a.title?.substring(0, 30)}`).join(', ')}`);

    // 4. Build evidence pack and store answer placeholder
    const answer = await db.insertAnswer({
      query_id: query.id,
      answer_text: 'Synthesizing...',
      confidence: 0,
      evidence_ids: artifacts.map(a => a.id),
    });

    // 5. Build evidence pack with answer ID
    const evidencePack = await this.evidenceBuilder.build(artifacts, text, answer.id);

    // 6. Synthesize answer
    const synthesis = await this.answerSynthesizer.synthesize({
      query: interpretation,
      evidence: evidencePack,
      originalQuestion: text,
    });

    // 7. Update answer with final text
    const finalAnswer = await db.insertAnswer({
      id: answer.id,
      query_id: query.id,
      answer_text: synthesis.answerText,
      confidence: synthesis.confidence,
      uncertainty_notes: synthesis.uncertaintyNotes,
      synthesis_latency_ms: synthesis.latencyMs,
      model_used: synthesis.modelUsed,
      evidence_ids: artifacts.map(a => a.id),
      hypotheses: synthesis.hypotheses,
    });

    // 8. Build timeline
    const timeline = await this.retrievalService.buildTimeline(repoId, artifacts);

    // 9. Get evidence entries
    const { evidence } = await db.getAnswerWithEvidence(finalAnswer.id);

    return {
      query_id: query.id,
      answer: finalAnswer,
      evidence,
      timeline,
    };
  }

  /**
   * Extract symbols from all artifacts in a repo.
   */
  async extractSymbols(repoId: string): Promise<number> {
    const artifacts = await db.getArtifactsByRepo(repoId);
    let total = 0;
    for (const artifact of artifacts) {
      const symbols = await this.symbolExtractor.extractFromArtifact(repoId, artifact);
      total += symbols.length;
    }
    return total;
  }

  /**
   * Reindex a repository incrementally.
   */
  async reindexRepo(repoId: string, token?: string): Promise<void> {
    const repo = await db.getRepositoryById(repoId);
    if (!repo) throw new Error('Repository not found');

    this.ingestionService = new IngestionService(token);
    await this.ingestionService.ingestRepository(repo.owner, repo.name);
  }
}
