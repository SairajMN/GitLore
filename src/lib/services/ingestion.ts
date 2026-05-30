import { Octokit } from 'octokit';
import * as db from '@/lib/db';

/**
 * GitHub Ingestion Service
 * Fetches commits, PRs, issues, docs from a GitHub repository and stores them as artifacts.
 */
export class IngestionService {
  private octokit: Octokit;

  constructor(token?: string) {
    // Only authenticate if a valid token is provided (PAT or installation token)
    // For public repos, unauthenticated requests work (60 req/hr rate limit)
    const config: Record<string, any> = {};
    if (token && token.startsWith('ghp_') || token?.startsWith('github_pat_') || token?.startsWith('ghs_')) {
      config.auth = token;
    }
    this.octokit = new Octokit(config);
  }

  async ingestRepository(owner: string, name: string): Promise<{
    repoId: string; jobId: string;
    counts: { commits: number; prs: number; issues: number; docs: number };
  }> {
    const repo = await db.createRepository({ owner, name });
    const repoId = repo.id;

    // Check if repo already has artifacts — skip full re-fetch
    const existingCounts = await db.getArtifactCountsByRepo(repoId);
    const existingTotal = Object.values(existingCounts).reduce((sum, c) => sum + c, 0);
    if (existingTotal > 5) {
      console.log(`[Ingestion] Repo ${owner}/${name} already has ${existingTotal} artifacts, skipping full ingest`);
      const job = await db.createIndexingJob(repoId);
      await db.updateIndexingJob(job.id, 'completed', existingTotal);
      return {
        repoId, jobId: job.id,
        counts: { commits: existingCounts.commit || 0, prs: existingCounts.pr || 0, issues: existingCounts.issue || 0, docs: (existingCounts.doc || 0) + (existingCounts.adr || 0) },
      };
    }

    const job = await db.createIndexingJob(repoId);
    await db.updateIndexingJob(job.id, 'running');

    let counts = { commits: 0, prs: 0, issues: 0, docs: 0 };
    const startTime = Date.now();
    const MAX_DURATION = 45000;

    try {
      // Only fetch what doesn't exist yet
      const existingCommitIds = new Set(
        (await db.query('SELECT external_id FROM artifacts WHERE repository_id=$1 AND artifact_type=$2', [repoId, 'commit'])).rows.map((r: any) => r.external_id)
      );
      const existingPRIds = new Set(
        (await db.query('SELECT external_id FROM artifacts WHERE repository_id=$1 AND artifact_type=$2', [repoId, 'pr'])).rows.map((r: any) => r.external_id)
      );
      const existingIssueIds = new Set(
        (await db.query('SELECT external_id FROM artifacts WHERE repository_id=$1 AND artifact_type=$2', [repoId, 'issue'])).rows.map((r: any) => r.external_id)
      );

      // 1. Fetch commits (skip already stored)
      if (Date.now() - startTime < MAX_DURATION) {
        const commits = await this.fetchCommits(owner, name);
        for (const c of commits) {
          if (!existingCommitIds.has(c.sha)) { await this.storeCommit(repoId, c); counts.commits++; }
        }
        console.log(`[Ingestion] Stored ${counts.commits} new commits (skipped ${commits.length - counts.commits} existing)`);
      }

      // 2. Fetch PRs (skip already stored)
      if (Date.now() - startTime < MAX_DURATION) {
        const prs = await this.fetchPRs(owner, name);
        for (const pr of prs) {
          if (!existingPRIds.has(String(pr.number))) { await this.storePR(repoId, pr); counts.prs++; }
        }
        console.log(`[Ingestion] Stored ${counts.prs} new PRs`);
      }

      // 3. Fetch issues (skip already stored)
      if (Date.now() - startTime < MAX_DURATION) {
        const issues = await this.fetchIssues(owner, name);
        for (const issue of issues) {
          if (!existingIssueIds.has(String(issue.number))) { await this.storeIssue(repoId, issue); counts.issues++; }
        }
        console.log(`[Ingestion] Stored ${counts.issues} new issues`);
      }

      // 4. Fetch README only if not already stored
      if (Date.now() - startTime < MAX_DURATION) {
        const existingDocCount = (existingCounts.doc || 0) + (existingCounts.adr || 0);
        if (existingDocCount === 0) {
          const readme = await this.fetchFile(owner, name, 'README.md');
          if (readme) { await this.storeDoc(repoId, readme); counts.docs++; }
        }
        console.log(`[Ingestion] Stored ${counts.docs} docs`);
      }

      // 5. Fetch source files only if none exist
      if (Date.now() - startTime < MAX_DURATION && existingTotal === 0) {
        const filesStored = await this.fetchSourceFiles(owner, name, repoId, startTime, MAX_DURATION);
        console.log(`[Ingestion] Stored ${filesStored} source files`);
        counts.docs += filesStored;
      }

      const total = counts.commits + counts.prs + counts.issues + counts.docs;
      await db.updateIndexingJob(job.id, 'completed', total);
      await db.updateRepositoryIndex(repoId, 1);
      await db.logAudit('index_completed', { counts }, repoId);
      console.log(`[Ingestion] Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    } catch (err) {
      console.error(`[Ingestion] Failed:`, err instanceof Error ? err.message : err);
      await db.updateIndexingJob(job.id, 'failed', undefined, 1);
      await db.logAudit('index_failed', { error: String(err) }, repoId);
      throw err;
    }
    return { repoId, jobId: job.id, counts };
  }


  private async fetchCommits(owner: string, name: string): Promise<any[]> {
    try {
      const { data } = await this.octokit.rest.repos.listCommits({
        owner, repo: name, per_page: 100,
      });
      return data;
    } catch (err) {
      console.error(`[Ingestion] Failed to fetch commits:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async storeCommit(repoId: string, commit: any): Promise<void> {
    // Store commit content as readable text instead of JSON
    const message = commit.commit.message || '';
    const files = (commit.files || []).map((f: any) => {
      const path = f.filename || f.path || 'unknown';
      const status = f.status || 'modified';
      const changes = f.additions && f.deletions ? ` (+${f.additions}/-${f.deletions})` : '';
      return `  ${path} [${status}]${changes}`;
    });
    const content = files.length > 0
      ? `${message}\n\nChanged files (${files.length}):\n${files.join('\n')}`
      : message;

    await db.insertArtifact({
      repository_id: repoId, artifact_type: 'commit',
      external_id: commit.sha,
      title: message.split('\n')[0],
      description: message,
      content,
      author: commit.commit.author?.name || commit.author?.login,
      date: commit.commit.author?.date || commit.commit.committer?.date,
      url: commit.html_url,
      metadata: { sha: commit.sha, author_login: commit.author?.login },
    });
  }

  private async fetchPRs(owner: string, name: string): Promise<any[]> {
    try {
      const { data } = await this.octokit.rest.pulls.list({
        owner, repo: name, state: 'all', per_page: 50, sort: 'updated', direction: 'desc',
      });
      return data;
    } catch (err) {
      console.error(`[Ingestion] Failed to fetch PRs:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async storePR(repoId: string, pr: any): Promise<void> {
    await db.insertArtifact({
      repository_id: repoId, artifact_type: 'pr',
      external_id: String(pr.number), title: pr.title,
      description: pr.body || '',
      content: `${pr.title}\n\n${pr.body || ''}`,
      author: pr.user?.login, date: pr.created_at, url: pr.html_url,
      metadata: {
        number: pr.number, state: pr.state, merged: !!pr.merged_at,
        labels: (pr.labels || []).map((l: any) => l.name),
      },
    });
  }

  private async fetchIssues(owner: string, name: string): Promise<any[]> {
    try {
      const { data } = await this.octokit.rest.issues.listForRepo({
        owner, repo: name, state: 'all', per_page: 50, sort: 'updated', direction: 'desc',
      });
      return data.filter((i: any) => !i.pull_request);
    } catch (err) {
      console.error(`[Ingestion] Failed to fetch issues:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async storeIssue(repoId: string, issue: any): Promise<void> {
    await db.insertArtifact({
      repository_id: repoId, artifact_type: 'issue',
      external_id: String(issue.number), title: issue.title,
      description: issue.body || '',
      content: `${issue.title}\n\n${issue.body || ''}`,
      author: issue.user?.login, date: issue.created_at, url: issue.html_url,
      metadata: {
        number: issue.number, state: issue.state,
        labels: (issue.labels || []).map((l: any) => l.name),
        is_bug: (issue.labels || []).some((l: any) => l.name?.toLowerCase().includes('bug')),
      },
    });
  }

  private async fetchDocs(owner: string, name: string): Promise<any[]> {
    const docs: any[] = [];
    const paths = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
    for (const p of paths) {
      const doc = await this.fetchFile(owner, name, p);
      if (doc) docs.push(doc);
    }
    for (const dir of ['docs', 'adr']) {
      try {
        const { data } = await this.octokit.rest.repos.getContent({ owner, repo: name, path: dir });
        if (Array.isArray(data)) {
          for (const item of data.filter((i: any) => i.name.endsWith('.md'))) {
            const doc = await this.fetchFile(owner, name, item.path);
            if (doc) docs.push(doc);
          }
        }
      } catch (err) {
        console.error(`[Ingestion] Failed to fetch docs dir ${dir} for ${owner}/${name}:`, err instanceof Error ? err.message : err);
      }
    }
    return docs;
  }

  private async fetchFile(owner: string, name: string, path: string): Promise<any | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({ owner, repo: name, path });
      if (!Array.isArray(data) && 'content' in data && data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { path: data.path, name: data.name, content, sha: data.sha, url: data.html_url };
      }
      return null;
    } catch { return null; }
  }

  private async storeDoc(repoId: string, doc: any): Promise<void> {
    const isADR = doc.path?.toLowerCase().includes('adr');
    await db.insertArtifact({
      repository_id: repoId,
      artifact_type: isADR ? 'adr' : 'doc',
      external_id: doc.sha,
      title: doc.name?.replace(/\.md$/, '') || doc.path,
      description: doc.content?.substring(0, 500),
      content: doc.content,
      url: doc.url,
      metadata: { path: doc.path, sha: doc.sha },
    });
  }

  /**
   * Fetch source code files from the repository tree.
   * Uses the Git Trees API for efficient file discovery, then fetches content.
   */
  private async fetchSourceFiles(owner: string, name: string, repoId: string, startTime?: number, maxDuration?: number): Promise<number> {
    let stored = 0;
    try {
      const { data: tree } = await this.octokit.rest.git.getTree({
        owner, repo: name, tree_sha: 'HEAD', recursive: 'true',
      });

      const codeExtensions = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt',
        '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
        '.html', '.css', '.scss', '.less', '.vue', '.svelte',
        '.json', '.yaml', '.yml', '.toml',
        '.sh', '.sql', '.prisma', '.graphql',
      ]);

      const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', 'vendor', 'coverage']);
      const skipFiles = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

      const codeFiles = tree.tree.filter((item: any) => {
        if (item.type !== 'blob') return false;
        const pathParts = item.path.split('/');
        if (pathParts.some((p: string) => skipDirs.has(p))) return false;
        if (skipFiles.has(item.path)) return false;
        if (item.size && item.size > 50000) return false;
        const ext = '.' + item.path.split('.').pop()?.toLowerCase();
        return codeExtensions.has(ext);
      });

      // Sort: root-level files first, then by size (smallest first)
      const sorted = codeFiles.sort((a: any, b: any) => {
        const aDepth = a.path.split('/').length;
        const bDepth = b.path.split('/').length;
        return aDepth - bDepth || (a.size || 0) - (b.size || 0);
      });

      // Max 10 source files to stay within rate limits
      const filesToStore = sorted.slice(0, 10);
      console.log(`[Ingestion] Found ${codeFiles.length} code files, fetching top ${filesToStore.length}`);

      for (const file of filesToStore) {
        // Check timeout before each file fetch
        if (startTime && maxDuration && (Date.now() - startTime >= maxDuration)) break;

        try {
          const doc = await this.fetchFile(owner, name, file.path);
          if (doc && doc.content) {
            const ext = file.path.split('.').pop()?.toLowerCase() || 'unknown';
            const title = file.path.split('/').pop() || file.path;
            const baseUrl = `https://github.com/${owner}/${name}/blob/main`;
            await db.insertArtifact({
              repository_id: repoId,
              artifact_type: 'doc',
              external_id: file.sha,
              title: `${title} (${file.path})`,
              description: `Source file: ${file.path}`,
              content: `File: ${file.path}\nLanguage: ${ext}\nSize: ${file.size || 0} bytes\n\n${doc.content}`,
              url: `${baseUrl}/${file.path}`,
              metadata: { path: file.path, sha: file.sha, type: 'source_file', language: ext, size: file.size },
            });
            stored++;
          }
        } catch { /* skip unreadable files */ }
      }
    } catch (err) {
      console.error(`[Ingestion] Failed to fetch file tree:`, err instanceof Error ? err.message : err);
    }
    return stored;
  }
}
