# Intelligent Document Processor — Oracle Database 26ai + AWS
> Created: 2026-05-13

Companion code for the Oracle Guest Expert Deep Dive article *Build an Intelligent Document Processor in One Data Store*. The tutorial demonstrates how a single Oracle 26ai instance can hold the file blob, extracted text, structured per-type JSON, and vector embedding for a document — while AWS provides only the compute (Lambda) and the LLM (Bedrock). Static frontend hosting on S3 + CloudFront is treated as asset delivery, not a data store, so the article's "one data store" thesis holds.

## Article Deliverables

- **Working title:** *Build an Intelligent Document Processor in One Data Store*
- **Backup title:** *Intelligent Document Processing with Oracle Database 26ai — One Database, Many Document Types*
- **Audience:** Intermediate
- **Deadlines:** Draft 2026-05-14, finalized 2026-05-20, live 2026-05-21
- **Channel:** Oracle blogs + manual PR to https://github.com/oracle-devrel/oracle-ai-developer-hub (PR handled by author, not part of this spec)
- **Reference:** AWS IDP solution at https://aws-solutions-library-samples.github.io/accelerated-intelligent-document-processing-on-aws/
- **Document types covered:** Invoices (AP), Contracts (Legal/Procurement), CVs (HR)
- **Oracle 26ai features highlighted:**
  - JSON Duality Views (relational + JSON view of the same data, bidirectional)
  - In-database embedding generation via `DBMS_VECTOR_CHAIN`
  - Hybrid search (vector + keyword + JSON predicate in a single SQL plan) — **demonstrated in the article via sqlcl, not exposed as an app feature**

## Tech Stack — Locked Decisions

| Layer | Choice | Rationale |
|---|---|---|
| Repo | pnpm workspace, mirrors `biotech-docs` layout (`apps/`, `packages/`, `services/`, `infrastructure/`, `scripts/`) | Reader sees a layout that scales beyond a toy app |
| Frontend | Vite + React + TanStack Router + TanStack Query + Tailwind | Modern, no framework lock-in |
| Backend | Single Hono API on a Lambda Function URL (no API Gateway) | Minimum AWS surface area; the article is about Oracle |
| OCR / text extraction | `DBMS_VECTOR_CHAIN.UTL_TO_TEXT` **inside Oracle** | Headline 26ai feature; digital PDFs only (called out in article) |
| Classification + field extraction | **AWS Bedrock — Claude Sonnet.** Locked because the article's architecture diagram and host channel (AWS Fundamentals) are AWS-centric; switching to another provider mid-article weakens the AWS+Oracle integration story | Two-step: classify first, then per-type structured extraction |
| Embeddings | `DBMS_VECTOR_CHAIN.UTL_TO_EMBEDDINGS` with an ONNX model loaded into Oracle (`all-MiniLM-L6-v2`) | The article's other headline feature; no embedding API call to AWS |
| File storage (blob) | Oracle 26ai `BLOB` column | Preserves the "one data store" thesis; capped by Lambda 6 MB upload / ~20 MB streamed response (called out) |
| Structured + vector storage | Oracle 26ai (Autonomous AI Database Free Tier, cloud-hosted only — no Docker path) | The point of the article |
| Data access layer | Official `oracledb` driver + plain `.sql` migration files | No ORM masks `VECTOR`, `JSON Duality Views`, `DBMS_VECTOR_CHAIN` |
| Validation | Zod schemas in `packages/schemas`, shared across FE/BE | Per-type extraction outputs validated before insert |
| Auth | None — single-tenant demo with a one-line warning in the README | Keeps the focus on the IDP pipeline |
| Config / secrets | Plain `.env` file, documented in README. **No SSM, no Secrets Manager.** | Tutorial scope; explicitly *not* production-ready |
| Frontend hosting | S3 + CloudFront via CDK | Matches the article's architecture diagram; `pnpm dev` is the primary dev path |
| AWS IaC | Minimal single-stack CDK: S3 bucket + CloudFront + Lambda Function URL + IAM (Bedrock invoke) | One `pnpm cdk deploy` |
| Sample documents | Script that generates synthetic invoices, contracts, CVs as PDFs **once**, results committed to `samples/` | Reader has realistic-enough inputs; no need to regenerate |

