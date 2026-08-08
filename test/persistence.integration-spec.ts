import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { LoginIdentifierKind, RoleCode, RoleScope } from '../src/generated/prisma/enums.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('PostgreSQL identity constraints (integration)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl! }),
  });

  beforeEach(async () => {
    await prisma.authAuditEvent.deleteMany();
    await prisma.loginIdentifier.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.membershipRole.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.tenantMembership.deleteMany();
    await prisma.role.deleteMany();
    await prisma.tenantRealm.deleteMany();
    await prisma.identityUser.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('allows the same normalized username in different tenants but not the same tenant', async () => {
    const tenantA = await prisma.tenantRealm.create({ data: { id: randomUUID(), handle: 'tenant-a' } });
    const tenantB = await prisma.tenantRealm.create({ data: { id: randomUUID(), handle: 'tenant-b' } });
    const userA = await prisma.identityUser.create({ data: {} });
    const userB = await prisma.identityUser.create({ data: {} });

    await prisma.loginIdentifier.create({
      data: {
        userId: userA.id,
        tenantRealmId: tenantA.id,
        kind: LoginIdentifierKind.USERNAME,
        normalizedValue: 'shared.username',
      },
    });
    await expect(
      prisma.loginIdentifier.create({
        data: {
          userId: userB.id,
          tenantRealmId: tenantB.id,
          kind: LoginIdentifierKind.USERNAME,
          normalizedValue: 'shared.username',
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.loginIdentifier.create({
        data: {
          userId: userB.id,
          tenantRealmId: tenantA.id,
          kind: LoginIdentifierKind.USERNAME,
          normalizedValue: 'shared.username',
        },
      }),
    ).rejects.toBeDefined();
  });

  it('permits unverified duplicate email values but globally rejects a second verified one', async () => {
    const userA = await prisma.identityUser.create({ data: {} });
    const userB = await prisma.identityUser.create({ data: {} });

    await prisma.loginIdentifier.createMany({
      data: [
        {
          userId: userA.id,
          kind: LoginIdentifierKind.EMAIL,
          normalizedValue: 'person@example.test',
        },
        {
          userId: userB.id,
          kind: LoginIdentifierKind.EMAIL,
          normalizedValue: 'person@example.test',
        },
      ],
    });
    await prisma.loginIdentifier.updateMany({
      where: { userId: userA.id },
      data: { verifiedAt: new Date() },
    });
    await expect(
      prisma.loginIdentifier.updateMany({
        where: { userId: userB.id },
        data: { verifiedAt: new Date() },
      }),
    ).rejects.toBeDefined();
  });

  it('prevents a session from selecting another user membership as active context', async () => {
    const tenant = await prisma.tenantRealm.create({ data: { id: randomUUID(), handle: 'tenant-a' } });
    const userA = await prisma.identityUser.create({ data: {} });
    const userB = await prisma.identityUser.create({ data: {} });
    const membershipB = await prisma.tenantMembership.create({
      data: { userId: userB.id, tenantRealmId: tenant.id },
    });

    await expect(
      prisma.session.create({
        data: {
          userId: userA.id,
          activeMembershipId: membershipB.id,
          idleExpiresAt: new Date(Date.now() + 60_000),
          absoluteExpiresAt: new Date(Date.now() + 120_000),
        },
      }),
    ).rejects.toBeDefined();
  });

  it('keeps platform roles separate from tenant membership roles', async () => {
    const tenant = await prisma.tenantRealm.create({ data: { id: randomUUID(), handle: 'tenant-a' } });
    const user = await prisma.identityUser.create({ data: {} });
    const membership = await prisma.tenantMembership.create({
      data: { userId: user.id, tenantRealmId: tenant.id },
    });
    const systemAdmin = await prisma.role.create({
      data: { code: RoleCode.SYSTEM_ADMIN, scope: RoleScope.PLATFORM },
    });
    const teacher = await prisma.role.create({
      data: { code: RoleCode.TEACHER, scope: RoleScope.TENANT },
    });

    await expect(
      prisma.membershipRole.create({
        data: { membershipId: membership.id, roleId: systemAdmin.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.userRole.create({ data: { userId: user.id, roleId: teacher.id } }),
    ).rejects.toBeDefined();
    await expect(
      prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: teacher.id } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.userRole.create({ data: { userId: user.id, roleId: systemAdmin.id } }),
    ).resolves.toBeDefined();
  });

  it('prevents a refresh token from joining a different session token family', async () => {
    const user = await prisma.identityUser.create({ data: {} });
    const sessionA = await prisma.session.create({
      data: {
        userId: user.id,
        idleExpiresAt: new Date(Date.now() + 60_000),
        absoluteExpiresAt: new Date(Date.now() + 120_000),
      },
    });
    const sessionB = await prisma.session.create({
      data: {
        userId: user.id,
        idleExpiresAt: new Date(Date.now() + 60_000),
        absoluteExpiresAt: new Date(Date.now() + 120_000),
      },
    });

    await expect(
      prisma.refreshToken.create({
        data: {
          id: randomUUID(),
          sessionId: sessionA.id,
          familyId: sessionB.refreshTokenFamilyId,
          tokenHash: '$argon2id$synthetic-test-hash',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toBeDefined();
  });
});
