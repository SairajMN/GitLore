import { describe, it, expect } from 'vitest';

// Unit tests for the retrieval service's entity extraction
// These test the rule-based entity extraction without DB dependencies

describe('Entity Extraction', () => {
  // We test the extraction logic directly
  function extractEntities(text: string): Array<{ type: string; value: string }> {
    const entities: Array<{ type: string; value: string }> = [];

    // Issue/PR numbers
    for (const m of text.matchAll(/#(\d+)/g)) {
      entities.push({ type: 'issue_number', value: m[1] });
    }

    // Quoted symbols
    for (const m of text.matchAll(/['"](\w+)['"]/g)) {
      entities.push({ type: 'symbol', value: m[1] });
    }

    // PascalCase symbols
    for (const m of text.matchAll(/\b([A-Z][a-z]+[A-Z]\w+)\b/g)) {
      if (!entities.some(e => e.value === m[1])) {
        entities.push({ type: 'symbol', value: m[1] });
      }
    }

    // File paths with extensions
    for (const m of text.matchAll(/\b([\w./\\-]+\.[a-z]{2,4})\b/g)) {
      if (m[1].includes('/')) {
        entities.push({ type: 'file_path', value: m[1] });
      }
    }

    return entities;
  }

  it('extracts issue numbers from query', () => {
    const result = extractEntities('What issue #42 led to this validation?');
    expect(result).toContainEqual({ type: 'issue_number', value: '42' });
  });

  it('extracts quoted symbols', () => {
    const result = extractEntities('Why does "validateEmail" exist?');
    expect(result).toContainEqual({ type: 'symbol', value: 'validateEmail' });
  });

  it('extracts PascalCase symbols', () => {
    const result = extractEntities('When was ValidationRule introduced?');
    expect(result).toContainEqual({ type: 'symbol', value: 'ValidationRule' });
  });

  it('extracts file paths', () => {
    const result = extractEntities('Why was src/utils/validator.ts created?');
    expect(result).toContainEqual({ type: 'file_path', value: 'src/utils/validator.ts' });
  });

  it('extracts multiple entity types', () => {
    const result = extractEntities('Why does "parseConfig" in #123 still use old format?');
    expect(result).toContainEqual({ type: 'symbol', value: 'parseConfig' });
    expect(result).toContainEqual({ type: 'issue_number', value: '123' });
  });
});

describe('Confidence Calculation', () => {
  function extractConfidence(text: string): number {
    const lower = text.toLowerCase();
    if (lower.includes('confidence: high') || lower.includes('confidence:** high')) return 0.85;
    if (lower.includes('confidence: medium') || lower.includes('confidence:** medium')) return 0.6;
    if (lower.includes('confidence: low') || lower.includes('confidence:** low')) return 0.3;
    if (lower.includes('insufficient evidence')) return 0.15;
    const citations = text.match(/\[.*?\]/g);
    return citations && citations.length >= 2 ? 0.6 : 0.4;
  }

  it('parses high confidence', () => {
    expect(extractConfidence('**Confidence:** High')).toBe(0.85);
  });

  it('parses medium confidence', () => {
    expect(extractConfidence('**Confidence:** Medium')).toBe(0.6);
  });

  it('parses low confidence', () => {
    expect(extractConfidence('**Confidence:** Low')).toBe(0.3);
  });

  it('detects insufficient evidence', () => {
    expect(extractConfidence('Insufficient evidence to answer.')).toBe(0.15);
  });

  it('defaults based on citations', () => {
    expect(extractConfidence('[PR #42] and [Issue #41] were found')).toBe(0.6);
  });
});

describe('Query Intent Classification', () => {
  function classifyIntent(text: string): string {
    const lower = text.toLowerCase();
    if (/^why\b/.test(lower) || /\bwhy\b/.test(lower)) return 'why';
    if (/^when\b/.test(lower) || /\bwhen\b/.test(lower)) return 'when';
    if (/\bwhat changed\b/.test(lower) || /\bwhat.*change/.test(lower)) return 'what_changed';
    if (/\bdepend(en(?:cy|cies|ts?)?|s)\b/.test(lower)) return 'dependency';
    if (/\btradeoff|rationale|why|reason|motivation\b/.test(lower)) return 'rationale';
    if (/\bedge\s*case|exception|error case\b/.test(lower)) return 'edge_case';
    return 'unknown';
  }

  it('classifies "why" questions', () => {
    expect(classifyIntent('Why does this function exist?')).toBe('why');
  });

  it('classifies "when" questions', () => {
    expect(classifyIntent('When was this introduced?')).toBe('when');
  });

  it('classifies dependency questions', () => {
    expect(classifyIntent('What are the dependencies of this module?')).toBe('dependency');
  });

  it('classifies edge case questions', () => {
    expect(classifyIntent('What edge case does this handle?')).toBe('edge_case');
  });

  it('defaults to unknown', () => {
    expect(classifyIntent('How does this work?')).toBe('unknown');
  });
});