## Repository Layout

```
idp-db26ai-aws/
├── apps/
│   └── web/                         # Vite + React + TanStack + Tailwind SPA
├── packages/
│   ├── core/                        # Business logic: ingest pipeline, classifier, extractor
│   ├── db/                          # oracledb pool, repositories, migrations (.sql)
│   ├── bedrock/                     # Bedrock Runtime client wrapper (classify, extract)
│   ├── hono/                        # Hono utilities + Lambda Function URL adapter
│   ├── schemas/                     # Zod schemas per document type (shared FE/BE)
│   ├── logger/                      # Structured logging
│   └── shared/                      # Enums, constants (DocType, DocStatus)
├── services/
│   └── functions/
│       └── api/                     # Hono Lambda Function URL handler
├── infrastructure/                  # AWS CDK app (single stack)
├── scripts/
│   ├── generate-sample-docs.ts      # Generates synthetic PDFs into ./samples (run once, output committed)
│   ├── upload-onnx-model.ts         # Loads all-MiniLM-L6-v2 ONNX into Oracle
│   ├── db-setup.ts                  # Runs migrations against the configured DB
│   └── seed.ts                      # Ingests committed sample docs end-to-end
├── samples/                         # Generated PDFs (committed, not git-ignored)
├── docs/                            # Article supplement (architecture diagram, screenshots)
├── pnpm-workspace.yaml
└── package.json
```

---

## F-001: pnpm workspace + tooling baseline

**Group:** repo-foundation
**Category:** technical
**Status:** - [ ] pending

Set up the pnpm monorepo with TypeScript, oxlint, oxfmt, vitest, and shared `tsconfig`. Match the workspace conventions used in `/Users/alessandrovolpicella/projects/roche/biotech-docs` (workspace package globs, root scripts, engines pinned to Node 20+, pnpm 10+).

**Steps:**
1. Create root `package.json` with `private: true`, `type: "module"`, scripts (`build`, `dev`, `lint`, `format`, `typecheck`, `test`, `check`, `cdk`, `cdk:deploy`, `samples`, `db:setup`, `seed`).
2. Create `pnpm-workspace.yaml` covering `apps/*`, `packages/*`, `services/functions/*`, `infrastructure`, `scripts`.
3. Create root `tsconfig.json` with `strict: true`, `moduleResolution: "Bundler"`, `target: "ES2022"`, project references.
4. Install dev deps: `typescript`, `tsx`, `vitest`, `oxlint`, `oxfmt`, `esbuild`, `@types/node`.
5. Add `.gitignore` covering `node_modules`, `dist`, `*.tsbuildinfo`, `cdk.out`, `.env*`. **Do NOT ignore `samples/`** — generated PDFs are committed.

**Notes:** All package names use scope `@idp/`. Engines: `node>=20`, `pnpm>=10`.

## F-002: Workspace package scaffolding

**Group:** repo-foundation
**Category:** technical
**Status:** - [ ] pending

Create empty `package.json` + `tsconfig.json` shells for every workspace package and app so cross-package imports resolve before any code is written.

**Steps:**
1. Scaffold `apps/web`, `packages/{core,db,bedrock,hono,schemas,logger,shared}`, `services/functions/api`, `infrastructure`, `scripts`.
2. Each gets a `package.json` declaring its `name`, `type: "module"`, `main`/`exports`, `scripts.build`, `scripts.typecheck`.
3. Each gets a `tsconfig.json` extending the root via `"extends": "../../tsconfig.json"`, with project references pointing at upstream packages.
4. Verify `pnpm -r typecheck` runs (will pass on empty packages).

**Notes:** No code yet — this isolates layout problems before any logic exists.

## F-003: Oracle Autonomous AI Database Free Tier provisioning guide

**Group:** oracle-db
**Category:** integration
**Status:** - [ ] pending

