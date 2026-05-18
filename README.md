# Intelligent Document Processor — Oracle Database 23ai + AWS

Companion code for the article *Build an Intelligent Document Processor in One Data Store*.

Documents (invoices, contracts, CVs) go through this pipeline:

1. **Upload** to a Hono API running on Lambda (Function URL, VPC-attached).
2. The file is stored as a `BLOB` in Oracle Database 23ai (Free, running on ECS Fargate inside the VPC).
3. `DBMS_VECTOR_CHAIN.UTL_TO_TEXT` extracts text **inside the database**.
4. **AWS Bedrock (Claude Sonnet)** classifies the document and extracts typed JSON fields.
5. Fields are written through a **JSON Duality View** — one row in `documents`, one in `document_fields`.
6. `DBMS_VECTOR_CHAIN.UTL_TO_EMBEDDINGS` generates a 384-dim vector **inside the database** from an ONNX model loaded into Oracle.
7. The frontend reads the doc, renders fields, and shows similar documents via `VECTOR_DISTANCE`.

Everything *about* the document lives in one Oracle 23ai instance: BLOB + extracted text + structured JSON + vector. AWS provides compute, the LLM, and now also the database host (Fargate task with EFS-backed persistent storage).

> **Demo only.** The Lambda Function URL has no auth. The `.env` file is the only source of secrets. Do not expose this stack publicly.

## Prereqs

- Node 20+, pnpm 10+
- An AWS account with **Bedrock model access** for `anthropic.claude-3-5-sonnet-20241022-v2:0`
- `aws` CLI configured with credentials that can deploy CDK, invoke Bedrock, and use SSM Session Manager
- Session Manager plugin for the AWS CLI (for the port-forward step)
- `sqlcl` (for running the bootstrap migration as `system`)

## Quickstart

```bash
# 1. Install deps
pnpm install

# 2. Configure secrets
cp .env.example .env
# Set ORACLE_PASSWORD (strong: 12+ chars, mixed case + digit + special),
# BEDROCK_MODEL_ID, AWS_REGION. Leave ORACLE_CONNECT_STRING at the default
# localhost:1521/FREEPDB1 — that's the local end of the SSM port-forward.

# 3. Deploy the AWS stack (VPC + ECS Fargate Oracle + EFS + bastion + Lambda + S3/CF)
pnpm cdk:deploy
# First deploy is ~10–15 min: NAT, EFS, ~3 GB Oracle image pull, FREEPDB1 init.
# Tail logs and wait for "DATABASE IS READY TO USE!":
#   aws logs tail /aws/ecs/IdpStack-... --follow

# 4. Open an SSM port-forward to the DB (leave running in its own terminal)
aws ssm start-session \
  --target <BastionInstanceId> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["oracle.idp.local"],"portNumber":["1521"],"localPortNumber":["1521"]}'

# 5. Bootstrap the idp user (one-off, as system) — see docs/01-provision-oracle.md
sql system/"$ORACLE_PASSWORD"@localhost:1521/FREEPDB1 @packages/db/migrations/000_bootstrap.sql

# 6. Run schema + duality view migrations (as idp)
pnpm db:setup -- --skip-bootstrap

# 7. Drop the ONNX embedding model into the container, then load it
TASK=$(aws ecs list-tasks --cluster <EcsClusterName> --service-name <EcsDbServiceName> --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster <EcsClusterName> --task "$TASK" --container oracle --interactive \
  --command "bash -lc 'curl -L -o /opt/oracle/admin/FREE/dpdump/all_MiniLM_L6_v2.onnx <ORACLE_ONNX_MODEL_URL>'"
pnpm db:onnx

# 8. Build + sync the SPA
VITE_API_BASE_URL=<ApiUrl> pnpm --filter @idp/web build
aws s3 sync apps/web/dist/ s3://<WebBucketName>/ --delete
aws cloudfront create-invalidation --distribution-id <WebDistributionId> --paths '/*'

# 9. Seed the demo with the committed sample PDFs
API_BASE_URL=<ApiUrl> pnpm seed
```

Tear down with `pnpm cdk:destroy`. Stop the DB to save cost without losing data: `aws ecs update-service --cluster <EcsClusterName> --service <EcsDbServiceName> --desired-count 0`.

### Local-only dev (no AWS)

If you don't want to deploy at all, run Oracle 23ai Free in Docker and point `.env` at it:

```bash
docker run -d --name oracle-free -p 1521:1521 \
  -e ORACLE_PWD=YourStrongPwd \
  container-registry.oracle.com/database/free:latest-lite
# .env: ORACLE_CONNECT_STRING=localhost:1521/FREEPDB1, ORACLE_PASSWORD=YourStrongPwd
sql system/YourStrongPwd@localhost:1521/FREEPDB1 @packages/db/migrations/000_bootstrap.sql
pnpm db:setup -- --skip-bootstrap
docker cp all_MiniLM_L6_v2.onnx oracle-free:/opt/oracle/admin/FREE/dpdump/
pnpm db:onnx
pnpm dev:api   # Hono on :8787
pnpm dev       # Vite on :5173
```

Bedrock calls still go to your AWS account (via your local credentials).

## Repo layout

```
apps/web                — Vite + React + TanStack SPA
packages/core           — Ingest pipeline orchestrator
packages/db             — oracledb pool + repositories + .sql migrations
packages/bedrock        — Bedrock Runtime wrapper (classify + extract)
packages/schemas        — Zod schemas per doc type
packages/hono           — Hono middleware
packages/logger         — JSON logger
packages/shared         — Enums + constants
services/functions/api  — Hono Lambda handler
infrastructure          — CDK single stack
scripts/                — Sample-doc generator, db-setup, onnx upload, seed
samples/                — Committed sample PDFs (generated by scripts/generate-sample-docs.ts)
docs/                   — Provisioning + architecture
```

## What's intentionally *not* here

- Authentication. Demo only.
- AWS Secrets Manager / SSM. The `.env` file is the source of truth and CDK bakes its values into Lambda env vars at deploy time. Lambda env vars are visible in the AWS console — fine for a tutorial, not for prod.
- A search UI. The article demonstrates hybrid search (vector + keyword + JSON predicate) by running SQL from `sqlcl`; the app doesn't expose it.
- OCR for scanned (image-only) PDFs. `UTL_TO_TEXT` handles digital PDFs only — left as exercise for the reader to swap in a vision model.

## Scripts

| Command | Description |
|---|---|
| `pnpm samples` | Re-generate the sample PDFs (deterministic with `--seed`) |
| `pnpm db:setup` | Run migrations against the configured DB |
| `pnpm db:onnx` | Load the ONNX embedding model into Oracle |
| `pnpm seed` | Upload every sample PDF to the API and wait for ingest |
| `pnpm dev` | Run the SPA locally on :5173 |
| `pnpm dev:api` | Run the Hono API locally on :8787 |
| `pnpm cdk:deploy` | Deploy the AWS stack |
| `pnpm typecheck` | Typecheck every workspace package |
