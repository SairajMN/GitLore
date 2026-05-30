import OpenAI from 'openai';
import { LLMProvider } from './interface';
import {
  GenerateTextOptions, GenerateTextResult,
  StructuredExtractOptions, StructuredExtractResult,
  RerankOptions, RerankResult,
} from '@/types';

export class GroqProvider implements LLMProvider {
  name = 'groq';
  private client: OpenAI;
  private available = false;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.warn('Groq: No API key found. Provider will be unavailable.');
      this.client = new OpenAI({ apiKey: 'dummy' });
      return;
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    this.available = true;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const start = Date.now();
    const response = await this.client.chat.completions.create({
      model: options.model || 'llama-3.3-70b-versatile',
      messages: [
        ...(options.system ? [{ role: 'system' as const, content: options.system }] : []),
        { role: 'user', content: options.prompt },
      ],
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2048,
    });

    const model = options.model || 'llama-3.3-70b-versatile';
    return {
      text: response.choices[0]?.message?.content || '',
      model,
      provider: this.name,
      latencyMs: Date.now() - start,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  async extractStructured(options: StructuredExtractOptions): Promise<StructuredExtractResult> {
    const systemPrompt = `You are a structured data extractor. Extract the requested information.
Instructions: ${options.instructions}
Return ONLY valid JSON matching the schema.`;

    const model = options.model || 'llama-3.3-70b-versatile';
    const result = await this.generateText({
      prompt: options.text,
      model,
      system: systemPrompt,
      temperature: 0.1,
      maxTokens: 2048,
    });

    try {
      const cleaned = result.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      const data = JSON.parse(cleaned);
      return { data, model: options.model || 'llama-3.3-70b-versatile', provider: this.name };
    } catch {
      return { data: { error: 'Failed to parse structured output' }, model: options.model || 'llama-3.3-70b-versatile', provider: this.name };
    }
  }

  async rerankCandidates(options: RerankOptions): Promise<RerankResult> {
    const systemPrompt = `Rank candidates by relevance. Return a JSON array of {id, score}.
    Score 0-1. Only return the JSON array.`;

    const candidatesText = options.candidates.map(c =>
      `[${c.id.substring(0, 8)}] ${c.text.substring(0, 500)}`
    ).join('\n---\n');

    const result = await this.generateText({
      prompt: `Query: ${options.query}\n\nCandidates:\n${candidatesText}\n\nTop ${options.topK} ranked:`,
      model: options.model || 'llama-3.3-70b-versatile',
      system: systemPrompt,
      temperature: 0.1,
      maxTokens: 2048,
    });

    try {
      const ranked = JSON.parse(result.text.replace(/```json?/g, '').replace(/```/g, '').trim());
      return { ranked: ranked.slice(0, options.topK), model: options.model || 'llama-3.3-70b-versatile', provider: this.name };
    } catch {
      return { ranked: options.candidates.slice(0, options.topK).map(c => ({ id: c.id, score: 0.5 })), model: options.model || 'llama-3.3-70b-versatile', provider: this.name };
    }
  }
}