Document, in `docs/01-provision-oracle.md`, the exact steps a reader follows to stand up an Always-Free Autonomous AI Database 26ai instance in OCI. Include screenshots of the OCI console flow, ACL setup, and TLS (no-wallet) connection string. **This is the only supported DB path — no Docker.**

**Steps:**
1. Sign up for OCI Always Free.
2. Create an Autonomous Database, workload type "AI", Always Free.
3. Set ADMIN password, note connect strings.
4. Add reader's public IP to the ACL (TLS no-wallet mode).
5. Verify a `SELECT 1 FROM DUAL` from a local Node script via `oracledb` thin mode.

**Notes:** Article and README link directly into this doc. Tutorial uses TLS-no-wallet for simplicity; mTLS noted as the production option but not walked through.

## F-004: Database user, roles, and AI privileges

**Group:** oracle-db
**Category:** security
**Status:** - [ ] pending

A bootstrap SQL script run once by ADMIN provisions an `idp` application user with the minimum privileges to use vector + JSON Duality Views.

**Steps:**
1. `migrations/000_bootstrap.sql` (runs as ADMIN): create user `idp`, grant `DB_DEVELOPER_ROLE`, `CREATE MINING MODEL`, `EXECUTE ON DBMS_VECTOR`, `EXECUTE ON DBMS_VECTOR_CHAIN`, `READ, WRITE ON DIRECTORY DATA_PUMP_DIR`.
2. `idp` user owns all subsequent schema objects.
3. Document the bootstrap as a one-time step in `docs/01-provision-oracle.md`.

**Notes:** Article calls out that `DB_DEVELOPER_ROLE` is the 26ai-bundled "dev" role, not a custom invention.

## F-005: Core relational schema

**Group:** oracle-db
**Category:** technical
**Status:** - [ ] pending

Migration file `migrations/001_schema.sql` creates the relational tables that back every document.

**Steps:**
1. `documents` table: `id` (UUID/RAW), `doc_type` (VARCHAR `invoice|contract|cv|unknown`), `status` (VARCHAR `pending|text_extracted|classified|fields_extracted|embedded|done|failed`), `original_filename`, `mime_type`, `byte_size`, `page_count`, `language`, `created_at`, `updated_at`, `failed_reason`.
2. `documents.file_blob` (BLOB) — the original file bytes.
3. `documents.extracted_text` (CLOB) — output of `DBMS_VECTOR_CHAIN.UTL_TO_TEXT`.
4. `documents.embedding` (VECTOR(384, FLOAT32)) — one embedding per document (mean-pooled across chunks for v1).
5. `document_fields` table: `document_id` (FK), `payload` (JSON) — typed extracted fields, shape varies by `doc_type`.
6. Indexes: B-tree on `(doc_type, status, created_at DESC)`; HNSW on `embedding`; CTXSYS Text index on `extracted_text` (used by the article's hybrid-search SQL demo, even though the app doesn't surface it).

**Notes:** Embedding dimension locked to 384 to match `all-MiniLM-L6-v2`. Article will explain the choice.

## F-006: JSON Duality Views per document type

**Group:** oracle-db
**Category:** technical
**Status:** - [ ] pending

Migration file `migrations/002_duality_views.sql` creates one Duality View per document type. The view joins `documents` with `document_fields` and exposes a typed JSON document the API reads/writes as a single object.

**Steps:**
1. `invoice_dv` — JSON Duality View joining `documents` (where `doc_type='invoice'`) with `document_fields`, exposing invoice-shaped JSON.
2. `contract_dv` — same pattern for contracts.
3. `cv_dv` — same pattern for CVs.
4. `document_dv` — read-only view exposing common envelope fields for cross-type list.
5. Verify each view is updatable (insert/update JSON, see relational rows change).

**Notes:** This is the article's primary "bidirectional view" demo. The post will include side-by-side: `INSERT` into `invoice_dv` with a JSON document, then `SELECT` from `documents` + `document_fields` showing the rows.

## F-007: `@idp/db` package — oracledb pool + repositories

