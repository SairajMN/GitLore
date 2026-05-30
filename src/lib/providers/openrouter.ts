import OpenAI from 'openai';
import { LLMProvider } from './interface';
import {
  GenerateTextOptions, GenerateTextResult,
  StructuredExtractOptions, StructuredExtractResult,
  RerankOptions, RerankResult,
} from '@/types';

export class OpenRouterProvider implements LLMProvider {
  name = 'openrouter';
  private client: OpenAI;
  private available = false;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn('OpenRouter: No API key found. Provider will be unavailable.');
      this.client = new OpenAI({ apiKey: 'dummy' });
      return;
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'GitLore',
      },
    });
    this.available = true;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const start = Date.now();
    const response = await this.client.chat.completions.create({
      model: options.model || 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [
        ...(options.system ? [{ role: 'system' as const, content: options.system }] : []),
        { role: 'user', content: options.prompt },
      ],
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2048,
    });

    return {
      text: response.choices[0]?.message?.content || '',
      model: options.model || 'meta-llama/llama-3.1-8b-instruct:free',
      provider: this.name,
      latencyMs: Date.now() - start,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  async extractStructured(options: StructuredExtractOptions): Promise<StructuredExtractResult> {
    const systemPrompt = `You are a structured data extractor. Extract the requested information from the text.
Follow these instructions precisely: ${options.instructions}
Return ONLY valid JSON matching the schema provided.`;

    const result = await this.generateText({
      prompt: options.text,
      model: options.model || 'meta-llama/llama-3.1-8b-instruct:free',
      system: systemPrompt,
      temperature: 0.1,
      maxTokens: 2048,
    });

    try {
      const cleaned = result.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      const data = JSON.parse(cleaned);
      return { data, model: options.model || 'meta-llama/llama-3.1-8b-instruct:free', provider: this.name };
    } catch {
      console.error('OpenRouter: Failed to parse structured output', result.text.substring(0, 200));
      return { data: { error: 'Failed to parse structured output', raw: result.text }, model: options.model || 'meta-llama/llama-3.1-8b-instruct:free', provider: this.name };
    }
  }

  async rerankCandidates(options: RerankOptions): Promise<RerankResult> {
    const systemPrompt = `You are a relevance ranker. Given a query and a list of candidates,
rank them by relevance to the query. Return a JSON array of objects with "id" and "score" (0-1).
Only return the JSON array, no other text.`;

    const candidatesText = options.candidates.map((c, i) =>
      `[${i}] ID: ${c.id}\nText: ${c.text.substring(0, 500)}`
    ).join('\n\n---\n\n');

    const result = await this.generateText({
      prompt: `Query: ${options.query}\n\nCandidates to rank:\n${candidatesText}\n\nReturn top ${options.topK} ranked as JSON array.`,
      model: options.model || 'meta-llama/llama-3.1-8b-instruct:free',
      system: systemPrompt,
      temperature: 0.1,
      maxTokens: 2048,
    });

    try {
      const cleaned = result.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      const ranked = JSON.parse(cleaned);
      return { ranked: ranked.slice(0, options.topK), model: options.model || 'meta-llama/llama-3.1-8b-instruct:free', provider: this.name };
    } catch {
      return { ranked: options.candidates.slice(0, options.topK).map(c => ({ id: c.id, score: 0.5 })), model: options.model || 'meta-llama/llama-3.1-8b-instruct:free', provider: this.name };
    }
  }
}
