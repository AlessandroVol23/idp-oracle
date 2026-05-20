# Provision OCI Generative AI for in-database classify + extract

This step registers a credential inside the database so that `DBMS_VECTOR_CHAIN.UTL_TO_GENERATE_TEXT` can call OCI Generative AI (Cohere Command R+ by default) from a SQL statement. After this is done, classification and field extraction happen inside the database — no external Bedrock/OpenAI call from your application.

Cost: OCI Generative AI is pay-per-token. Cohere Command R+ is ~$3 input + $15 output per million tokens at the time of writing. The full pipeline (classify + extract for one document) is ~$0.0001-0.0005 per doc.

Takes ~3 minutes.

## 1. Create the API key and grab four of the five values from one screen

OCI console → top-right profile avatar → **My profile**.

You will land on a page with tabs (`Details`, `My groups`, `My requests`, `My resources`, **`Tokens and keys`**, ...). Click **Tokens and keys**.

In the **API keys** section:

1. **Add API key** → **Generate API key pair**.
2. **Download private key** — save to `~/.oci/idp.pem` (or any stable path; you'll point `.env` at it). The public key is uploaded automatically.
3. **Add**.

After the key is added, OCI shows a **configuration file preview** on the same screen. It looks like this:

```ini
[DEFAULT]
user=ocid1.user.oc1..aaaaaaaa....
fingerprint=aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99
tenancy=ocid1.tenancy.oc1..aaaaaaaa....
region=eu-frankfurt-1
key_file=<path to your private keyfile> # TODO
```

This single block gives you **four of the five values** at once:

| `.env` variable | Where in the preview |
|---|---|
| `OCI_USER_OCID` | `user=...` |
| `OCI_FINGERPRINT` | `fingerprint=...` |
| `OCI_TENANCY_OCID` | `tenancy=...` |
| `OCI_GENAI_REGION` | `region=...` (only if you want a region other than the default `eu-frankfurt-1`) |

The fifth value is the **compartment OCID**. For Always Free / single-user setups, use the **root compartment**, whose OCID is identical to the tenancy OCID. (Multi-team setups: Identity & Security → Compartments → pick a sub-compartment.)

The sixth `.env` line, `OCI_PRIVATE_KEY_PATH`, points at the `.pem` you downloaded in step 2.

Tighten the key's permissions on disk:

```bash
chmod 600 ~/.oci/idp.pem
```

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

`OCI_GENAI_MODEL` is the chat model ID. Available in `eu-frankfurt-1` (current as of writing — check OCI console → **Analytics & AI → Generative AI → Playground** for the live list in your region):

| Model | Approx. price (per M tokens) | Notes |
|---|---|---|
| `cohere.command-r-plus-08-2024` | $3 in / $15 out | Default in this repo. Reliable structured JSON output for invoices / contracts / CVs. |
| `cohere.command-r-08-2024` | $0.50 in / $1.50 out | 6× cheaper. Less consistent on deeply-nested schemas (`keyClauses[]`, `lineItems[]`), so the Zod retry triggers more often. Worth trying if cost matters. |
| `meta.llama-3.3-70b-instruct` | ~$0.60 combined | Strong general model. JSON output is decent but you'll lean on the retry more than with Cohere. |
| `meta.llama-3.1-405b-instruct` | ~$5 combined | Largest available. Overkill for typed extraction on short documents. |

Switching is a one-line change in `.env` followed by an API restart — no code changes needed. The same prompt + JSON Schema gets sent to whichever model you point at.

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