**Group:** data-access
**Category:** technical
**Status:** - [ ] pending

The `@idp/db` package wraps `oracledb` (thin mode) and exposes one repository per aggregate. No ORM. All SQL lives in `packages/db/src/sql/*.sql` and is loaded at module init.

**Steps:**
1. `createPool({ connectString, user, password })` returns a singleton pool. Read config from env (`ORACLE_CONNECT_STRING`, `ORACLE_USER`, `ORACLE_PASSWORD`) loaded from `.env`.
2. `DocumentsRepo` methods: `insert`, `findById`, `list`, `updateStatus`, `setExtractedText`, `setEmbedding`, `streamBlob` (returns a Node Readable for the API to pipe to the HTTP response), `findSimilar(id, k)` — pure vector nearest neighbors via `VECTOR_DISTANCE`.
3. `FieldsRepo` methods: `upsertInvoice`, `upsertContract`, `upsertCv` — each writes through the corresponding Duality View.
4. Repository methods return zod-validated typed objects.

**Notes:** Use `BIND_OUT` LOB binds for streaming reads. Vectors bind as `Float32Array`. No `SearchRepo` — hybrid search is shown in the article only, not surfaced via the app.

## F-008: In-database embeddings via DBMS_VECTOR_CHAIN

**Group:** data-access
**Category:** technical
**Status:** - [ ] pending

Embeddings are generated *inside* Oracle, not by calling a Bedrock embedding API. A script loads the `all-MiniLM-L6-v2` ONNX model into the database; the ingest pipeline calls `DBMS_VECTOR_CHAIN.UTL_TO_EMBEDDINGS` to vectorize the extracted text.

**Steps:**
1. `scripts/upload-onnx-model.ts` downloads the ONNX model from Oracle's distribution, uploads it via `DATA_PUMP_DIR`, and registers it with `DBMS_VECTOR.LOAD_ONNX_MODEL(model_name => 'doc_embedder', ...)`.
2. `DocumentsRepo.setEmbedding(id)` runs a single SQL: `UPDATE documents SET embedding = (SELECT VECTOR_EMBEDDING(doc_embedder USING extracted_text AS data) FROM ...) WHERE id = :id`.
3. Idempotent — running twice produces the same result.
4. README documents the one-time model upload as a setup step.

**Notes:** The article includes the full PL/SQL block for the model upload.

## F-009: Text extraction via DBMS_VECTOR_CHAIN.UTL_TO_TEXT

**Group:** data-access
**Category:** technical
**Status:** - [ ] pending

After a document is uploaded, the API extracts text directly from the BLOB using `DBMS_VECTOR_CHAIN.UTL_TO_TEXT` — no Textract, no out-of-database OCR.

**Steps:**
1. `DocumentsRepo.extractText(id)` runs `UPDATE documents SET extracted_text = DBMS_VECTOR_CHAIN.UTL_TO_TEXT(file_blob) WHERE id = :id`.
2. If output is empty or under a configured threshold (e.g. 50 chars), set `status='failed'`, `failed_reason='no_text_extracted'` and surface to the UI.
3. Article's "Honest takeaways" section calls out the limitation: image-only / scanned PDFs are out of scope.

**Notes:** Explicitly framed as a tradeoff for tutorial scope, not a hand-wave.

## F-010: `@idp/bedrock` — classify and extract

**Group:** llm-pipeline
**Category:** integration
**Status:** - [ ] pending

Thin wrapper around the Bedrock Runtime client exposing two functions: `classify(text)` returns one of `invoice | contract | cv | unknown`; `extractFields(text, docType)` returns a typed object validated against the per-type Zod schema. Both use Claude Sonnet via `InvokeModel` with structured output.

**Steps:**
1. `classify(text)` — short prompt, returns `{ docType, confidence }`. If `confidence < 0.7`, mark as `unknown`.
2. `extractFields(text, docType)` — selects the prompt + Zod schema by `docType`, sends to Bedrock, parses JSON, validates with Zod, returns the typed object.
3. Both retry once on transient errors. No retries on validation failure.
4. Token budgets configurable via env.

