import * as readline from 'node:readline';
import * as fs from 'node:fs';
import { credentialsPath, writeCredentials } from './credentials.ts';

/**
 * Opens a readline interface on /dev/tty so prompts work even when stdin is piped.
 */
function openTty(): readline.Interface {
  const input = fs.createReadStream('/dev/tty');
  const output = fs.createWriteStream('/dev/tty');
  return readline.createInterface({ input, output, terminal: true });
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

/**
 * Normalises a pairing code: uppercase, strip dashes and spaces.
 * Example: "abcd-efgh" → "ABCDEFGH"
 */
function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[-\s]/g, '');
}

interface RedeemSuccess {
  token: string;
  deviceId: string;
}

interface RedeemError {
  error: string;
  message?: string;
}

/**
 * Orchestrates the device pairing flow.
 *
 * @param opts.portalUrl  Portal base URL (e.g. https://portal.example.com).
 *                        If absent, the user is prompted interactively.
 * @param opts.code       Raw pairing code (dashes/spaces allowed).
 *                        If absent, the user is prompted interactively.
 */
export async function pairDevice(opts: {
  portalUrl?: string;
  code?: string;
}): Promise<void> {
  let portalUrl = opts.portalUrl?.trim() ?? '';
  let rawCode = opts.code?.trim() ?? '';

  // Open /dev/tty only if we need interactive prompts.
  const needTty = !portalUrl || !rawCode;
  const rl = needTty ? openTty() : null;

  try {
    // --- Prompt for portal URL if not supplied ---
    if (!portalUrl) {
      portalUrl = (await prompt(rl!, 'Enter portal URL (https://...): ')).trim();
    }

    if (!portalUrl) {
      throw new Error('Portal URL is required.');
    }

    const isLocalhost =
      portalUrl.startsWith('http://localhost') ||
      portalUrl.startsWith('http://127.0.0.1');

    if (!portalUrl.startsWith('https://') && !isLocalhost) {
      console.warn(
        `Warning: portal URL uses HTTP on a non-localhost host (${portalUrl}). ` +
          'Your pairing code will be transmitted in plain text.',
      );
    }

    // Strip trailing slash for clean URL construction.
    portalUrl = portalUrl.replace(/\/$/, '');

    // --- Prompt for pairing code if not supplied ---
    if (!rawCode) {
      rawCode = (await prompt(rl!, 'Enter pairing code (XXXX-XXXX): ')).trim();
    }

    if (!rawCode) {
      throw new Error('Pairing code is required.');
    }

    const code = normaliseCode(rawCode);

    // --- POST to /api/pair/redeem ---
    const redeemUrl = `${portalUrl}/api/pair/redeem`;
    let resp: Response;
    try {
      resp = await fetch(redeemUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    } catch (err) {
      throw new Error(
        `Network error reaching ${redeemUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!resp.ok) {
      let errBody: RedeemError = { error: `http_${resp.status}` };
      try {
        errBody = (await resp.json()) as RedeemError;
      } catch {
        // ignore JSON parse errors; use the default error object
      }
      const detail = errBody.message ?? errBody.error;
      throw new Error(
        `Pairing failed: ${detail} — generate a new code from the portal.`,
      );
    }

    const body = (await resp.json()) as RedeemSuccess;

    if (!body.token || !body.deviceId) {
      throw new Error('Pairing failed: portal returned an incomplete response (missing token or deviceId).');
    }

    // --- Persist credentials ---
    writeCredentials({
      portalUrl,
      deviceId: body.deviceId,
      token: body.token,
    });

    console.log(
      `✓ Paired device ${body.deviceId} to ${portalUrl}. Credentials saved to ${credentialsPath()}.`,
    );
  } finally {
    rl?.close();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point: node --import tsx/esm daemon/pair.ts [--portal <url>] [--code <code>]
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const portalIdx = args.indexOf('--portal');
  const codeIdx = args.indexOf('--code');

  const portalUrl = portalIdx !== -1 ? args[portalIdx + 1] : undefined;
  const code = codeIdx !== -1 ? args[codeIdx + 1] : undefined;

  const pairOpts: { portalUrl?: string; code?: string } = {};
  if (portalUrl !== undefined) pairOpts.portalUrl = portalUrl;
  if (code !== undefined) pairOpts.code = code;

  pairDevice(pairOpts).catch(err => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
