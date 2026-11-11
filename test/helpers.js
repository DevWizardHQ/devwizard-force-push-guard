import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const BEFORE = 'a'.repeat(40);
export const AFTER = 'b'.repeat(40);
export const SETTINGS_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

const schema = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');

export function memoryD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const statement = (sql, params = []) => ({
    bind: (...args) => statement(sql, args),
    first: async (column) => {
      const row = db.prepare(sql).get(...params);
      if (!row) return null;
      return column ? row[column] : { ...row };
    },
    run: async () => ({ success: true, meta: { changes: db.prepare(sql).run(...params).changes } }),
    all: async () => ({ results: db.prepare(sql).all(...params).map((row) => ({ ...row })) }),
  });
  return { db, prepare: (sql) => statement(sql) };
}

let pem;
export async function privateKeyPem() {
  if (pem) return pem;
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  return pem;
}

export async function makeEnv(extra = {}) {
  return {
    WEBHOOK_SECRET: 'test-secret',
    APP_ID: '1',
    PRIVATE_KEY: await privateKeyPem(),
    DB: memoryD1(),
    SETTINGS_KEY,
    TELEGRAM_BOT_TOKEN: '123:abc',
    TELEGRAM_BOT_USERNAME: 'ForceFenceBot',
    TELEGRAM_WEBHOOK_SECRET: 'tg-secret',
    GITHUB_CLIENT_ID: 'Iv1.client',
    GITHUB_CLIENT_SECRET: 'client-secret',
    SESSION_SECRET: 'session-secret',
    ...extra,
  };
}

export function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    let body = init.body;
    try {
      body = body && JSON.parse(body);
    } catch {}
    calls.push({ url, method, body, auth: init.headers?.authorization, accept: init.headers?.accept });
    for (const [match, respond] of routes) {
      if (typeof match === 'string' ? url.includes(match) : match.test(url)) return respond({ url, method, body });
    }
    return Response.json({});
  };
  return calls;
}