**Notes:** Bedrock is locked as the LLM because (a) the article's architecture diagram is AWS-centric, (b) the host channel is AWS Fundamentals, and (c) the tutorial's value is showing AWS compute + LLM working *with* Oracle 26ai as the unified data store. Swapping LLM providers would muddy that story. Region defaults to `us-east-1`. The Lambda IAM role has only `bedrock:InvokeModel` for the Sonnet model ARN.

## F-011: Per-document-type Zod schemas

**Group:** llm-pipeline
**Category:** technical
**Status:** - [ ] pending

`packages/schemas` exports one Zod schema per doc type plus a common envelope. These schemas are used by the Bedrock extractor (output validation), the API (response types), and the frontend (form rendering).

**Steps:**
1. `commonEnvelope`: `{ docType, summary, language, pageCount, confidence }`.
2. `invoiceFields`: `{ vendor, invoiceNumber, invoiceDate, dueDate, currency, subtotal, tax, total, lineItems: [{ description, quantity, unitPrice, total }] }`.
3. `contractFields`: `{ parties: [{ name, role }], effectiveDate, term, contractValue?, governingLaw, keyClauses: [{ label, text }] }`.
4. `cvFields`: `{ name, email, phone?, location?, yearsExperience, skills: string[], education: [{ degree, institution, year }], workHistory: [{ company, title, start, end?, summary }] }`.
5. All dates as ISO 8601 strings. All schemas exported as both `z.infer<>` types and JSON Schema (for prompt embedding).

**Notes:** JSON Schema generation via `zod-to-json-schema`. The article shows the invoice schema in full as the canonical example.

## F-012: `@idp/core` — ingest pipeline orchestrator

**Group:** ingest-pipeline
**Category:** functional
**Status:** - [ ] pending

`ingestDocument(documentId)` drives the document through the full state machine. Idempotent; can be re-invoked after a failure.

**Steps:**
1. Load `document` by id. If `status='done'`, return early.
2. If `status='pending'`: call `extractText` → set `text_extracted` or `failed`.
3. If `status='text_extracted'`: call `bedrock.classify` → update `doc_type` → set `classified`.
4. If `status='classified'`: call `bedrock.extractFields` → upsert into appropriate Duality View → set `fields_extracted`.
5. If `status='fields_extracted'`: call `setEmbedding` (in-DB) → set `embedded`.
6. Set `status='done'`. Each step transactional. Each failure stores `failed_reason` and is retryable.

**Notes:** Whole pipeline fits in a single Lambda invocation; the article uses this simplicity as a point.

## F-013: Hono API — endpoints

**Group:** api
**Category:** technical
**Status:** - [ ] pending

The single Hono app exposes the endpoints the frontend needs. Deployed as a Lambda Function URL.

**Steps:**
1. `POST /documents` — accepts `multipart/form-data` (single file field `file`). Inserts the document row with `file_blob`, `status='pending'`. Synchronously calls `ingestDocument` (Lambda timeout 60s). Returns the final document state.
2. `GET /documents` — query params: `docType`, `status`, pagination. Returns list rows from `document_dv`.
3. `GET /documents/:id` — returns full Duality View row for the document type.
4. `GET /documents/:id/file` — streams the BLOB to the client with the original MIME type. Lambda response streaming enabled (raises cap to ~20 MB).
5. `GET /documents/:id/similar` — top-K nearest neighbors via pure vector `VECTOR_DISTANCE` (no keyword, no JSON predicate), excludes self.
6. Errors return `{ code, message }`, 4xx/5xx as appropriate.

**Notes:** No `/search` endpoint — hybrid search lives only in the article. Hono runs on Lambda via the AWS Lambda adapter. No API Gateway.

## F-014: Frontend — Vite + TanStack baseline

**Group:** frontend
**Category:** ux
**Status:** - [ ] pending

`apps/web` scaffolds the SPA with Vite, React 19, TanStack Router (file-based), TanStack Query, Tailwind v4, and a minimal component set.

