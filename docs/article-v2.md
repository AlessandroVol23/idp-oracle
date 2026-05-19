# Build an Intelligent Document Processor in One Data Store

A typical document processing pipeline fans out across half a dozen services. You drop a PDF in S3, OCR it with Textract, classify it with Bedrock, push the extracted fields into DynamoDB or Postgres, push the embedding into OpenSearch or Pinecone, and store the original blob somewhere different from the extracted text. Six places to look. Six SDKs in your function. Six failure modes between "upload received" and "this is an invoice from Acme due on the 30th".

This article walks through building the same pipeline with one data store. The blob, the extracted text, the structured JSON, the embedding, and the AI calls that produce all of those live inside Oracle Autonomous AI Database 26ai. The application code is a Hono API on Lambda whose job is to receive the upload and stream the result back. Everything else, including the LLM calls, runs from a SQL statement.

The code is at `github.com/AlessandroVol23/idp-oracle`. The pipeline ingests invoices, contracts, and CVs as PDFs, extracts typed fields per document type, and supports vector + keyword + JSON-predicate search against the result.

## The pipeline at a glance

```
PDF blob in Oracle
  → DBMS_VECTOR_CHAIN.UTL_TO_TEXT          (extract text, in DB)
  → DBMS_VECTOR_CHAIN.UTL_TO_SUMMARY       (extractive gist, in DB)
  → DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT (classify: invoice/contract/cv via OCI Gen AI from DB)
  → DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT (extract typed JSON fields, same path)
  → VECTOR_EMBEDDING                       (384-dim vector via ONNX model loaded into DB)
  → documents.status = done
```

The first five steps are SQL. The application code does the orchestration (because Hono is convenient for it) but it could be a single PL/SQL procedure if you wanted no Node at all.

## Why a single data store matters

Three things break when document data lives in multiple stores.

1. **Joins across stores are eventually-consistent at best.** If the extraction service writes JSON to DynamoDB and the embedding service writes to OpenSearch and the original lives in S3, a query like "show me invoices over $10,000 that look semantically similar to this one" is a coordinated three-way fan-out. Each leg has its own latency and failure mode.
2. **Consistency at the row level is impossible.** You can update DynamoDB and the embedding store, but they aren't in the same transaction. Stale embeddings, missing fields, inconsistent views are a constant background tax.
3. **The data lifecycle is harder than it looks.** Tombstone the doc in three stores. Recompute the embedding when the extraction prompt changes. Reindex when the schema changes. Each store needs its own version of "let me redo this".

26ai resolves all three by making the document one row with columns for the blob, the extracted text, the structured JSON (via duality view), and the vector. A single `UPDATE` is atomic across all of them. A single `SELECT` returns the entire shape.

## Step 1: text extraction in the database

`DBMS_VECTOR_CHAIN.UTL_TO_TEXT` reads a `BLOB` column and returns the document's text. It handles PDF, DOC, HTML, JSON, XML out of the box, using the same parsers Oracle Text has shipped for years. No external API call, no Lambda layer for `pdf-parse`.

```sql
UPDATE documents
SET extracted_text = DBMS_VECTOR_CHAIN.UTL_TO_TEXT(file_blob)
WHERE id = HEXTORAW(:id);
```

For digital PDFs (born-digital, not scanned) this gives you exactly the same text you would get from any client-side library. For scans you'd want a vision model and that step would be outside the database. The pipeline acknowledges that gap and refuses to ingest documents shorter than 50 characters post-extraction.

## Step 2: in-database summary

`UTL_TO_SUMMARY` produces an extractive summary using Oracle Text's gist functionality. Free, deterministic, no LLM call.

```sql
SELECT DBMS_VECTOR_CHAIN.UTL_TO_SUMMARY(
  extracted_text,
  JSON('{"provider":"database","glevel":"sentence","numSentences":3}')
) FROM documents WHERE id = HEXTORAW(:id);
```

On the same contract, the in-DB summary and the LLM-generated summary look different in instructive ways.

