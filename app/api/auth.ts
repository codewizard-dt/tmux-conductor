// app/api/auth.ts
// better-auth configuration for the app/api service.
//
// Uses the node-postgres Pool from ./db.ts directly (better-auth accepts a pg Pool
// as its `database` option and uses the built-in Kysely adapter against it).
// Run `npm run auth:generate` to (re)generate the SQL schema better-auth requires.

import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { getPool } from './db.ts';
import { env } from './env.ts';

// Google is only wired when BOTH credentials are present; otherwise socialProviders
// is omitted entirely so better-auth doesn't register a half-configured provider.
const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  // node-postgres Pool passed straight through; built-in Kysely adapter handles it.
  database: getPool(),
  secret: env.BETTER_AUTH_SECRET,
  ...(env.PUBLIC_BASE_URL ? { baseURL: env.PUBLIC_BASE_URL } : {}),
  emailAndPassword: {
    enabled: true,
  },
  ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
});