**Steps:**
1. `pnpm create vite` baseline, swap to TanStack Router.
2. Tailwind v4 setup (`@import "tailwindcss"`).
3. Tiny component layer: `Button`, `Input`, `Card`, `Badge`, `Table`. No heavy UI lib.
4. `vite.config.ts` proxies `/api/*` to `http://localhost:8787` during dev (Hono dev server).
5. App reads `VITE_API_BASE_URL` for the Lambda Function URL at build time.

**Notes:** No state management library — TanStack Query covers server state, `useState` covers the rest.

## F-015: Frontend — Upload page

**Group:** frontend
**Category:** ux
**Status:** - [ ] pending

`/upload` route. Drag-drop or click-to-select PDFs. Each in-flight upload renders a row with a status badge that polls `GET /documents/:id` every 2 seconds until `done` or `failed`.

**Steps:**
1. Drop zone accepts `.pdf`, validates `byte_size <= 6 MB` (Lambda Function URL request cap), shows a clear error otherwise.
2. On drop, POST to `/documents`, push the returned id onto a local list.
3. For each in-flight id, a `useQuery` polls `/documents/:id` with `refetchInterval: 2000` until `status` is `done` or `failed`.
4. Done rows show classification + a link to the detail page; failed rows show `failed_reason`.
5. Multiple concurrent uploads supported.

**Notes:** No optimistic UI.

## F-016: Frontend — Documents list page

**Group:** frontend
**Category:** ux
**Status:** - [ ] pending

`/documents` route. Table of all documents with type, status, created date, original filename, and a click-through. Filters: doc type (multi), status.

**Steps:**
1. URL-driven filter state via TanStack Router search params.
2. `useQuery` calls `/documents` with the current filters.
3. Table columns sortable client-side.
4. Empty state with CTA to upload.

**Notes:** Pagination cursor-based; 25 per page. No keyword filter (search is out of scope for the app).

## F-017: Frontend — Document detail page

**Group:** frontend
**Category:** ux
**Status:** - [ ] pending

`/documents/:id` route. Two-pane layout: left pane embeds the PDF via `<object data="/documents/:id/file">`; right pane renders the extracted fields using the type's Zod schema as a form descriptor (read-only).

**Steps:**
1. Left pane: PDF embed sized to 100% of pane height.
2. Right pane top: common envelope (type, summary, language, pages).
3. Right pane body: per-type field renderer (invoice line items as a sub-table, contract clauses as expandable cards, CV sections as columns).
4. Bottom: "Similar documents" panel calling `/documents/:id/similar` (top 5) — pure vector similarity, directly supports the excerpt's "similar ones sit next to each other" line.
5. Each similar item links to its own detail page.

**Notes:** Renderers live in `apps/web/src/features/document-detail/{InvoiceView,ContractView,CvView}.tsx`. Article screenshots come from this page.

## F-018: Sample document generator (run once, output committed)

**Group:** sample-data
**Category:** functional
**Status:** - [ ] pending

`scripts/generate-sample-docs.ts` produces synthetic, realistic invoices, contracts, and CVs as **digitally-created PDFs** (so `UTL_TO_TEXT` works). Run once during development; the resulting files in `samples/` are **committed to the repo** so readers do not need to regenerate.

**Steps:**
1. Use `@react-pdf/renderer` to compose typed PDFs from React components.
2. Three templates: `InvoicePDF`, `ContractPDF`, `CvPDF`. Each accepts a typed props object matching the per-type Zod schema.
3. Generate field data deterministically from a fixed seed using `@faker-js/faker` so the committed set is reproducible.
4. Vary: number of invoice line items (1–12), contract clause set (3–10 from a pool), CV experience level (entry/mid/senior). Produce 10 of each type.
5. Write outputs to `samples/{invoices,contracts,cvs}/*.pdf` and commit them.
6. CLI flags: `--count <n>`, `--type <invoice|contract|cv|all>`, `--seed <n>`, `--out <dir>` (for re-runs by anyone who wants to extend the corpus).

