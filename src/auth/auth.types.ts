import type { Request } from 'express';

export interface ActiveMembershipContext {
  membershipId: string;
  tenantId: string;
  tenantHandle: string;
  status: 'ACTIVE';
  roles: string[];
}

export interface AuthPrincipal {
  userId: string;
  sessionId: string;
  jwtId: string;
  authenticatedAt: number;
  scope: string[];
  activeMembership: ActiveMembershipContext | null;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthPrincipal;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  sessionId: string;
  activeMembership: ActiveMembershipContext | null;
}

export interface IssuedTokenResponse {
  response: TokenResponse;
  refreshExpiresAt: Date;
}
