import { GenerateTextOptions, GenerateTextResult, StructuredExtractOptions, StructuredExtractResult, RerankOptions, RerankResult } from '@/types';

/**
 * LLMProvider is the core abstraction for all model interactions.
 * All adapters must implement this interface.
 */
export interface LLMProvider {
  name: string;
  generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
  extractStructured(options: StructuredExtractOptions): Promise<StructuredExtractResult>;
  rerankCandidates(options: RerankOptions): Promise<RerankResult>;
  isAvailable(): boolean;
}

/**
 * Model routing configuration.
 * Maps stage names to provider:model strings.
 */
export interface ModelConfig {
  queryClassification: string;
  evidenceSummarization: string;
  answerSynthesis: string;
  embedding: string;
}