In-DB extractive summary:
> Reseller Agreement Effective 2026-05-10 Parties Client Kohler - Hermann Provider Blick and Sons Term 36 months Governing law England and Wales Key clauses 1. Governing Law and Venue This Agreement is governed by the laws specified

LLM abstractive summary:
> Reseller Agreement between Kohler - Hermann (Client) and Blick and Sons (Provider) for a 36-month term effective May 10, 2026, governed by England and Wales law. Agreement covers intellectual property ownership, liability limitations, payment terms, termination provisions, force majeure, indemnification, and assignment restrictions.

The extractive version costs nothing per call. The abstractive version reads better. For most UIs both fields are useful. Show the LLM one in the doc card, use the extractive one in keyword search highlights.

## Step 3: classify with OCI Generative AI from inside the database

This is the step that usually lives in an SDK call from your application. With 26ai it doesn't have to.

`DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT` takes a prompt and a JSON config that names a provider, a credential, and a model. It makes the HTTPS call from the database and returns the response as a CLOB. The credential is registered ahead of time with `DBMS_VECTOR_CHAIN.CREATE_CREDENTIAL`.

For OCI Generative AI (the path the repo uses) the credential takes five values: user OCID, tenancy OCID, compartment OCID, fingerprint of the API key, and the private key with `BEGIN/END` lines stripped.

```sql
BEGIN
  DBMS_VECTOR_CHAIN.CREATE_CREDENTIAL(
    credential_name => 'OCI_CRED',
    params          => JSON('{
      "user_ocid":         "ocid1.user.oc1..xxxx",
      "tenancy_ocid":      "ocid1.tenancy.oc1..xxxx",
      "compartment_ocid":  "ocid1.tenancy.oc1..xxxx",
      "private_key":       "MIIEvgIBADANBgkqhkiG...",
      "fingerprint":       "aa:bb:cc:dd:..."
    }')
  );
END;
/
```

After that, classify is a single SELECT:

```sql
SELECT DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT(
  :prompt,
  JSON('{
    "provider":        "ocigenai",
    "credential_name": "OCI_CRED",
    "url":             "https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com/20231130/actions/chat",
    "model":           "cohere.command-r-plus-08-2024",
    "chatRequest":     { "maxTokens": 200, "temperature": 0 }
  }')
) AS out FROM dual;
```

`:prompt` is the extracted text plus a short instruction telling the model to reply with a JSON object shaped like `{ docType, confidence }`. The application parses the CLOB and validates it against a Zod schema. Anything off-schema fails the parse and the document goes to `failed` with the parse error stored in `documents.failed_reason`.

The same SELECT shape is used for the deeper step that follows.

## Step 4: extract typed JSON fields

Field extraction is the same `UTL_TO_GENERATE_TEXT` call with a longer prompt. The prompt includes the JSON Schema for the doc type (`invoice`, `contract`, `cv`) generated from the Zod schema via `zod-to-json-schema`.

```typescript
const jsonSchema = getJsonSchemaForType('invoice');
const prompt = `
You extract structured fields. Respond with a single JSON object that matches this schema exactly.
Every field not explicitly nullable MUST be filled with a real value.

JSON Schema:
${JSON.stringify(jsonSchema)}

Document text:
${text}
`;

const raw = await dbms_vector_chain_utl_to_generate_text(prompt, params);
const obj = extractJsonObject(raw);
return invoiceFields.parse(obj);
```

For an invoice you get back something like:

```json
{
  "envelope": { "docType": "invoice", "summary": "...", "language": "en", "pageCount": 1, "confidence": 0.99 },
  "vendor": "Hammes - Wiegand",
  "invoiceNumber": "INV-9555",
  "invoiceDate": "2026-03-13",
  "dueDate": "2026-04-12",
  "currency": "USD",
  "subtotal": 70125.92,
  "tax": 13323.93,
  "total": 83449.85,
  "lineItems": [
    { "description": "Elegant Plastic Pizza", "quantity": 17, "unitPrice": 107.09, "total": 1820.53 }
  ]
}
```

