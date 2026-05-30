import { Pool } from 'pg';
import * as types from '@/types';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://gitlore:gitlore@localhost:5432/gitlore',
  max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
});
pool.on('error', (err) => { console.error('PG pool error:', err); });

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

// ─── Repositories ─────────────────────────────────────────────────

export async function createRepository(data: types.ConnectRepoRequest): Promise<types.Repository> {
  const full_name = `${data.owner}/${data.name}`;
  const r = await query(
    `INSERT INTO repositories (owner,name,full_name) VALUES ($1,$2,$3)
     ON CONFLICT (full_name) DO UPDATE SET updated_at = NOW() RETURNING *`,
    [data.owner, data.name, full_name]
  );
  return r.rows[0];
}

export async function getRepository(fullName: string): Promise<types.Repository | null> {
  const r = await query('SELECT * FROM repositories WHERE full_name = $1', [fullName]);
  return r.rows[0] || null;
}

export async function getRepositoryById(id: string): Promise<types.Repository | null> {
  const r = await query('SELECT * FROM repositories WHERE id = $1', [id]);
  return r.rows[0] || null;
}

export async function updateRepositoryIndex(id: string, version: number): Promise<void> {
  await query('UPDATE repositories SET is_indexed=true,last_indexed_at=NOW(),index_version=$2 WHERE id=$1', [id, version]);
}

// ─── Artifacts ────────────────────────────────────────────────────

export async function insertArtifact(a: Partial<types.Artifact>): Promise<types.Artifact> {
  const r = await query(
    `INSERT INTO artifacts (repository_id,artifact_type,external_id,title,description,content,author,date,url,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING *`,
    [a.repository_id, a.artifact_type, a.external_id || null, a.title || null, a.description || null,
    a.content || null, a.author || null, a.date || null, a.url || null, a.metadata || {}]
  );
  return r.rows[0];
}

export async function getArtifactByExternalId(repoId: string, externalId: string): Promise<types.Artifact | null> {
  const r = await query('SELECT * FROM artifacts WHERE repository_id=$1 AND external_id=$2', [repoId, externalId]);
  return r.rows[0] || null;
}

export async function getArtifactById(id: string): Promise<types.Artifact | null> {
  const r = await query('SELECT * FROM artifacts WHERE id=$1', [id]);
  return r.rows[0] || null;
}

export async function getArtifactsByRepo(repoId: string, type?: types.ArtifactType): Promise<types.Artifact[]> {
  const sql = type
    ? 'SELECT * FROM artifacts WHERE repository_id=$1 AND artifact_type=$2 ORDER BY date DESC NULLS LAST'
    : 'SELECT * FROM artifacts WHERE repository_id=$1 ORDER BY date DESC NULLS LAST';
  const r = await query(sql, type ? [repoId, type] : [repoId]);
  return r.rows;
}

export async function getArtifactCountsByRepo(repoId: string): Promise<Record<string, number>> {
  const r = await query('SELECT artifact_type,COUNT(*) as count FROM artifacts WHERE repository_id=$1 GROUP BY artifact_type', [repoId]);
  const counts: Record<string, number> = {};
  for (const row of r.rows) counts[row.artifact_type] = parseInt(row.count, 10);
  return counts;
}

// ─── Symbols ─────────────────────────────────────────────────────