**Notes:** Templates live in `scripts/templates/`. `samples/` is intentionally **not** git-ignored.

## F-019: Seed script — end-to-end ingest

**Group:** sample-data
**Category:** functional
**Status:** - [ ] pending

`scripts/seed.ts` walks the committed `samples/` directory and POSTs each file to the deployed (or local) API. Useful for both first-run setup and demo resets.

**Steps:**
1. Resolves the API base URL from `.env` (`API_BASE_URL`).
2. Iterates `samples/**/*.pdf`, uploads in parallel (concurrency 4).
3. Polls each returned id until `done` or `failed`.
4. Prints a summary table: count by type, count by status, total time, average time per doc.

**Notes:** Populates the demo for article screenshots and lets the reader verify the pipeline works.

## F-020: AWS CDK — single stack

**Group:** infrastructure
**Category:** technical
**Status:** - [ ] pending

`infrastructure/` is a CDK app with one stack that provisions everything AWS-side: the SPA hosting (S3 + CloudFront with OAC), the Hono Lambda Function URL, and IAM for Bedrock.

**Steps:**
1. `WebHostingConstruct`: private S3 bucket, CloudFront distribution with OAC, default cache behavior with SPA fallback to `/index.html`.
2. `ApiConstruct`: NodejsFunction packaging `services/functions/api`, Function URL with `AuthType.NONE`, response streaming enabled, 60s timeout, 1024 MB memory. **Env vars (Oracle creds, Bedrock model id) are baked from the local `.env` file at deploy time** — read in `infrastructure/app.ts` via `dotenv` and passed into `NodejsFunction.environment`.
3. `BedrockIamPolicy` granting `bedrock:InvokeModel` on the specific Claude Sonnet model ARN.
4. Outputs: `ApiUrl`, `WebUrl`.
5. `pnpm cdk:deploy` deploys; `pnpm cdk:destroy` tears down.

**Notes:** No SSM, no Secrets Manager. Lambda env vars are visible in the AWS console — README calls this out as a deliberate tutorial-scope choice, not a production pattern. No VPC needed (Autonomous DB is reachable over TLS public endpoint).

## F-021: `.env`-based config

**Group:** infrastructure
**Category:** technical
**Status:** - [ ] pending

All configuration — Oracle credentials, Bedrock model id, region — lives in a single `.env` file at the repo root. Loaded by `dotenv` in scripts, the dev server, and the CDK app. Never committed; an `.env.example` documents the shape.

**Steps:**
1. `.env.example` lists every variable with a placeholder value and a one-line comment.
2. README has a "Configure environment" section that walks through copying `.env.example` to `.env` and filling in values from the OCI console and the AWS account.
3. CDK reads `.env` at synth time and bakes values into Lambda env vars (see F-020).
4. Local scripts (`db:setup`, `samples`, `seed`) read the same `.env`.

**Notes:** Variables: `ORACLE_CONNECT_STRING`, `ORACLE_USER`, `ORACLE_PASSWORD`, `BEDROCK_MODEL_ID`, `AWS_REGION`, `API_BASE_URL`.

## F-022: README — quickstart

**Group:** docs
**Category:** ux
**Status:** - [ ] pending

Root `README.md` walks a reader from clone to working app in under 15 minutes.

**Steps:**
1. Prereqs: pnpm 10+, Node 20+, AWS account with Bedrock model access for Claude Sonnet, OCI Free account.
2. Step 1: provision Autonomous DB (link to `docs/01-provision-oracle.md`).
3. Step 2: copy `.env.example` → `.env`, fill in credentials.
4. Step 3: run bootstrap SQL + migrations + ONNX upload (`pnpm db:setup`).
5. Step 4: deploy CDK (`pnpm cdk:deploy`).
6. Step 5: run frontend locally (`pnpm dev` in `apps/web`) or visit the deployed CloudFront URL.
7. Step 6: upload a PDF from `samples/` (or any digital PDF), watch it ingest.

**Notes:** README explicitly warns the deployed Function URL has no auth — for demo only. Calls out `.env`-only secrets as deliberate tutorial-scope choice.