This JSON gets written to `document_fields.payload` as a `JSON` column. A JSON Relational Duality View (`invoice_dv`) exposes the same data as a single document combining `documents.*` plus the inner payload, so writes can be a single `MERGE INTO invoice_dv` if you prefer that shape.

Cohere on OCI Gen AI is less strict than Claude about filling every field. Sometimes it returns `null` where the schema requires a value, or wraps the JSON in markdown fences, or adds a trailing sentence. The repo handles this three ways. First, fenced code blocks are stripped before `JSON.parse`. Second, the Zod schema marks "nice to have" metadata fields like `envelope.pageCount` and `envelope.confidence` as nullable. Third, `extractFieldsInDb` retries once on Zod-validation failure, feeding the validator error back into the prompt so the model can self-correct.

Three layers of guardrails cover most of what a real production deployment would need on this path.

## Step 5: in-database embeddings via ONNX

Embeddings can either be loaded from an external service (OpenAI, Cohere, Hugging Face) via REST, or generated inside the database from an ONNX model that you upload once and reuse.

The repo uses the second path. Oracle publishes a packaged ONNX file for `all-MiniLM-L12-v2` ready to load with `DBMS_VECTOR.LOAD_ONNX_MODEL`. After that, embedding generation is a SQL function:

```sql
UPDATE documents
SET embedding = VECTOR_EMBEDDING(doc_embedder USING extracted_text AS data)
WHERE id = HEXTORAW(:id);
```

`embedding` is a `VECTOR(384, FLOAT32)` column. The table has an HNSW vector index on it so `VECTOR_DISTANCE` queries hit the graph instead of doing a brute-force scan.

Vector search for similar documents becomes another single SELECT:

```sql
SELECT documents.id, documents.original_filename,
       VECTOR_DISTANCE(documents.embedding, src.embedding, COSINE) AS distance
FROM documents,
     (SELECT embedding FROM documents WHERE id = HEXTORAW(:id)) src
WHERE documents.id != HEXTORAW(:id)
  AND documents.embedding IS NOT NULL
ORDER BY distance
FETCH FIRST :k ROWS ONLY;
```

No second store. No "make sure both writes succeeded". The same row that holds the BLOB holds the 384-dim vector, and the same `UPDATE` that sets the status flag can set the embedding.

## What's left outside the database

Two things.

1. **HTTP compute**. The repo uses a Hono API on Lambda with a Function URL. Could be Fargate, ECS, Cloud Run, anything that speaks HTTP. None of the AI calls happen here; the handler's job is to accept the file, insert the BLOB, and run the SQL state machine.
2. **SPA hosting**. Vite build sitting on S3 behind CloudFront, with a `/api/*` proxy to the Lambda URL. Could be Vercel, Netlify, anything.

The Lambda has no IAM policy for Bedrock, no `bedrock-runtime` SDK in its bundle. The only credential it carries is the Oracle wallet (bundled into the function asset via CDK `commandHooks.afterBundling`). Everything else lives in the database.

## Bugs and workarounds in 26ai 23.26.2.2.0

I'd recommend reading these before you build the same thing. None of them are dealbreakers, but each cost a few minutes of staring at logs.

1. **`JSON_TRANSFORM` is not allowed in JSON Relational Duality View projections.** Only `JSON_OBJECT` and `JSON_ARRAYAGG` are. If you write `'fields': (SELECT JSON_TRANSFORM(f.payload, KEEP '$.*') FROM document_fields f ...)`, you get `ORA-40895`. The fix is to embed the JSON column directly: `'fields': (SELECT f.payload FROM document_fields f WITH UPDATE WHERE f.document_id = d.id)`.

2. **`WITH CHECK OPTION` is required on filtered duality views.** A view that says `WHERE d.doc_type = 'invoice'` will fail to compile without `WITH CHECK OPTION` appended after the predicate (`ORA-42664`). Adding it makes the view reject inserts/updates that would land a row outside its filter.

