export type AuthMethod = "oidc_session" | "api_token" | "ha_token" | "webhook_signature";

export interface User {
  id: string;
  email: string;
  displayName?: string;
  oidcSubject?: string;
  createdAt: string;
  updatedAt: string;
}

export type ApiTokenScope =
  | "read"
  | "write"
  | "admin"
  | "ha_integration"
  | "webhook";

export interface ApiToken {
  id: string;
  userId: string;
  name: string;
  scopes: ApiTokenScope[];
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
}
