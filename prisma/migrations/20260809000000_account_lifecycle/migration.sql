-- Account lifecycle adds an explicit intended-email binding and durable email-delivery metadata.
ALTER TABLE "invitations" ADD COLUMN "intendedEmail" TEXT;

ALTER TABLE "outbox_events"
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "deliveryKey" TEXT,
  ADD COLUMN "providerResponseId" TEXT,
  ADD COLUMN "lastError" TEXT;

CREATE UNIQUE INDEX "outbox_events_deliveryKey_key"
  ON "outbox_events"("deliveryKey");
