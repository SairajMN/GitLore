import * as db from '@/lib/db';
import * as types from '@/types';

/**
 * Simple regex-based symbol extractor for common patterns.
 * Extracts functions, classes, interfaces from code content.
 * This is a baseline - can be upgraded to tree-sitter based extraction.
 */
export class SymbolExtractor {
  private patterns: Array<{ kind: types.SymbolKind; regex: RegExp }> = [
    { kind: 'function', regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g },
    { kind: 'function', regex: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/g },
    { kind: 'class', regex: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g },
    { kind: 'interface', regex: /(?:export\s+)?interface\s+(\w+)/g },
    { kind: 'type', regex: /(?:export\s+)?type\s+(\w+)/g },
    { kind: 'enum', regex: /(?:export\s+)?enum\s+(\w+)/g },
    { kind: 'method', regex: /(\w+)\s*\([^)]*\)\s*{/g },
    { kind: 'component', regex: /(?:export\s+)?(?:function\s+)?(\w+)\s*:\s*React\.FC/g },
    { kind: 'component', regex: /(?:export\s+)?(?:const\s+)?(\w+)\s*:\s*React\.ReactNode/g },
    { kind: 'route', regex: /router\.(get|post|put|delete|patch)\s*\(\s*['"](\/[^'"]+)['"]/g },
    { kind: 'config', regex: /(?:export\s+)?(?:const\s+)?(\w+)\s*=\s*\{/g },
    { kind: 'test', regex: /(?:describe|it|test)\s*\(\s*['"]([^'"]+)['"]/g },
  ];

  async extractFromArtifact(repoId: string, artifact: types.Artifact): Promise<types.CodeSymbol[]> {
    const symbols: types.CodeSymbol[] = [];
    const content = artifact.content || artifact.description || '';

    // Extract from commit messages for file paths mentioned
    if (artifact.artifact_type === 'commit') {
      try {
        const parsed = JSON.parse(content);
        const files = parsed.files || [];
        for (const file of files) {
          symbols.push({
            id: '', repository_id: repoId, artifact_id: artifact.id,
            name: file.path, kind: 'unknown', file_path: file.path,
            created_at: new Date().toISOString(),
          });
        }
      } catch { /* not JSON content, use text patterns */ }
    }

    // Apply regex patterns
    for (const { kind, regex } of this.patterns) {
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const name = match[1] || match[2] || 'unknown';
        if (name.length < 2 || name === 'export' || name === 'default') continue;

        // Deduplicate by name within this artifact
        if (symbols.some(s => s.name === name)) continue;

        symbols.push({
          id: '', repository_id: repoId, artifact_id: artifact.id,
          name, kind, file_path: undefined,
          created_at: new Date().toISOString(),
        });
      }
    }

    // Store in database
    const stored: types.CodeSymbol[] = [];
    for (const symbol of symbols) {
      try {
        const s = await db.insertSymbol(symbol);
        stored.push(s);
      } catch {
        // Skip duplicates or errors
      }
    }

    return stored;
  }

  async extractFromText(repoId: string, text: string, filePath?: string): Promise<types.CodeSymbol[]> {
    const symbols: types.CodeSymbol[] = [];

    for (const { kind, regex } of this.patterns) {
      const matches = text.matchAll(regex);
      for (const match of matches) {
        const name = match[1] || match[2] || 'unknown';
        if (name.length < 2 || name === 'export' || name === 'default') continue;
        if (symbols.some(s => s.name === name)) continue;

        symbols.push({
          id: '', repository_id: repoId, artifact_id: undefined,
          name, kind, file_path: filePath || undefined,
          created_at: new Date().toISOString(),
        });
      }
    }

    const stored: types.CodeSymbol[] = [];
    for (const symbol of symbols) {
      try {
        const s = await db.insertSymbol(symbol);
        stored.push(s);
      } catch { /* skip */ }
    }
    return stored;
  }
}