export async function insertSymbol(s: Partial<types.CodeSymbol>): Promise<types.CodeSymbol> {
  const r = await query(
    `INSERT INTO code_symbols (repository_id,artifact_id,name,kind,file_path,line_start,line_end,signature,doc_comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [s.repository_id, s.artifact_id || null, s.name, s.kind || 'unknown', s.file_path || null,
    s.line_start || null, s.line_end || null, s.signature || null, s.doc_comment || null]
  );
  return r.rows[0];
}

export async function searchSymbols(repoId: string, name: string): Promise<types.CodeSymbol[]> {
  const r = await query('SELECT * FROM code_symbols WHERE repository_id=$1 AND name ILIKE $2 ORDER BY name LIMIT 50', [repoId, `%${name}%`]);
  return r.rows;
}

// ─── Search ──────────────────────────────────────────────────────

export async function lexicalSearch(repoId: string, queryText: string, limit = 20): Promise<types.Artifact[]> {
  const r = await query(
    `SELECT * FROM artifacts WHERE repository_id=$1
     AND search_vector @@ plainto_tsquery('english', $2)
     ORDER BY ts_rank(search_vector, plainto_tsquery('english', $2)) DESC LIMIT $3`,
    [repoId, queryText, limit]
  );
  return r.rows;
}

export async function exactMatchSearch(repoId: string, searchText: string, limit = 20): Promise<types.Artifact[]> {
  const r = await query(
    `SELECT * FROM artifacts WHERE repository_id=$1
     AND (title ILIKE $2 OR description ILIKE $2 OR content ILIKE $2)
     ORDER BY date DESC NULLS LAST LIMIT $3`,
    [repoId, `%${searchText}%`, limit]
  );
  return r.rows;
}

// ─── Relations ────────────────────────────────────────────────────

export async function insertRelation(sourceId: string, targetId: string, relationType: types.RelationType, metadata: Record<string, unknown> = {}): Promise<void> {
  await query('INSERT INTO relations (source_id,target_id,relation_type,metadata) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [sourceId, targetId, relationType, metadata]);
}

export async function getRelatedArtifacts(artifactId: string, relationType?: types.RelationType): Promise<any[]> {
  const sql = relationType
    ? `SELECT a.*,r.relation_type,r.metadata as relation_metadata FROM artifacts a
       JOIN relations r ON (r.target_id=a.id OR r.source_id=a.id)
       WHERE (r.source_id=$1 OR r.target_id=$1) AND r.relation_type=$2`
    : `SELECT a.*,r.relation_type,r.metadata as relation_metadata FROM artifacts a
       JOIN relations r ON (r.target_id=a.id OR r.source_id=a.id)
       WHERE r.source_id=$1 OR r.target_id=$1`;
  const r = await query(sql + ' ORDER BY a.date DESC NULLS LAST', relationType ? [artifactId, relationType] : [artifactId]);
  return r.rows;
}

// ─── Queries & Answers ───────────────────────────────────────────

export async function insertQuery(data: Partial<types.Query>): Promise<types.Query> {
  const r = await query('INSERT INTO queries (repository_id,text,intent,entities,time_hints) VALUES ($1,$2,$3,$4,$5) RETURNING *', [data.repository_id, data.text, data.intent || null, JSON.stringify(data.entities || []), JSON.stringify(data.time_hints || {})]);
  return r.rows[0];
}

export async function insertAnswer(data: Partial<types.Answer>): Promise<types.Answer> {
  if (data.id) {
    // Update existing answer (used when finalizing synthesis)
    const r = await query(
      `UPDATE answers SET answer_text=$2,confidence=$3,uncertainty_notes=$4,synthesis_latency_ms=$5,
       model_used=$6,evidence_ids=$7,hypotheses=$8 WHERE id=$1 RETURNING *`,
      [data.id, data.answer_text, data.confidence || 0, data.uncertainty_notes || null,
      data.synthesis_latency_ms || null, data.model_used || null, data.evidence_ids || [], JSON.stringify(data.hypotheses || [])]
    );
    return r.rows[0];
  }
  const r = await query(
    `INSERT INTO answers (query_id,answer_text,confidence,uncertainty_notes,synthesis_latency_ms,model_used,evidence_ids,hypotheses)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.query_id, data.answer_text, data.confidence || 0, data.uncertainty_notes || null,
    data.synthesis_latency_ms || null, data.model_used || null, data.evidence_ids || [], JSON.stringify(data.hypotheses || [])]
  );
  return r.rows[0];
}

export async function getAnswerWithEvidence(answerId: string): Promise<{ answer: types.Answer | null; evidence: types.EvidenceEntry[] }> {
  const a = await query('SELECT * FROM answers WHERE id=$1', [answerId]);
  const answer = a.rows[0] || null;
  if (!answer) return { answer: null, evidence: [] };
  const e = await query('SELECT * FROM evidence WHERE answer_id=$1 ORDER BY relevance_score DESC', [answerId]);
  return { answer, evidence: e.rows };
}

// ─── Evidence ─────────────────────────────────────────────────────

