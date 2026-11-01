import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { PublicKeyNotConfiguredError, b64url, unverifiedClaims, verifyAccessToken } from './access-token';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const env = { BOS_JWT_PUBLIC_KEY: PUBLIC_PEM };
const now = 1_793_547_034_000; // ms

function sign(claims: Record<string, unknown>, key = privateKey, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' }): string {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(data).sign(key);
  return `${data}.${b64url(signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength))}`;
}

const CLAIMS = { sub: 'user-1', email: 'u1@example.com', entityId: 'org-1', entityRole: 'EntityAdmin', iat: now / 1000, exp: now / 1000 + 900 };

test('a token signed by auth-service\'s key is accepted with its claims', async () => {
  const claims = await verifyAccessToken(sign(CLAIMS), now, env);
  assert.equal(claims?.sub, 'user-1');
  assert.equal(claims?.entityId, 'org-1');
  assert.equal(claims?.exp, CLAIMS.exp);
});

test('the PEM may arrive with escaped newlines', async () => {
  const escaped = { BOS_JWT_PUBLIC_KEY: PUBLIC_PEM.replace(/\n/g, '\\n') };
  assert.equal((await verifyAccessToken(sign(CLAIMS), now, escaped))?.sub, 'user-1');
});

test('a token signed by another key, tampered, expired or not yet valid is refused', async () => {
  assert.equal(await verifyAccessToken(sign(CLAIMS, other.privateKey), now, env), null);

  const [head, , sig] = sign(CLAIMS).split('.');
  const forged = b64url(JSON.stringify({ ...CLAIMS, entityId: 'org-2' }));
  assert.equal(await verifyAccessToken(`${head}.${forged}.${sig}`, now, env), null);

  assert.equal(await verifyAccessToken(sign({ ...CLAIMS, exp: now / 1000 - 1 }), now, env), null);
  assert.equal(await verifyAccessToken(sign({ ...CLAIMS, nbf: now / 1000 + 60 }), now, env), null);
});

test('only RS256 is accepted, and a token needs a subject and an expiry', async () => {
  assert.equal(await verifyAccessToken(sign(CLAIMS, privateKey, { alg: 'none' }), now, env), null);
  assert.equal(await verifyAccessToken(sign(CLAIMS, privateKey, { alg: 'HS256' }), now, env), null);
  assert.equal(await verifyAccessToken(sign({ ...CLAIMS, sub: undefined }), now, env), null);
  assert.equal(await verifyAccessToken(sign({ ...CLAIMS, exp: undefined }), now, env), null);
  assert.equal(await verifyAccessToken('not.a.token', now, env), null);
  assert.equal(await verifyAccessToken('', now, env), null);
  assert.equal(await verifyAccessToken(undefined, now, env), null);
});

test('a missing or malformed public key is a configuration error, not a bad token', async () => {
  await assert.rejects(verifyAccessToken(sign(CLAIMS), now, {}), PublicKeyNotConfiguredError);
  await assert.rejects(verifyAccessToken(sign(CLAIMS), now, { BOS_JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----' }), PublicKeyNotConfiguredError);
});

test('unverifiedClaims reads the expiry without a key', () => {
  assert.equal(unverifiedClaims(sign(CLAIMS))?.exp, CLAIMS.exp);
  assert.equal(unverifiedClaims('nope'), null);
});
