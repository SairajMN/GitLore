// ─── Core Domain Types ─────────────────────────────────────────────

export type ArtifactType = 'commit' | 'pr' | 'issue' | 'doc' | 'adr' | 'release_note' | 'snapshot';
export type SymbolKind = 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type' | 'enum' | 'module' | 'component' | 'route' | 'config' | 'test' | 'unknown';
export type RelationType = 'references' | 'introduces' | 'fixes' | 'blocks' | 'renames' | 'supersedes' | 'discusses' | 'explains' | 'implements' | 'depends_on' | 'breaks' | 'reverts' | 'mentions';
export type QueryIntent = 'why' | 'when' | 'what_changed' | 'dependency' | 'rationale' | 'edge_case' | 'unknown';
export type FeedbackType = 'helpful' | 'unhelpful' | 'inaccurate' | 'missing_evidence' | 'other';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Repository {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  git_url?: string;
  default_branch: string;
  is_private: boolean;
  is_indexed: boolean;
  last_indexed_at?: string;
  index_version: number;
  created_at: string;
  updated_at: string;
}

export interface Artifact {
  id: string;
  repository_id: string;
  artifact_type: ArtifactType;
  external_id?: string;
  title?: string;
  description?: string;
  content?: string;
  author?: string;
  date?: string;
  url?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CodeSymbol {
  id: string;
  repository_id: string;
  artifact_id?: string;
  name: string;
  kind: SymbolKind;
  file_path?: string;
  line_start?: number;
  line_end?: number;
  signature?: string;
  doc_comment?: string;
  created_at: string;
}

export interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Query {
  id: string;
  repository_id: string;
  text: string;
  intent?: QueryIntent;
  entities: Array<{ type: string; value: string }>;
  time_hints: Record<string, unknown>;
  created_at: string;
}

export interface Answer {
  id: string;
  query_id: string;
  answer_text: string;
  confidence: number;
  uncertainty_notes?: string;
  synthesis_latency_ms?: number;
  model_used?: string;
  evidence_ids: string[];
  hypotheses: Hypothesis[];
  created_at: string;
}

export interface Hypothesis {
  rank: number;
  explanation: string;
  confidence: number;
  evidence_ids: string[];
}

export interface EvidenceEntry {
  id: string;
  answer_id: string;
  artifact_id: string;
  relevance_score: number;
  excerpt?: string;
  claim?: string;
  citation_url?: string;
  is_direct: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ArtifactWithEvidence extends Artifact {
  relevance_score: number;
  excerpt?: string;
  claim?: string;
  is_direct: boolean;
}

export interface Feedback {
  id: string;
  answer_id: string;
  feedback_type: FeedbackType;
  comment?: string;
  created_at: string;
}

export interface Investigation {
  id: string;
  repository_id: string;
  title?: string;
  query_text: string;
  answer_id?: string;
  is_public: boolean;
  share_token: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Watchlist {
  id: string;
  repository_id: string;
  name: string;
  query_filters: Record<string, unknown>;
  notify_on_update: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// ─── API Types ─────────────────────────────────────────────────────

export interface ConnectRepoRequest {
  owner: string;
  name: string;
  token?: string;
}

export interface ConnectRepoResponse {
  repository: Repository;
  indexing_job_id: string;
}

export interface QueryRequest {
  repository_id: string;
  text: string;
}

export interface QueryResponse {
  query_id: string;
  answer: Answer;
  evidence: EvidenceEntry[];
  timeline: TimelineEvent[];
}

export interface TimelineEvent {
  date: string;
  artifact_type: ArtifactType;
  title: string;
  description?: string;
  url?: string;
  author?: string;
}

export interface EvidenceCard {
  artifact: Artifact;
  excerpt: string;
  claim: string;
  relevance_score: number;
  is_direct: boolean;
  citation_url: string;
}

// ─── Provider Types ───────────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  models: Record<string, string>;
  priority: number;
}

export interface GenerateTextOptions {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  system?: string;
}

export interface GenerateTextResult {
  text: string;
  model: string;
  provider: string;
  latencyMs: number;
  tokensUsed?: number;
}

export interface StructuredExtractOptions {
  text: string;
  schema: Record<string, unknown>;
  instructions: string;
  model: string;
}

export interface StructuredExtractResult {
  data: Record<string, unknown>;
  model: string;
  provider: string;
}

// ─── Pipeline Types ───────────────────────────────────────────────

export interface QueryInterpretation {
  intent: QueryIntent;
  entities: Array<{ type: string; value: string }>;
  timeHints: Record<string, unknown>;
  searchTerms: string[];
  confidence: number;
}

export interface EvidencePack {
  entries: Array<{
    artifact: Artifact;
    relevanceScore: number;
    excerpt: string;
    claim: string;
    isDirect: boolean;
  }>;
  coverage: 'sufficient' | 'partial' | 'insufficient';
  gaps: string[];
  totalSources: number;
}

export interface SynthesisInput {
  query: QueryInterpretation;
  evidence: EvidencePack;
  originalQuestion: string;
}

export interface RerankOptions {
  query: string;
  candidates: Array<{ id: string; text: string }>;
  model: string;
  topK: number;
}

export interface RerankResult {
  ranked: Array<{ id: string; score: number }>;
  model: string;
  provider: string;
}

export interface IndexStatusResponse {
  repository_id: string;
  is_indexed: boolean;
  last_indexed_at?: string;
  index_version: number;
  artifact_counts: Record<string, number>;
  job_status?: JobStatus;
}
