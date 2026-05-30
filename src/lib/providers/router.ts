import { LLMProvider, ModelConfig } from './interface';
import { OpenRouterProvider } from './openrouter';
import { GroqProvider } from './groq';
import { InceptionProvider } from './inception';
import {
  GenerateTextOptions, GenerateTextResult,
  StructuredExtractOptions, StructuredExtractResult,
  RerankOptions, RerankResult,
} from '@/types';

/**
 * ModelRouter manages provider selection with automatic fallback.
 * Routes requests to the best available provider for each pipeline stage.
 */
export class ModelRouter {
  private providers: LLMProvider[] = [];
  private config: ModelConfig;

  constructor(config?: Partial<ModelConfig>) {
    const openrouter = new OpenRouterProvider();
    const groq = new GroqProvider();
    const inception = new InceptionProvider();
    this.providers = [openrouter, groq, inception].filter(p => p.isAvailable());

    this.config = {
      queryClassification: 'openrouter:google/gemini-2.0-flash-lite-preview-02-05:free',
      evidenceSummarization: 'groq:llama-3.3-70b-versatile',
      answerSynthesis: 'openrouter:meta-llama/llama-3.1-8b-instruct:free',
      embedding: 'openrouter:text-embedding-3-small',
    };

    if (process.env.QUERY_CLASSIFICATION_MODEL) this.config.queryClassification = process.env.QUERY_CLASSIFICATION_MODEL;
    if (process.env.EVIDENCE_SUMMARIZATION_MODEL) this.config.evidenceSummarization = process.env.EVIDENCE_SUMMARIZATION_MODEL;
    if (process.env.ANSWER_SYNTHESIS_MODEL) this.config.answerSynthesis = process.env.ANSWER_SYNTHESIS_MODEL;
    if (process.env.EMBEDDING_MODEL) this.config.embedding = process.env.EMBEDDING_MODEL;
  }

  private parseModelSpec(spec: string): { providerName: string; modelName: string } {
    const parts = spec.split(':');
    if (parts.length >= 2) {
      const providerName = parts[0].toLowerCase();
      const modelName = parts.slice(1).join(':');
      return { providerName, modelName };
    }
    return { providerName: 'openrouter', modelName: spec };
  }

  private getProvider(name: string): LLMProvider | undefined {
    return this.providers.find(p => p.name === name);
  }

  private getFirstAvailable(): LLMProvider | undefined {
    return this.providers[0];
  }


  // Provider-specific fallback models
  private fallbackModels: Record<string, string> = {
    openrouter: 'google/gemini-2.0-flash-001:free',
    groq: 'llama-3.3-70b-versatile',
    inception: 'mercury',
  };

  async generateText(options: GenerateTextOptions, stage?: string): Promise<GenerateTextResult> {
    let modelSpec = options.model;
    if (stage && !options.model) {
      if (stage === 'queryClassification') modelSpec = this.config.queryClassification;
      else if (stage === 'evidenceSummarization') modelSpec = this.config.evidenceSummarization;
      else modelSpec = this.config.answerSynthesis;
    }
    const { providerName, modelName } = this.parseModelSpec(
      modelSpec || 'openrouter:google/gemini-2.0-flash-001:free'
    );
    const primaryProvider = this.getProvider(providerName) || this.getFirstAvailable();
    if (!primaryProvider) throw new Error('No LLM providers available');

    const errors: string[] = [];
    for (const provider of [primaryProvider, ...this.providers.filter(p => p.name !== primaryProvider.name)]) {
      // Use provider-specific model name during fallback
      const fallbackModel = provider.name !== primaryProvider.name
        ? (this.fallbackModels[provider.name] || modelName)
        : modelName;
      try {
        return await provider.generateText({ ...options, model: fallbackModel });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.name}: ${msg}`);
        continue;
      }
    }
    throw new Error(`All providers failed: ${errors.join('; ')}`);
  }

  async extractStructured(options: StructuredExtractOptions): Promise<StructuredExtractResult> {
    const { providerName, modelName } = this.parseModelSpec(
      options.model || 'openrouter:google/gemini-2.0-flash-001:free'
    );
    const primaryProvider = this.getProvider(providerName) || this.getFirstAvailable();
    if (!primaryProvider) throw new Error('No providers available');

    const errors: string[] = [];
    for (const provider of [primaryProvider, ...this.providers.filter(p => p.name !== primaryProvider.name)]) {
      const fallbackModel = provider.name !== primaryProvider.name
        ? (this.fallbackModels[provider.name] || modelName)
        : modelName;
      try {
        return await provider.extractStructured({ ...options, model: fallbackModel });
      } catch (err: unknown) {
        errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    throw new Error(`All providers failed: ${errors.join('; ')}`);
  }

  async rerankCandidates(options: RerankOptions): Promise<RerankResult> {
    const { providerName, modelName } = this.parseModelSpec(
      options.model || 'openrouter:google/gemini-2.0-flash-lite-preview-02-05:free'
    );
    const primaryProvider = this.getProvider(providerName) || this.getFirstAvailable();
    if (!primaryProvider) throw new Error('No providers available');

    const errors: string[] = [];
    for (const provider of [primaryProvider, ...this.providers.filter(p => p.name !== primaryProvider.name)]) {
      try {
        return await provider.rerankCandidates({ ...options, model: modelName });
      } catch (err: unknown) {
        errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    throw new Error(`All providers failed: ${errors.join('; ')}`);
  }

  getModelForStage(stage: 'queryClassification' | 'evidenceSummarization' | 'answerSynthesis'): string {
    return this.config[stage];
  }

  hasAvailableProviders(): boolean {
    return this.providers.length > 0;
  }
}

let routerInstance: ModelRouter | null = null;

export function getRouter(): ModelRouter {
  if (!routerInstance) routerInstance = new ModelRouter();
  return routerInstance;
}
