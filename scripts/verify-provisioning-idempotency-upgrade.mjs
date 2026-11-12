import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;
const repo = resolve(import.meta.dirname, '..');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL to an empty local disposable PostgreSQL database.');

const url = new URL(databaseUrl);
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || databaseName !== 'identity_idempotency_upgrade_test') {
  throw new Error('Refusing to run: use localhost and database identity_idempotency_upgrade_test only.');
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const existing = await client.query(`
    SELECT to_regclass('public._prisma_migrations') AS ledger,
           to_regclass('public.identity_users') AS users
  `);
  if (existing.rows[0].ledger || existing.rows[0].users) {
    throw new Error('Refusing to run: target database is not empty.');
  }

  const migrationsPath = resolve(repo, 'prisma', 'migrations');
  const historicalNames = [
    '20260808000000_identity_foundation',
    '20260809000000_account_lifecycle',
    '20260831000000_provisioning_idempotency_receipts',
  ];
  await client.query(`
    CREATE TABLE public."_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  for (const migrationName of historicalNames) {
    const sql = await readFile(resolve(migrationsPath, migrationName, 'migration.sql'));
    await client.query('BEGIN');
    try {
      await client.query(sql.toString('utf8'));
      await client.query(
        `INSERT INTO public."_prisma_migrations"
          ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
         VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  const actorId = randomUUID();
  const tenantId = randomUUID();
  const receiptId = randomUUID();
  const createdAt = new Date('2026-09-23T12:00:00.000Z');
  await client.query(
    `INSERT INTO public.identity_users (id, status, "createdAt", "updatedAt")
     VALUES ($1, 'ACTIVE', $2, $2)`,
    [actorId, createdAt],
  );
  await client.query(
    `INSERT INTO public.tenant_realms (id, handle, status, "createdAt", "updatedAt")
     VALUES ($1, 'synthetic-upgrade-test', 'ACTIVE', $2, $2)`,
    [tenantId, createdAt],
  );
  const responseBody = '{"membershipId":"synthetic-membership"}';
  const payloadHash = createHash('sha256').update('{"synthetic":true}').digest('hex');
  await client.query(
    `INSERT INTO public.provisioning_idempotency_receipts
      (id, operation, "actorUserId", "tenantRealmId", "idempotencyKey", "payloadHash", "statusCode", "responseBody", "createdAt")
     VALUES ($1, 'MEMBERSHIP_PROVISION', $2, $3, 'synthetic-upgrade-key', $4, 201, $5, $6)`,
    [receiptId, actorId, tenantId, payloadHash, responseBody, createdAt],
  );

  const before = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public."_prisma_migrations") AS migration_count,
      (SELECT count(*)::int FROM public.identity_users) AS user_count,
      (SELECT count(*)::int FROM public.tenant_realms) AS tenant_count,
      (SELECT count(*)::int FROM public.provisioning_idempotency_receipts) AS receipt_count,
      (SELECT count(*)::int FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='RoleCode' AND e.enumlabel='STAFF') AS staff_role
  `);
  if (before.rows[0].migration_count !== 3 || before.rows[0].user_count !== 1 || before.rows[0].tenant_count !== 1 || before.rows[0].receipt_count !== 1 || before.rows[0].staff_role !== 0) {
    throw new Error('Synthetic production baseline does not match the expected three-migration ledger.');
  }

  const prismaCli = resolve(repo, 'node_modules', 'prisma', 'build', 'index.js');
  const migrationRun = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (migrationRun.status !== 0) {
    throw new Error(`Prisma migrate deploy failed:\n${migrationRun.stdout}\n${migrationRun.stderr}`);
  }

  const after = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public."_prisma_migrations") AS migration_count,
      (SELECT count(*)::int FROM public.identity_users) AS user_count,
      (SELECT count(*)::int FROM public.tenant_realms) AS tenant_count,
      (SELECT count(*)::int FROM public.provisioning_idempotency_receipts) AS receipt_count,
      (SELECT "responseBody" FROM public.provisioning_idempotency_receipts WHERE id=$1) AS response_body,
      (SELECT "payloadHash" FROM public.provisioning_idempotency_receipts WHERE id=$1) AS payload_hash,
      (SELECT count(*)::int FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='RoleCode' AND e.enumlabel='STAFF') AS staff_role,
      (SELECT string_agg("migration_name", ',' ORDER BY "migration_name") FROM public."_prisma_migrations" WHERE "finished_at" IS NOT NULL) AS migration_names
  `, [receiptId]);
  const result = after.rows[0];
  const expectedNames = [...historicalNames, '20260924000000_add_staff_role'].sort().join(',');
  if (
    result.migration_count !== 4 || result.user_count !== 1 || result.tenant_count !== 1 ||
    result.receipt_count !== 1 || result.response_body !== responseBody || result.payload_hash !== payloadHash ||
    result.staff_role !== 1 || result.migration_names !== expectedNames
  ) {
    throw new Error(`Upgrade preservation assertion failed: ${JSON.stringify(result)}`);
  }

  const ledger = await client.query(
    `SELECT "migration_name", "checksum", "finished_at" IS NOT NULL AS finished
     FROM public."_prisma_migrations" ORDER BY "migration_name"`,
  );
  for (let index = 0; index < ledger.rows.length; index += 1) {
    const row = ledger.rows[index];
    const sql = await readFile(resolve(migrationsPath, row.migration_name, 'migration.sql'));
    const expectedChecksum = createHash('sha256').update(sql).digest('hex');
    if (!row.finished || row.checksum !== expectedChecksum) {
      throw new Error(`Ledger checksum/preservation assertion failed for ${row.migration_name}.`);
    }
  }
  console.log('PASS upgrade from three historical migrations: only STAFF applied; synthetic user, tenant, receipt, payload hash, response and historical checksums preserved.');
  console.log(migrationRun.stdout.trim());
} finally {
  await client.end();
}
