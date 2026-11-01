/** What the domain-service stand-in (auth-stub.ts) answers: the verified domains of two organizations. */

export const DOMAIN_SERVICE_KEY = 'e2e-domain-service-key';

export const VERIFIED_DOMAINS: Record<string, string[]> = {
  // settings.spec.ts' organization
  '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d': ['verified.test', 'shop.verified.test'],
};
