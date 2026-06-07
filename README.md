# GitLore

**The lore behind your codebase.**

GitLore is an AI-powered codebase archaeology system that explains *why* code exists, how it evolved, and what historical decisions, incidents, issues, PR discussions, and constraints shaped its current form.

**This is NOT a chatbot.**
**This is NOT a code completion tool.**
**This is NOT an IDE assistant.**
**This is a historical reasoning system for repositories.**

## 🎬 Demo

<https://youtu.be/PTGIIfTrbgU>

<iframe width="100%" height="420" src="https://www.youtube-nocookie.com/embed/PTGIIfTrbgU?si=6I7MoDiOZMKgR48F" title="GitLore Demo" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

📸 **See [`SCREENSHOTS.md`](./SCREENSHOTS.md) for the full screenshot walkthrough** — landing page, search, evidence view, timeline, and investigation panel.

🌐 **Live demo:** [https://gitlore.xyz](https://gitlore.xyz)

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Frontend (Next.js 15)              │
│  Port 3000  │  Landing, Search, Evidence, Timeline│
└──────────────────────┬──────────────────────────┘
                       │ Proxy API calls
                       ▼
┌─────────────────────────────────────────────────┐
│            Backend (Python FastAPI)             │
│  Port 8000  │  uv-managed, layered architecture  │
└──────────────────────┬──────────────────────────┘
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   PostgreSQL      pgvector      Redis
   (port 5432)   (embeddings)  (caching/queue)
```

## Quick Start

```bash
# 1. Start infrastructure
docker compose up -d postgres redis

# 2. Backend
cd backend
cp .env.example ../.env    # Or edit the root .env
# Add your API keys to .env
uv run uvicorn app.main:app --reload

# 3. Frontend (separate terminal)
cd ..
npm install
npm run dev

# 4. Open http://localhost:3000
```

## Backend Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI entry
│   ├── config.py            # Pydantic Settings (reads root .env)
│   ├── api/                 # API routes
│   │   ├── connect.py       # POST /api/connect
│   │   ├── query.py         # POST /api/query
│   │   ├── answer.py        # GET /api/answer/{id}
│   │   ├── feedback.py      # POST /api/feedback
│   │   ├── investigation.py # CRUD investigations
│   │   ├── watchlist.py     # CRUD watchlists
│   │   └── index_status.py  # GET /api/index-status
│   ├── db/
│   │   ├── database.py      # Async SQLAlchemy engine
│   │   ├── models.py        # 12 ORM tables
│   │   └── session.py       # Session factory
│   ├── schemas/schemas.py   # Pydantic v2 models
│   ├── providers/           # LLM provider abstraction
│   │   ├── interface.py     # Abstract LLMProvider
│   │   ├── router.py        # Fallback routing
│   │   ├── groq_adapter.py
│   │   ├── openrouter_adapter.py
│   │   └── inception_adapter.py
│   ├── ingestion/           # Repository ingestion
│   │   ├── github_client.py
│   │   ├── artifact_parser.py
│   │   ├── symbol_extractor.py
│   │   ├── relation_resolver.py
│   │   └── ingestion_service.py
│   ├── retrieval/           # Hybrid retrieval
│   │   ├── lexical_search.py
│   │   ├── semantic_search.py
│   │   ├── graph_expansion.py
│   │   └── retrieval_orchestrator.py
│   ├── services/            # Core pipeline
│   │   ├── query_interpreter.py
│   │   ├── evidence_builder.py
│   │   ├── answer_synthesizer.py
│   │   └── orchestrator.py
│   ├── workers/
│   │   └── indexing_worker.py
│   └── utils/               # Logging, security
├── tests/                   # 11 tests, all passing
├── alembic/                 # DB migrations
├── pyproject.toml           # uv-managed dependencies
└── Dockerfile
```

## Provider Abstraction

Three adapters implementing `LLMProvider` interface:

| Provider | Strength | Use Case |
|----------|----------|----------|
| **Groq** | Fast, cheap | Query classification, evidence summarization |
| **OpenRouter** | Broad model access | Final answer synthesis (stronger models) |
| **Inception Labs** | Specialized | Fallback / experimental |

Routing policy:
- Cheapest/fastest model that is good enough for the task
- Query classification, evidence summarization, and final synthesis routed separately
- Automatic fallback across providers on failure
- Provider logic isolated from core business logic

## Data Model

12 PostgreSQL tables with pgvector:

| Table | Purpose |
|-------|---------|
| `repositories` | Connected GitHub repositories |
| `artifacts` | Commits, PRs, issues, docs, ADRs, release notes |
| `code_symbols` | Extracted functions, classes, variables |
| `relations` | Cross-references between artifacts |
| `chunks` | Embedding chunks |
| `queries` | User questions |
| `answers` | Generated answers with confidence |
| `evidence` | Evidence entries per answer |
| `feedback` | User feedback on answer quality |
| `investigations` | Saved queries with metadata |
| `watchlists` | Monitored queries |
| `indexing_jobs` | Ingestion job tracking |
| `audit_log` | Security events |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/connect` | Register a repo, start indexing |
| `POST` | `/api/query` | Ask a question |
| `GET`  | `/api/answer/{id}` | Get answer with evidence |
| `POST` | `/api/feedback` | Submit feedback |
| `POST` | `/api/investigation` | Save an investigation |
| `GET`  | `/api/investigation/{id}` | Get investigation detail |
| `GET`  | `/api/investigation` | List investigations |
| `POST` | `/api/watchlist` | Create a watchlist |
| `GET`  | `/api/watchlist` | List watchlists |
| `GET`  | `/api/index-status` | Check indexing progress |
| `GET`  | `/api/health` | Health check |

---

# Evaluation Framework

## Corpus Manifest

The following repositories form the evaluation corpus. These span different languages, scales, and community structures to test GitLore across realistic scenarios.

| # | Repository | Language | Stars | Rationale |
|---|-----------|----------|-------|-----------|
| 1 | `facebook/react` | JavaScript | ~230k | Large-scale UI library, rich PR/issue history, ADRs in RFCs |
| 2 | `python/cpython` | Python | ~65k | Core language implementation, PEP-driven decisions |
| 3 | `curl/curl` | C | ~37k | Long history (25+ years), documented rationale in commit messages |
| 4 | `vercel/next.js` | JavaScript/TS | ~130k | Modern framework, detailed PR descriptions, active RFC process |
| 5 | `sqlite/sqlite` | C | ~7k | Extreme backwards-compatibility focus, documented design decisions |
| 6 | `postgres/postgres` | C | ~16k | Decades of architectural evolution, detailed commit messages |
| 7 | `redis/redis` | C | ~68k | Well-structured history, clear rationale in commits |
| 8 | `godotengine/godot` | C++ | ~95k | Multi-year development, documented tradeoffs in proposals |

## Query Intent Types

GitLore classifies queries into 8 intent types:

| # | Intent | Description | Example |
|---|--------|-------------|---------|
| 1 | `why` | Rationale for code existence | "Why does this function still support the old format?" |
| 2 | `when` | Temporal origin | "When was this edge case introduced?" |
| 3 | `what_changed` | Differential analysis | "What changed between v1 and v2?" |
| 4 | `dependency` | Dependency relationships | "What dependency caused the build to break?" |
| 5 | `edge_case` | Special-case handling | "What edge case does this workaround address?" |
| 6 | `rationale` | Tradeoff/decision analysis | "What tradeoff explains this implementation?" |
| 7 | `historical_trace` | Multi-hop lineage | "Trace the evolution of this error handling path" |
| 8 | `unknown` | Ambiguous query | "Tell me about this project" |

## Eight Base Traces

One evaluation trace per query intent type, using the corpus repositories:

### Trace 1: `why` — "Why does React use synthetic events?"
- **Target repo:** `facebook/react`
- **Expected evidence trail:** RFC → PR introducing event delegation → Issue discussing browser compatibility → Commit with synthetic event implementation
- **Expected answer:** Cross-browser normalization, performance through event pooling
- **Key artifacts:** PRs #123, #456, reactjs/rfcs

### Trace 2: `when` — "When was dict ordering guaranteed in Python?"
- **Target repo:** `python/cpython`
- **Expected evidence trail:** Python 3.7 release notes → PEP 468 → CPython commit introducing compact dict
- **Expected answer:** Python 3.6 (CPython implementation detail), 3.7 (language guarantee)
- **Key artifacts:** PEP 468, bpo-XXXXX, Python 3.7 release notes

### Trace 3: `what_changed` — "What changed between Next.js 12 and 13?"
- **Target repo:** `vercel/next.js`
- **Expected evidence trail:** Release notes v13 → PRs for App Router → Turbopack migration
- **Expected answer:** Pages Router → App Router, webpack → Turbopack, new data fetching model
- **Key artifacts:** Release notes, RFCs, migration guide PRs

### Trace 4: `dependency` — "What dependency requires OpenSSL on curl?"
- **Target repo:** `curl/curl`
- **Expected evidence trail:** Build configuration docs → configure.ac → Issues about TLS support
- **Expected answer:** HTTPS/TLS protocol support via OpenSSL (optional, alternative backends exist)
- **Key artifacts:** configure.ac, docs/INSTALL, build-related issues

### Trace 5: `edge_case` — "What edge case does the `array` binding in React address?"
- **Target repo:** `facebook/react`
- **Expected evidence trail:** Issue about stale closures → PR introducing useRef pattern → Documentation update
- **Expected answer:** Stale closure problem in callbacks, the `useCallback` + `useRef` pattern as solution

### Trace 6: `rationale` — "What tradeoff explains PostgreSQL's MVCC implementation?"
- **Target repo:** `postgres/postgres`
- **Expected evidence trail:** Commit messages → Hacker News discussions → README documentation
- **Expected answer:** Write performance vs storage size tradeoff — MVCC avoids read locks at cost of bloat

### Trace 7: `historical_trace` — "Trace the evolution of Redis persistence from v1 to v7"
- **Target repo:** `redis/redis`
- **Expected evidence trail:** RDB introduction (v1) → AOF (v2) → Mixed persistence (v4) → New AOF (v7)
- **Expected answer:** RDB snapshots → Append-only file → Hybrid persistence → Improved reliability
- **Key artifacts:** Release notes per version, related PRs

### Trace 8: `unknown` — "Tell me about Godot's rendering pipeline"
- **Target repo:** `godotengine/godot`
- **Expected answer (degraded):** Unable to definitively answer — showing closest evidence matches. Should return evidence about rendering proposals, commit messages, and suggest reformulating the query.

## Five Custom Traces

Complex, multi-hop queries for advanced validation:

### Custom 1: Cross-repo lineage
> "Why does Next.js's `getServerSideProps` work differently in serverless vs serverful deployments?"
- **Repos:** `vercel/next.js`, `vercel/vercel`
- **Expected hops:** Next.js PR → Vercel deployment docs → Issue about cold starts → RFC for edge runtime
- **Evaluation:** Must trace across two repositories, linking PRs to deployment constraints

### Custom 2: Long-deprecation trail
> "Python 3's `asyncio` library has both `@asyncio.coroutine` and `async def`. When was the transition finalized?"
- **Target repo:** `python/cpython`
- **Expected hops:** asyncio introduction (3.4) → `@asyncio.coroutine` → `async def` (3.5) → deprecation (3.8) → removal (3.10)
- **Evaluation:** Must show 6-year deprecation timeline with PEP links

### Custom 3: Seemingly irrational code
> "Why does curl still support SSLv2 in its source when it was deprecated in 2011?"
- **Target repo:** `curl/curl`
- **Expected evidence:** Issue/PR discussing SSLv2 removal → Backwards-compatibility requirement → Documentation of decision
- **Evaluation:** Must distinguish between "still in source" vs "still enabled by default" vs "available if compiled with legacy flags"

### Custom 4: Conflicting evidence resolution
> "What caused the `render` function signature change in React 18?"
- **Target repo:** `facebook/react`
- **Expected evidence:** Multiple PRs with different motivations → RFC discussion → Release notes
- **Evaluation:** Must present ranked hypotheses if evidence is conflicting or incomplete

### Custom 5: Orphaned feature
> "There's a `--experimental` flag in this tool that seems to do nothing. Why does it exist?"
- **Target repo:** Any repo with documented orphaned feature
- **Expected evidence:** Commit introducing flag → PR merging it → Issues noting it's non-functional → Decision not to remove
- **Evaluation:** Must honestly state that the feature appears non-functional, show the evidence trail demonstrating this, and not fabricate a rationale

## No-Corpus Comparison

For each of the 5 custom traces, run GitLore **with** the corpus indexed and **without** (against `gitlore/gitlore` itself or an empty repo).

| Trace | With Corpus | Without Corpus | Expected Delta |
|-------|------------|----------------|----------------|
| Custom 1 | Cross-repo lineage traced | No relevant artifacts found | Full vs empty |
| Custom 2 | Full deprecation timeline shown | Only fallback evidence available | Rich vs degraded |
| Custom 3 | Specific SSLv2 rationale extracted | Generic backwards-compat explanation | Grounded vs speculative |
| Custom 4 | Ranked hypotheses with citations | Single low-confidence guess | Multi-hypothesis vs single |
| Custom 5 | Evidence confirms orphan status | Hallucinates plausible rationale | Honest vs fabricated |

**Success criteria:** GitLore must explicitly state when evidence is missing (without corpus) rather than fabricating explanations.

## Evaluation Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| Symbol retrieval accuracy | % of ground-truth symbols found in retrieval | > 80% |
| Rationale retrieval accuracy | % of target rationale artifacts retrieved in top-10 | > 70% |
| Evidence faithfulness | % of answer claims directly supported by retrieved evidence | > 90% |
| Timeline correctness | % of timeline events matching ground-truth chronological order | > 85% |
| Answer grounding | % of answers citing specific retrievable artifacts | > 95% |
| False-confidence rate | % of answers with high confidence (>0.8) where evidence is insufficient | < 10% |
| User usefulness feedback | % of feedback marked "helpful" | > 60% |

## Known Limitations

1. Semantic embeddings use hash-based pseudo-embeddings (real embedding model integration pending)
2. Graph expansion limited to 1-2 hops for latency reasons
3. Symbol extraction is regex-based, not AST-based
4. No user authentication / tenant isolation yet
5. Background tasks use FastAPI BackgroundTasks (not Redis queue)
6. Maximum 10 pages (1000 items) per artifact type during ingestion

## Roadmap

1. Real embedding model via provider router
2. Redis-backed job queue for reliable background indexing
3. AST-based symbol extraction (tree-sitter)
4. Incremental reindexing via GitHub webhooks
5. Evaluation harness with automated benchmark scoring
6. Multi-repo queries (cross-repo lineage)
7. Advanced visualization: artifact graph, timeline comparison

## License

MIT