export async function insertEvidence(data: Partial<types.EvidenceEntry>): Promise<types.EvidenceEntry> {
  const r = await query(
    `INSERT INTO evidence (answer_id,artifact_id,relevance_score,excerpt,claim,citation_url,is_direct,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.answer_id, data.artifact_id, data.relevance_score || 0, data.excerpt || null, data.claim || null,
    data.citation_url || null, data.is_direct || false, JSON.stringify(data.metadata || {})]
  );
  return r.rows[0];
}

// ─── Feedback ─────────────────────────────────────────────────────

export async function insertFeedback(data: Partial<types.Feedback>): Promise<types.Feedback> {
  const r = await query('INSERT INTO feedback (answer_id,feedback_type,comment) VALUES ($1,$2,$3) RETURNING *', [data.answer_id, data.feedback_type, data.comment || null]);
  return r.rows[0];
}


export async function getClient() {
  return pool.connect();
}


// ─── Investigations ──────────────────────────────────────────────

export async function createInvestigation(data: Partial<types.Investigation>): Promise<types.Investigation> {
  const r = await query('INSERT INTO investigations (repository_id,title,query_text,answer_id,is_public,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [data.repository_id, data.title || null, data.query_text, data.answer_id || null, data.is_public || false, data.created_by || null]);
  return r.rows[0];
}

export async function getInvestigation(id: string): Promise<types.Investigation | null> {
  const r = await query('SELECT * FROM investigations WHERE id=$1', [id]);
  return r.rows[0] || null;
}

export async function getInvestigationByToken(token: string): Promise<types.Investigation | null> {
  const r = await query('SELECT * FROM investigations WHERE share_token=$1', [token]);
  return r.rows[0] || null;
}

// ─── Watchlists ──────────────────────────────────────────────────

export async function createWatchlist(data: Partial<types.Watchlist>): Promise<types.Watchlist> {
  const r = await query('INSERT INTO watchlists (repository_id,name,query_filters,notify_on_update,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [data.repository_id, data.name, JSON.stringify(data.query_filters || {}), data.notify_on_update || false, data.created_by || null]);
  return r.rows[0];
}

export async function getWatchlists(repoId: string): Promise<types.Watchlist[]> {
  const r = await query('SELECT * FROM watchlists WHERE repository_id=$1 ORDER BY created_at DESC', [repoId]);
  return r.rows;
}

// ─── Indexing Jobs ──────────────────────────────────────────────

export async function createIndexingJob(repoId: string): Promise<{ id: string }> {
  const r = await query('INSERT INTO indexing_jobs (repository_id) VALUES ($1) RETURNING id', [repoId]);
  return r.rows[0];
}

export async function updateIndexingJob(id: string, status: types.JobStatus, artifactsProcessed?: number, errors?: number): Promise<void> {
  await query(
    `UPDATE indexing_jobs SET status=$2::job_status,artifacts_processed=COALESCE($3,artifacts_processed),errors=COALESCE($4,errors),
     started_at=CASE WHEN $2::text='running' THEN NOW() ELSE started_at END,
     completed_at=CASE WHEN $2::text IN ('completed','failed') THEN NOW() ELSE completed_at END WHERE id=$1`,
    [id, status, artifactsProcessed || 0, errors || 0]
  );
}

export async function getLatestIndexingJob(repoId: string): Promise<{ id: string; status: string } | null> {
  const r = await query('SELECT id,status FROM indexing_jobs WHERE repository_id=$1 ORDER BY created_at DESC LIMIT 1', [repoId]);
  return r.rows[0] || null;
}

// ─── Audit ─────────────────────────────────────────────────────────

export async function logAudit(action: string, details: Record<string, unknown> = {}, repoId?: string, performedBy?: string, ipAddress?: string): Promise<void> {
  await query('INSERT INTO audit_log (repository_id,action,details,performed_by,ip_address) VALUES ($1,$2,$3,$4,$5)', [repoId || null, action, JSON.stringify(details), performedBy || null, ipAddress || null]);
}

// ─── Cleanup ──────────────────────────────────────────────────────

export async function deleteRepositoryArtifacts(repoId: string): Promise<void> {
  await query('DELETE FROM code_symbols WHERE repository_id=$1', [repoId]);
  await query('DELETE FROM artifacts WHERE repository_id=$1', [repoId]);
  await query('UPDATE repositories SET is_indexed=false,index_version=0 WHERE id=$1', [repoId]);
}