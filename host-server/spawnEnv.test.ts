import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { scrubLeakyEnv, LEAKY_ENV_VARS } from './spawnEnv.ts';

void test('scrubLeakyEnv strips every known-leaky key', () => {
  const env: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgres://stale-do-db',
    HOST_SERVER_URL: 'http://host.docker.internal:8788',
    PUBLIC_API_URL: 'https://example.com/api',
    PUBLIC_BASE_URL: 'https://example.com',
  };
  const scrubbed = scrubLeakyEnv(env);
  for (const key of LEAKY_ENV_VARS) {
    assert.equal(key in scrubbed, false, `expected ${key} to be stripped`);
  }
});

void test('scrubLeakyEnv passes non-leaky keys through unchanged', () => {
  const env: NodeJS.ProcessEnv = {
    BACKEND_PORT: '8788',
    PROXY_TARGET: 'http://localhost:8788',
    PATH: '/usr/bin:/bin',
  };
  const scrubbed = scrubLeakyEnv(env);
  assert.deepEqual(scrubbed, env);
});

void test('scrubLeakyEnv does not mutate its input', () => {
  const env: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://stale-do-db', BACKEND_PORT: '8788' };
  const original = { ...env };
  scrubLeakyEnv(env);
  assert.deepEqual(env, original);
});

void test('scrubLeakyEnv on a mixed env keeps non-leaky keys and drops only leaky ones', () => {
  const env: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgres://stale-do-db',
    BACKEND_PORT: '8788',
    HOST_SERVER_URL: 'http://host.docker.internal:8788',
    FRONTEND_PORT: '4321',
  };
  const scrubbed = scrubLeakyEnv(env);
  assert.deepEqual(scrubbed, { BACKEND_PORT: '8788', FRONTEND_PORT: '4321' });
});
