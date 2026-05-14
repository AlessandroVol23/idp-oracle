# Provisioning Oracle Autonomous AI Database 26ai (Always Free)

This walkthrough creates the cloud database the rest of the tutorial assumes. Takes ~5 minutes.

## 1. Sign up for OCI Always Free

Go to https://www.oracle.com/cloud/free/ and create a free OCI account. No credit card needed for Always Free resources.

## 2. Create the Autonomous Database

1. Sign in to the OCI console: https://cloud.oracle.com
2. Navigate to **Oracle Database → Autonomous Database**.
3. Click **Create Autonomous Database**.
4. Settings:
   - **Display name**: `idp`
   - **Workload type**: **AI** (this is the 26ai option)
   - **Always Free**: ✓
   - **Database version**: 26ai (the latest available)
   - **Password**: pick a strong ADMIN password and save it — you'll need it.
5. **Network access** — pick one:
   - **Secure access from allowed IPs and VCNs** (recommended for this tutorial — no wallet needed)
     - Add your current public IP to the ACL.
   - *(Alternative)* **Secure access from everywhere** — easier but exposes the DB endpoint to the world; only for short-lived demos.
6. Wait ~2 minutes for the instance to come up.

## 3. Get the connect string

1. From the DB detail page, click **Database connection**.
2. **TLS authentication**: choose **TLS** (not mTLS).
3. Copy the **TNS Name** for the `_high` service, e.g. `idp_high`.
4. Copy the full connect string under **Connection Strings** — looks like:
   ```
   (description=(retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1521)(host=adb.<region>.oraclecloud.com))(connect_data=(service_name=<long_id>_idp_high.adb.oraclecloud.com))(security=(ssl_server_dn_match=yes)))
   ```
5. Paste it into `.env` as `ORACLE_CONNECT_STRING`.

The TNS-style descriptor works with `node-oracledb` thin mode out of the box — no wallet, no `TNS_ADMIN`.

## 4. Create the `idp` application user

The repo migrations are owned by an `idp` user, not ADMIN.

1. From the DB detail page, click **Database actions** → **SQL**.
2. Sign in as ADMIN with the password from step 2.
3. Open `packages/db/migrations/000_bootstrap.sql` from this repo, paste it into the worksheet, **replace `<YOUR_IDP_PASSWORD>` with the password you want to use**, and run it.
4. Set the same password as `ORACLE_PASSWORD` in `.env`. Set `ORACLE_USER=idp`.

## 5. Run the schema migrations

From the repo root with your `.env` populated:

```bash
pnpm db:setup
```

This runs `001_schema.sql` and `002_duality_views.sql` as the `idp` user.

## 6. Load the ONNX embedding model

26ai generates embeddings *inside the database* from an ONNX model that lives in the DB. We use `all-MiniLM-L6-v2` (384 dimensions).

1. Download `all_MiniLM_L6_v2.onnx` from Oracle's pre-built model distribution. (Oracle publishes a packaged ONNX file ready for `DBMS_VECTOR.LOAD_ONNX_MODEL`.)
2. Upload the file into the `DATA_PUMP_DIR` of your Autonomous Database. Easiest path: **Database Actions → Data Studio → Data Load → Cloud Store** or via the Object Storage console. (See the Autonomous DB docs for the exact upload UI flow.)
3. Run:
   ```bash
   pnpm db:onnx
   ```
4. Expected output:
   ```
   OK. Embedding dimension = 384
   ```

## 7. Smoke test from Node

```bash
pnpm dev:api
# in another terminal:
curl http://localhost:8787/health
# → {"ok":true}
```

If you can hit `/health`, the connection pool initialized — meaning credentials + ACL + connect string are all good.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `ORA-12506` / TLS handshake errors | Your IP isn't in the ACL. Edit the DB's network config and add it. |
| `ORA-01017 invalid username/password` | Check `.env` matches the password you set in `000_bootstrap.sql`. |
| `ORA-00942 table or view does not exist` | Migrations didn't run, or you're connected as the wrong user. Run `pnpm db:setup` with `ORACLE_USER=idp`. |
| `pnpm db:onnx` fails with file-not-found | The ONNX file isn't in `DATA_PUMP_DIR`. List directory contents: `SELECT * FROM table(dbms_lock.sleep(0)) -- placeholder`, then use the Database Actions Data Load UI to upload. |
