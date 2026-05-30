-- Enable pgvector and uuid extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Repositories table
CREATE TABLE repositories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  full_name VARCHAR(512) NOT NULL UNIQUE,
  git_url TEXT,
  default_branch VARCHAR(255) DEFAULT 'main',
  is_private BOOLEAN DEFAULT false,
  is_indexed BOOLEAN DEFAULT false,
  last_indexed_at TIMESTAMPTZ,
  index_version INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner, name)
);

-- Artifact types
CREATE TYPE artifact_type AS ENUM (
  'commit', 'pr', 'issue', 'doc', 'adr', 'release_note', 'snapshot'
);

-- Artifacts table
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  artifact_type artifact_type NOT NULL,
  external_id VARCHAR(512),
  title TEXT,
  description TEXT,
  content TEXT,
  author VARCHAR(255),
  date TIMESTAMPTZ,
  url TEXT,
  metadata JSONB DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE artifacts ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content, ''))
  ) STORED;

CREATE INDEX idx_artifacts_search ON artifacts USING GIN(search_vector);
CREATE INDEX idx_artifacts_repo ON artifacts(repository_id);
CREATE INDEX idx_artifacts_type ON artifacts(artifact_type);
CREATE INDEX idx_artifacts_external_id ON artifacts(external_id);
CREATE INDEX idx_artifacts_date ON artifacts(date DESC);

-- Code symbols table
CREATE TYPE symbol_kind AS ENUM (
  'function', 'class', 'method', 'variable', 'interface', 'type',
  'enum', 'module', 'component', 'route', 'config', 'test', 'unknown'
);

CREATE TABLE code_symbols (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  name VARCHAR(512) NOT NULL,
  kind symbol_kind DEFAULT 'unknown',
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  signature TEXT,
  doc_comment TEXT,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_symbols_repo ON code_symbols(repository_id);
CREATE INDEX idx_symbols_name ON code_symbols(name);
CREATE INDEX idx_symbols_kind ON code_symbols(kind);
CREATE INDEX idx_symbols_file ON code_symbols(file_path);

-- Chunks for granular retrieval
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  sequence INTEGER DEFAULT 0,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_artifact ON chunks(artifact_id);

-- Relations between artifacts
CREATE TYPE relation_type AS ENUM (
  'references', 'introduces', 'fixes', 'blocks', 'renames',
  'supersedes', 'discusses', 'explains', 'implements', 'depends_on',
  'breaks', 'reverts', 'mentions'
);

CREATE TABLE relations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  relation_type relation_type NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX idx_relations_source ON relations(source_id);
CREATE INDEX idx_relations_target ON relations(target_id);
CREATE INDEX idx_relations_type ON relations(relation_type);

-- Queries
CREATE TABLE queries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  intent VARCHAR(64),
  entities JSONB DEFAULT '[]',
  time_hints JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Answers
CREATE TABLE answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_id UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  confidence FLOAT DEFAULT 0.0,
  uncertainty_notes TEXT,
  synthesis_latency_ms INTEGER,
  model_used VARCHAR(255),
  evidence_ids UUID[] DEFAULT '{}',
  hypotheses JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_answers_query ON answers(query_id);

-- Evidence entries linking answers to artifacts
CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  answer_id UUID NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  relevance_score FLOAT DEFAULT 0.0,
  excerpt TEXT,
  claim TEXT,
  citation_url TEXT,
  is_direct BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_evidence_answer ON evidence(answer_id);
CREATE INDEX idx_evidence_artifact ON evidence(artifact_id);

-- Feedback
CREATE TYPE feedback_type AS ENUM ('helpful', 'unhelpful', 'inaccurate', 'missing_evidence', 'other');

CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  answer_id UUID NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  feedback_type feedback_type NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Investigations (saved/shared)
CREATE TABLE investigations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  title TEXT,
  query_text TEXT NOT NULL,
  answer_id UUID REFERENCES answers(id) ON DELETE SET NULL,
  is_public BOOLEAN DEFAULT false,
  share_token UUID DEFAULT uuid_generate_v4(),
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlists
CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  query_filters JSONB DEFAULT '{}',
  notify_on_update BOOLEAN DEFAULT false,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing jobs
CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE indexing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  status job_status DEFAULT 'pending',
  artifacts_processed INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
  action VARCHAR(64) NOT NULL,
  details JSONB DEFAULT '{}',
  performed_by VARCHAR(255),
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_repo ON audit_log(repository_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_artifact ON chunks(artifact_id);
