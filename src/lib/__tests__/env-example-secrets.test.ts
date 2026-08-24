// ══════════════════════════════════════════════════════════════
//  M0.1.1 — .env.example secret regression test
//  Structural checks only. This file contains no real secrets.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const envExamplePath = path.join(process.cwd(), '.env.example');

function readEnvExample(): string {
  assert.ok(fs.existsSync(envExamplePath), '.env.example must exist');
  return fs.readFileSync(envExamplePath, 'utf8');
}

/** Parse KEY=VALUE pairs; quoted values keep surrounding structure stripped. */
function parseValues(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^"/, '').replace(/"$/, '');
  }
  return values;
}

describe('M0.1.1 — .env.example must contain placeholders only', () => {
  it('exists and declares the expected variables', () => {
    const values = parseValues(readEnvExample());
    for (const name of [
      'FIREBASE_API_KEY',
      'FIREBASE_PROJECT_ID',
      'FIREBASE_PRIVATE_KEY',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_DATABASE_URL',
      'JWT_SECRET',
      'CRON_SECRET',
    ]) {
      assert.ok(values[name] !== undefined, `missing variable: ${name}`);
    }
  });

  it('contains no Firebase web API key values (AIza… format)', () => {
    assert.doesNotMatch(
      readEnvExample(),
      /AIza[0-9A-Za-z_-]{35}/,
      'realistic Firebase API key pattern found in .env.example'
    );
  });

  it('contains no PEM private key material (no base64 body)', () => {
    const content = readEnvExample();
    // PEM header followed by a substantial base64 body = real key material
    assert.doesNotMatch(
      content,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?[A-Za-z0-9+/]{60,}/,
      'PEM private key body found in .env.example'
    );
    // any long uninterrupted base64 run anywhere in the file
    assert.doesNotMatch(
      content,
      /[A-Za-z0-9+/]{80,}/,
      'long base64 run found in .env.example'
    );
  });

  it('FIREBASE_PRIVATE_KEY is the placeholder, not key material', () => {
    const value = parseValues(readEnvExample()).FIREBASE_PRIVATE_KEY ?? '';
    assert.match(value, /BEGIN PRIVATE KEY/);
    assert.match(value, /YOUR_PRIVATE_KEY/);
    assert.doesNotMatch(value, /[A-Za-z0-9+/]{60,}/);
  });

  it('FIREBASE_MESSAGING_SENDER_ID is not a real numeric sender ID', () => {
    const value = parseValues(readEnvExample()).FIREBASE_MESSAGING_SENDER_ID ?? '';
    assert.doesNotMatch(value, /^\d{10,12}$/, 'numeric sender ID found');
  });

  it('every value is placeholder-marked', () => {
    const values = parseValues(readEnvExample());
    for (const [name, value] of Object.entries(values)) {
      if (value === '') continue;
      assert.match(
        value,
        /your[-_]/i,
        `value of ${name} does not look like a placeholder`
      );
    }
  });
});
