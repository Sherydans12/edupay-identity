-- Persisted request receipts make membership provisioning retry-safe without
-- storing the request body, credentials, or any activation secret.
CREATE TABLE "provisioning_idempotency_receipts" (
    "id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "actorUserId" UUID NOT NULL,
    "tenantRealmId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 201,
    "responseBody" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provisioning_idempotency_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provisioning_idempotency_receipts_scope_key"
    ON "provisioning_idempotency_receipts"("operation", "actorUserId", "tenantRealmId", "idempotencyKey");

CREATE INDEX "provisioning_idempotency_receipts_created_at_idx"
    ON "provisioning_idempotency_receipts"("createdAt");

ALTER TABLE "provisioning_idempotency_receipts"
    ADD CONSTRAINT "provisioning_idempotency_receipts_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provisioning_idempotency_receipts"
    ADD CONSTRAINT "provisioning_idempotency_receipts_tenantRealmId_fkey"
    FOREIGN KEY ("tenantRealmId") REFERENCES "tenant_realms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
