# Provisioning Oracle Database 23ai Free on ECS Fargate

This walkthrough deploys Oracle Database 23ai Free as a Fargate service inside a private VPC, with EFS-backed persistent storage and an SSM bastion for migrations.

> **Why 23ai instead of 26ai?** This codebase only depends on features that landed in 23ai (`VECTOR`, `DBMS_VECTOR_CHAIN`, JSON Duality Views, `VECTOR_DISTANCE`). The Free container distribution is well-tested and pulls anonymously from `container-registry.oracle.com`.

## What gets created

- VPC (`10.42.0.0/16`), 2 AZs, 1 NAT gateway, public + private subnets.
- ECS Fargate cluster with one task (4 vCPU, 16 GB) running `container-registry.oracle.com/database/free:latest-lite`.
- EFS file system mounted at `/opt/oracle/oradata` (DB data) and `/opt/oracle/admin/FREE/dpdump` (ONNX uploads).
- Cloud Map private DNS — Lambda reaches the DB at `oracle.idp.local:1521/FREEPDB1`.
- An SSM-managed bastion (`t3.nano`) for port-forwarding from your laptop.
- Lambda Function URL is now VPC-attached so it can reach the DB on the private SG.

## 1. Configure `.env`

```bash
cp .env.example .env
```

Set:

- `ORACLE_PASSWORD` — strong password (min 12 chars, mixed case + digit + special). Used as the container's `ORACLE_PWD` (SYS/SYSTEM/PDBADMIN) **and** as the password for the `idp` user.
- `BEDROCK_MODEL_ID`, `AWS_REGION` — your Bedrock setup.
- Leave `ORACLE_CONNECT_STRING=localhost:1521/FREEPDB1` — that's the local end of the SSM port-forward you'll open in step 3.

## 2. Deploy the stack

```bash
pnpm cdk:deploy
```

First deploy is slow (~10–15 min): VPC + NAT, EFS mount targets, Fargate pulling the ~3 GB Oracle image, then Oracle initializing FREEPDB1 on first boot.

Watch the container come up:

```bash
aws logs tail /aws/ecs/IdpStack-... --follow
# wait for: "DATABASE IS READY TO USE!"
```

Outputs include:
- `BastionInstanceId` — for the SSM port-forward
- `OracleConnectString` — what Lambda uses
- `EcsClusterName`, `EcsDbServiceName` — for ECS exec

## 3. Port-forward from your laptop to the DB

In a long-lived terminal:

```bash
aws ssm start-session \
  --target <BastionInstanceId> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["oracle.idp.local"],"portNumber":["1521"],"localPortNumber":["1521"]}'
```

Leave this running. `localhost:1521` on your laptop now tunnels to the Fargate task's port 1521.

## 4. Bootstrap the `idp` user

The container's admin user is `system` (in the FREEPDB1 PDB). Connect as `system` once to create the `idp` application user. Easiest path with `sqlcl`:

```bash
sql system/"$ORACLE_PASSWORD"@localhost:1521/FREEPDB1
SQL> @packages/db/migrations/000_bootstrap.sql
SQL> exit
```

Replace `<YOUR_IDP_PASSWORD>` in `000_bootstrap.sql` with your `ORACLE_PASSWORD` value before running, or paste the file inline.

## 5. Run the schema migrations

```bash
pnpm db:setup -- --skip-bootstrap
```

This connects as `idp` (over the same port-forward) and runs `001_schema.sql` and `002_duality_views.sql`.

## 6. Load the ONNX embedding model

The model file has to live in the container's `DATA_PUMP_DIR` (mounted on EFS at `/opt/oracle/admin/FREE/dpdump`). Use ECS Exec to download it directly into the running task:

```bash
TASK=$(aws ecs list-tasks --cluster <EcsClusterName> --service-name <EcsDbServiceName> --query 'taskArns[0]' --output text)

aws ecs execute-command \
  --cluster <EcsClusterName> \
  --task "$TASK" \
  --container oracle \
  --interactive \
  --command "bash -lc 'curl -L -o /opt/oracle/admin/FREE/dpdump/all_MiniLM_L6_v2.onnx <ORACLE_ONNX_MODEL_URL>'"
```

(Replace `<ORACLE_ONNX_MODEL_URL>` with the download URL from Oracle's pre-built ONNX model distribution. The file is ~80 MB.)

Then load it into the DB:

```bash
pnpm db:onnx
```

Expected output: `OK. Embedding dimension = 384`.

## 7. Smoke test

```bash
curl https://<ApiUrl>/health
# → {"ok":true}
```

The Lambda is in the VPC and reaches the DB through Cloud Map DNS. If health passes, the connection pool initialized.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `ORA-12514` / `service does not exist` | DB still booting. Tail the Fargate logs and wait for "DATABASE IS READY TO USE!". |
| `ORA-01017 invalid username/password` | `ORACLE_PASSWORD` in `.env` doesn't match the password baked into the running task. Update `.env` and `cdk deploy`. |
| `ORA-00942 table or view does not exist` | Migrations didn't run as `idp`, or you skipped step 5. |
| `ORA-29913` / "file not found" on `db:onnx` | The `.onnx` file isn't in the dpdump EFS mount. Re-run the ECS Exec curl in step 6 and verify with `aws ecs execute-command ... --command "ls /opt/oracle/admin/FREE/dpdump"`. |
| `pnpm db:setup` hangs | The SSM port-forward dropped. Re-run step 3. |
| Lambda timeouts on `/health` | Lambda VPC ENIs not yet warm, or DB SG missing the ingress rule for the Lambda SG. Check the `DbSg` ingress rules in the console. |

## Cost notes

Rough monthly cost in `us-east-1`, on at all times:

| Resource | ~$/mo |
|---|---|
| Fargate task (4 vCPU / 16 GB, 24×7) | ~$120 |
| NAT Gateway (1 AZ) | ~$33 |
| EFS (Elastic throughput, ~5 GB used) | ~$2 |
| Bastion (t3.nano) | ~$4 |
| **Total** | **~$160** |

Stop the Fargate service (`aws ecs update-service ... --desired-count 0`) when you're not using it. EFS data persists across restarts.

Tear down with `pnpm cdk:destroy`.