3. **`SELECT *` from a duality view with a nested subquery in the projection throws `ORA-40666`** with an internal error like `qjsngenfullStrmJObj:4`. As of `23.26.2.2.0` this is reproducible on every read. The workaround for read paths is to skip the view and query `documents` + `document_fields` directly. Writes through the duality view still work fine, which is the more valuable use case (atomic multi-table update).

4. **`CTX_DDL.CREATE_PREFERENCE` is not idempotent.** Re-running schema migrations throws `DRG-10701`. Wrap the call in `EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%DRG-10701%' THEN NULL; ELSE RAISE; END IF`.

5. **`VECTOR_DIMENSION` was renamed to `VECTOR_DIMENSION_COUNT` in 26ai.** Older blog posts and the OML examples use the old name.

6. **`DBMS_VECTOR_CHAIN.CREATE_CREDENTIAL` needs three grants** that aren't included in `DB_DEVELOPER_ROLE`: `CREATE CREDENTIAL`, `EXECUTE ON DBMS_CLOUD`, `EXECUTE ON DBMS_CLOUD_AI`. The error message is helpful (`PLS-00201: identifier 'DBMS_CLOUD_AI' must be declared`) once you know to look at grants.

7. **You also need an outbound network ACL** to the OCI Generative AI inference host. `DBMS_NETWORK_ACL_ADMIN.APPEND_HOST_ACE` opens it.

The `scripts/db-setup-oci-credential.ts` in the repo does all of (6) and (7) automatically so you don't hit them in order.

## When this fits and when it doesn't

This approach fits well when your problem has the same shape as document processing. You have a primary artifact (PDF, image, log file). You want to derive multiple representations of it (text, structured JSON, embedding, summary). You want to search across the derived representations. You don't want six different stores to keep in sync.

Anything that fits the pattern "blob + extracted text + typed fields + vector + search" is a good candidate. Think customer support tickets with attachments, log artifacts with derived alerts, RFP responses, expense receipts, medical imaging reports.

This approach fits less well in three cases. First, if your extraction quality must be the absolute best available, Claude 4.x or GPT-5 will out-extract Cohere Command R+ on hard contracts with nested clauses. The retry pattern in the repo helps but doesn't fully close the gap. Second, if your data has to live in the same cloud as something else (an existing AWS data lake, a specific compliance jurisdiction), the DB-as-everything model can be the wrong tradeoff. Third, if you don't already have Oracle skills on the team, picking 26ai for one use case is heavier than it looks once you factor in tooling, monitoring, and operational care.

For the cases where it does fit, the wins are real. The end-to-end pipeline for one document is one Lambda invocation, one DB connection, six SQL statements, two outbound HTTPS calls from the database to OCI Gen AI. No fan-out, no eventual consistency, no per-store error handling.

## What to build on top

Three obvious extensions for a v2.

1. **Chunking + RAG.** `DBMS_VECTOR_CHAIN.UTL_TO_CHUNKS` splits a document into overlapping chunks. Combine with an HNSW index on a chunks table and you have RAG that lives entirely in the database. Useful for "chat with this contract".

2. **Reranking.** `DBMS_VECTOR_CHAIN.UTL_TO_RERANK` reorders search results using a cross-encoder loaded as ONNX. Better quality than pure cosine for top-k, runs in-DB.

3. **Hybrid search.** Combine `VECTOR_DISTANCE` with a `JSON_VALUE` predicate and a `CONTAINS()` keyword filter in a single SQL statement. The vector index, JSON index, and text index all live on the same table; the optimizer picks the right access path.

## The repo

`github.com/AlessandroVol23/idp-oracle`. The README has the full setup from a fresh OCI Free account; `docs/01-provision-oracle.md` and `docs/02-provision-oci-genai.md` walk through the database side. Total setup time from "I just created an OCI account" to "I just uploaded my first invoice and got typed JSON back" is about 20 minutes.

The interesting code paths to read are `packages/db/src/llm.ts` (the in-DB LLM call wrapper with retry), `packages/db/src/repositories/documents.ts` (the SQL statements with Zod schemas at every boundary), and `packages/core/src/ingest.ts` (the state machine that ties it together).
