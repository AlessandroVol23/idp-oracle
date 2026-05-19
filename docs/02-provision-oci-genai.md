# Provision OCI Generative AI for in-database classify + extract

This step registers a credential inside the database so that `DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT` can call OCI Generative AI (Cohere Command R+ by default) from a SQL statement. After this is done, classification and field extraction happen inside the database — no external Bedrock/OpenAI call from your application.

Cost: OCI Generative AI is pay-per-token. Cohere Command R+ is ~$3 input + $15 output per million tokens at the time of writing. The full pipeline (classify + extract for one document) is ~$0.0001-0.0005 per doc.

Takes ~3 minutes.

## 1. Create an API key for your OCI user

OCI console → top-right profile avatar → **My profile**.

You will land on a page with tabs (`Details`, `My groups`, `My requests`, `My resources`, **`Tokens and keys`**, ...). Click **Tokens and keys**.

In the **API keys** section:

1. **Add API key** → **Generate API key pair**.
2. **Download private key** — save to `~/.oci/idp.pem` (or any stable path; you'll point `.env` at it). The public key is uploaded to OCI automatically.
3. **Add**.
4. The new key row will show a **fingerprint** like `6a:bc:31:32:11:b8:2a:08:7c:9b:62:50:83:4d:46:40`. Copy it.

Tighten the key's permissions on disk:

```bash
chmod 600 ~/.oci/idp.pem
```

## 2. Collect OCIDs

Five values needed:

| Variable | Where |
|---|---|
| `OCI_USER_OCID` | Profile page → **Details** tab → **OCID** field → click **Copy** (the value shown is truncated; the clipboard has the full OCID). |
| `OCI_TENANCY_OCID` | Profile dropdown → **Tenancy: <yourname>** → tenancy details page → OCID at top. |
| `OCI_COMPARTMENT_OCID` | The root compartment OCID is identical to `OCI_TENANCY_OCID`. For the article use the root. (For multi-team setups: Identity & Security → Compartments → pick a sub-compartment.) |
| `OCI_FINGERPRINT` | From step 1. |
| `OCI_PRIVATE_KEY_PATH` | The local path to the `.pem` file from step 1, e.g. `/Users/you/.oci/idp.pem`. |

## 3. Populate `.env`

Append to `.env`:

```
OCI_USER_OCID=ocid1.user.oc1..xxxx
OCI_TENANCY_OCID=ocid1.tenancy.oc1..xxxx
OCI_COMPARTMENT_OCID=ocid1.tenancy.oc1..xxxx
OCI_FINGERPRINT=aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99
OCI_PRIVATE_KEY_PATH=/Users/you/.oci/idp.pem
OCI_GENAI_REGION=eu-frankfurt-1
OCI_GENAI_MODEL=cohere.command-r-plus-08-2024
```

`OCI_GENAI_REGION` must be a region where OCI Generative AI is enabled. Frankfurt, Chicago, Phoenix, London, and São Paulo all work. The inference endpoint is derived as `https://inference.generativeai.<region>.oci.oraclecloud.com`.

`OCI_GENAI_MODEL` is the chat model ID. Cohere Command R+ is a good default for structured extraction. Meta Llama 3.x and other models work too; check the OCI console under **Analytics & AI → Generative AI** for what's available in your region.

## 4. Register the credential inside the database

```bash
pnpm db:setup-oci-credential
```

This script does three things:

1. As ADMIN: grants `CREATE CREDENTIAL`, `EXECUTE ON DBMS_CLOUD`, `EXECUTE ON DBMS_CLOUD_AI` to the `idp` user, and opens an outbound network ACL to the OCI Generative AI inference host.
2. As `idp`: calls `DBMS_VECTOR_CHAIN.CREATE_CREDENTIAL` to register the credential under the name `OCI_CRED`. The private key is sent with `BEGIN/END` lines stripped.
3. As `idp`: runs a smoke test — `SELECT DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT('Reply with the single word PONG.', ...) FROM DUAL`. You should see:

   ```
   ✓ response: PONG.
   ```

If the smoke test prints `PONG`, the entire chain (API key → fingerprint → network → credential → model) is correct. The rest of the pipeline now works.

## How `UTL_TO_GENERATE_TEXT` is used

`packages/db/src/llm.ts` wraps two SQL queries:

```sql
SELECT DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT(
  :prompt,
  JSON('{
    "provider": "ocigenai",
    "credential_name": "OCI_CRED",
    "url": "https://inference.generativeai.eu-frankfurt-1.oci.oraclecloud.com/20231130/actions/chat",
    "model": "cohere.command-r-plus-08-2024",
    "chatRequest": { "maxTokens": 4096, "temperature": 0 }
  }')
) AS OUT FROM DUAL;
```

- For classify: `:prompt` is the extracted document text plus a "return JSON `{docType, confidence}`" instruction.
- For extract: `:prompt` is the document text plus the doc-type's JSON Schema (generated from the Zod schema in `@idp/schemas` via `zodToJsonSchema`).

The CLOB returned by the function is parsed in TypeScript and validated against the corresponding Zod schema. On validation failure, `extractFieldsInDb` retries once with the Zod error message fed back into the prompt so the model can self-correct. Cohere Command R+ is less strict than Claude about filling every field on the first try, so the retry catches most failures.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `PLS-00201: identifier 'DBMS_CLOUD' must be declared` | The `idp` user doesn't have `EXECUTE` on `DBMS_CLOUD`. Re-run `pnpm db:setup-oci-credential` — the script grants this before creating the credential. |
| `PLS-00201: identifier 'DBMS_CLOUD_AI' must be declared` | Same as above for `DBMS_CLOUD_AI`. |
| `ORA-29024 Certificate validation failure` | The outbound network ACL is missing the OCI Gen AI host. The setup script opens it; if you changed `OCI_GENAI_REGION` after running setup, re-run it. |
| `Service Unavailable` or `404 Not Found` from OCI | The inference URL is region-derived. Check `OCI_GENAI_REGION` is a region with OCI Gen AI enabled. |
| `Authorization Failed` (401 / 403) | Fingerprint doesn't match the uploaded public key, or the private key file path is wrong, or the user lacks `manage generative-ai-family` policy in the compartment. |
| Zod parse errors on `extractFieldsInDb` | Cohere returned malformed JSON or null on a required field. `extractFieldsInDb` retries once; if it still fails, the doc is marked `failed` with the Zod error stored in `documents.failed_reason`. |
