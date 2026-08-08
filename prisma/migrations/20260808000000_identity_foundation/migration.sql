-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IdentityUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "LoginIdentifierKind" AS ENUM ('USERNAME', 'EMAIL');

-- CreateEnum
CREATE TYPE "TenantRealmStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SYSTEM_ADMIN', 'TENANT_ADMIN', 'TEACHER', 'STUDENT', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'TENANT');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "identity_users" (
    "id" UUID NOT NULL,
    "status" "IdentityUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),

    CONSTRAINT "identity_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_identifiers" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantRealmId" UUID,
    "kind" "LoginIdentifierKind" NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_credentials" (
    "userId" UUID NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSetAt" TIMESTAMPTZ(3) NOT NULL,
    "failedAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "tenant_realms" (
    "id" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "status" "TenantRealmStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_realms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tenantRealmId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "activatedAt" TIMESTAMPTZ(3),
    "suspendedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "membershipId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "roleScope" "RoleScope" NOT NULL DEFAULT 'TENANT',
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "roleScope" "RoleScope" NOT NULL DEFAULT 'PLATFORM',
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "activeMembershipId" UUID,
    "refreshTokenFamilyId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revocationReason" TEXT,
    "deviceLabel" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "rotatedFromId" UUID,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_challenges" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "failedAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_audit_events" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "tenantRealmId" UUID,
    "sessionId" UUID,
    "eventType" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "requestId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- Username identifiers are tenant-scoped; email identifiers are global.
ALTER TABLE "login_identifiers"
ADD CONSTRAINT "login_identifiers_scope_check"
CHECK (
    ("kind" = 'USERNAME' AND "tenantRealmId" IS NOT NULL)
    OR ("kind" = 'EMAIL' AND "tenantRealmId" IS NULL)
);

-- SYSTEM_ADMIN is platform-scoped. All other approved role codes are tenant-scoped.
ALTER TABLE "roles"
ADD CONSTRAINT "roles_code_scope_check"
CHECK (
    ("code" = 'SYSTEM_ADMIN' AND "scope" = 'PLATFORM')
    OR ("code" <> 'SYSTEM_ADMIN' AND "scope" = 'TENANT')
);

ALTER TABLE "membership_roles"
ADD CONSTRAINT "membership_roles_scope_check" CHECK ("roleScope" = 'TENANT');

ALTER TABLE "user_roles"
ADD CONSTRAINT "user_roles_scope_check" CHECK ("roleScope" = 'PLATFORM');

-- CreateIndex
CREATE INDEX "login_identifiers_user_kind_idx" ON "login_identifiers"("userId", "kind");

-- CreateIndex
CREATE INDEX "login_identifiers_kind_value_idx" ON "login_identifiers"("kind", "normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "login_identifiers_realm_kind_value_key" ON "login_identifiers"("tenantRealmId", "kind", "normalizedValue");

-- Unverified email values may collide; a verified normalized email belongs to one user globally.
CREATE UNIQUE INDEX "login_identifiers_verified_email_key"
ON "login_identifiers"("normalizedValue")
WHERE "kind" = 'EMAIL' AND "verifiedAt" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tenant_realms_handle_key" ON "tenant_realms"("handle");

-- CreateIndex
CREATE INDEX "tenant_memberships_tenant_status_idx" ON "tenant_memberships"("tenantRealmId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_user_tenant_key" ON "tenant_memberships"("userId", "tenantRealmId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_id_user_key" ON "tenant_memberships"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- Supports scope-safe role assignment foreign keys.
CREATE UNIQUE INDEX "roles_id_scope_key" ON "roles"("id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenFamilyId_key" ON "sessions"("refreshTokenFamilyId");

-- CreateIndex
CREATE INDEX "sessions_user_revoked_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_active_membership_idx" ON "sessions"("activeMembershipId");

-- Refresh tokens must use the family owned by their session.
CREATE UNIQUE INDEX "sessions_id_refresh_family_key" ON "sessions"("id", "refreshTokenFamilyId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_rotatedFromId_key" ON "refresh_tokens"("rotatedFromId");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_family_idx" ON "refresh_tokens"("sessionId", "familyId");

-- CreateIndex
CREATE INDEX "invitations_membership_expiry_idx" ON "invitations"("membershipId", "expiresAt");

-- CreateIndex
CREATE INDEX "activation_challenges_membership_expiry_idx" ON "activation_challenges"("membershipId", "expiresAt");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_expiry_idx" ON "password_reset_tokens"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "auth_audit_events_actor_time_idx" ON "auth_audit_events"("actorUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "auth_audit_events_tenant_time_idx" ON "auth_audit_events"("tenantRealmId", "occurredAt");

-- CreateIndex
CREATE INDEX "auth_audit_events_session_time_idx" ON "auth_audit_events"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "auth_audit_events_request_idx" ON "auth_audit_events"("requestId");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_idx" ON "outbox_events"("status", "availableAt");

-- AddForeignKey
ALTER TABLE "login_identifiers" ADD CONSTRAINT "login_identifiers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_identifiers" ADD CONSTRAINT "login_identifiers_tenantRealmId_fkey" FOREIGN KEY ("tenantRealmId") REFERENCES "tenant_realms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenantRealmId_fkey" FOREIGN KEY ("tenantRealmId") REFERENCES "tenant_realms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_roleId_roleScope_fkey" FOREIGN KEY ("roleId", "roleScope") REFERENCES "roles"("id", "scope") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_roleScope_fkey" FOREIGN KEY ("roleId", "roleScope") REFERENCES "roles"("id", "scope") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_activeMembershipId_userId_fkey" FOREIGN KEY ("activeMembershipId", "userId") REFERENCES "tenant_memberships"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_sessionId_familyId_fkey" FOREIGN KEY ("sessionId", "familyId") REFERENCES "sessions"("id", "refreshTokenFamilyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "refresh_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activation_challenges" ADD CONSTRAINT "activation_challenges_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_audit_events" ADD CONSTRAINT "auth_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_audit_events" ADD CONSTRAINT "auth_audit_events_tenantRealmId_fkey" FOREIGN KEY ("tenantRealmId") REFERENCES "tenant_realms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_audit_events" ADD CONSTRAINT "auth_audit_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