## F-023: Article — "Setting up Oracle Database 26ai" section

**Group:** article
**Category:** ux
**Status:** - [ ] pending

Section 5 of the post explains, with screenshots, how to provision the ADB instance, run the bootstrap SQL, and load the ONNX embedding model.

**Steps:**
1. Screenshot of OCI console showing the Always Free option.
2. Screenshot of the connect-string panel.
3. Bootstrap SQL block annotated.
4. ONNX upload PL/SQL annotated.
5. End-of-section: a `SELECT VECTOR_EMBEDDING(doc_embedder USING 'hello world' AS data)` proof-of-life query.

**Notes:** Pulls directly from `docs/01-provision-oracle.md` and F-004, F-008.

## F-024: Article — "Ingesting a document end-to-end" section

**Group:** article
**Category:** ux
**Status:** - [ ] pending

Section 6 walks through a single document's journey through the pipeline, with the full state machine and the SQL for each transition.

**Steps:**
1. Upload via the API, show the `INSERT` into `documents` with the BLOB bind.
2. `UTL_TO_TEXT` SQL annotated.
3. Bedrock classify call with the actual prompt.
4. Bedrock extract call returning JSON, `INSERT` into the Duality View.
5. `VECTOR_EMBEDDING` SQL update.
6. Diagram of the state machine: pending → text_extracted → classified → fields_extracted → embedded → done.

**Notes:** This is the longest section. Real outputs from a real run (one of the generated CVs) are embedded.

## F-025: Article — "Querying the result" section (hybrid search lives here)

**Group:** article
**Category:** ux
**Status:** - [ ] pending

Section 7 demonstrates the three query modes — JSON, vector, and hybrid — using the same dataset, run from sqlcl. **This is the only place hybrid search appears.** The app does not expose it.

**Steps:**
1. JSON-only: `SELECT * FROM cv_dv WHERE JSON_VALUE(data, '$.yearsExperience') > 5`.
2. Vector-only: `ORDER BY VECTOR_DISTANCE(embedding, :q, COSINE) FETCH FIRST 5 ROWS ONLY`.
3. Hybrid: a single SQL combining `VECTOR_DISTANCE`, `CONTAINS` (Oracle Text), and `JSON_EXISTS` with a weighted score. Annotated line-by-line.
4. Side-by-side result comparison: a query like "senior backend engineer" returns very different top-5 lists across the three modes.
5. Article includes a small chart showing rank changes across modes.

**Notes:** The hybrid SQL is the article's centerpiece query example. It is **demonstrated**, not productized — readers can paste it into sqlcl against their own data.

## F-026: Article — "Honest takeaways: 26ai vs Postgres + pgvector"

**Group:** article
**Category:** ux
**Status:** - [ ] pending

Closing section compares the 26ai approach with a typical Postgres + pgvector stack across concrete dimensions.

**Steps:**
1. Single store vs. multi-store: 26ai stores BLOB, JSON, vector, relational, text index in one place.
2. In-DB embeddings vs. external embedding service.
3. JSON Duality Views vs. ad-hoc JSON columns or denormalized tables.
4. Honest cons: ecosystem (ORM support, driver maturity), licensing footprint outside Free tier, operational familiarity.
5. When to choose which.

**Notes:** Not a hit piece on Postgres — both stacks ship products. The section's job is to be useful to a reader who's already on Postgres + pgvector and wondering whether 26ai is worth a look.

## F-027: Article — final QA pass against working repo

**Group:** article
**Category:** ux
**Status:** - [ ] pending

Before publish, walk the entire article top to bottom while running every command and copying every output from the actual repo. Any drift fixes the article, not the repo.

**Steps:**
1. Fresh OCI account walkthrough on a clean machine.
2. Every shell command in the article executed.
3. Every SQL block run, every output pasted is from the live system.
4. Every screenshot retaken from the current frontend.
5. Final read-through by Juliana before submission.

**Notes:** Deadline 2026-05-20 for finalization, 2026-05-21 live.
