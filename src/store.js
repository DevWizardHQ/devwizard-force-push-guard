import { b64url } from './github.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const now = () => Math.floor(Date.now() / 1000);

export const LINK_TTL_SECONDS = 600;
export const MAX_OPEN_LINK_CODES = 5;
export const REVERT_WINDOW_SECONDS = 600;
export const MAX_REVERTS_PER_WINDOW = 3;
const REWRITE_MEMORY_SECONDS = 600;

export const settingsEnabled = (env) => Boolean(env.DB && env.SETTINGS_KEY);

function aesKey(env) {
  return crypto.subtle.importKey('raw', fromBase64(env.SETTINGS_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function readSettings(env, installationId) {
  if (!settingsEnabled(env)) return {};
  const stored = await env.DB.prepare('SELECT data FROM settings WHERE installation_id = ?').bind(Number(installationId)).first('data');
  if (!stored) return {};
  const [iv, data] = stored.split('.').map(fromBase64);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(String(installationId)) },
    await aesKey(env),
    data,
  );
  return JSON.parse(decoder.decode(plain));
}

export async function deleteSettings(env, installationId) {
  if (!settingsEnabled(env)) return;
  await env.DB.prepare('DELETE FROM settings WHERE installation_id = ?').bind(Number(installationId)).run();
  await env.DB.prepare('DELETE FROM link_codes WHERE installation_id = ?').bind(Number(installationId)).run();
}

export async function writeSettings(env, installationId, settings) {
  const kept = Object.fromEntries(Object.entries(settings).filter(([, value]) => (Array.isArray(value) ? value.length : value)));
  if (!Object.keys(kept).length) return deleteSettings(env, installationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(String(installationId)) },
    await aesKey(env),
    encoder.encode(JSON.stringify(kept)),
  );
  await env.DB.prepare(
    'INSERT INTO settings (installation_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (installation_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  ).bind(Number(installationId), `${toBase64(iv)}.${toBase64(data)}`, now()).run();
}

export async function createLinkCode(env, installationId, account) {
  await env.DB.prepare('DELETE FROM link_codes WHERE expires_at <= ?').bind(now()).run();
  const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM link_codes WHERE installation_id = ?').bind(Number(installationId)).first('n');
  if (open >= MAX_OPEN_LINK_CODES) return null;
  const code = b64url(crypto.getRandomValues(new Uint8Array(18)));
  await env.DB.prepare('INSERT INTO link_codes (code, installation_id, account, expires_at) VALUES (?, ?, ?, ?)')
    .bind(code, Number(installationId), account, now() + LINK_TTL_SECONDS).run();
  return code;
}

export async function consumeLinkCode(env, code) {
  const row = await env.DB.prepare('DELETE FROM link_codes WHERE code = ? AND expires_at > ? RETURNING installation_id, account')
    .bind(code, now()).first();
  return row && { installationId: row.installation_id, account: row.account };
}

export async function revertAllowed(env, target) {
  if (!env.DB) return true;
  const since = now() - REVERT_WINDOW_SECONDS;
  await env.DB.prepare('DELETE FROM reverts WHERE at <= ?').bind(since).run();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM reverts WHERE target = ?').bind(target).first('n');
  if (recent >= MAX_REVERTS_PER_WINDOW) return false;
  await env.DB.prepare('INSERT INTO reverts (target, at) VALUES (?, ?)').bind(target, now()).run();
  return true;
}

export async function restoreTarget(env, target, before, after) {
  if (!env.DB) return { sha: before, rows: [] };
  try {
    await env.DB.prepare('DELETE FROM rewrites WHERE at <= ?').bind(now() - REWRITE_MEMORY_SECONDS).run();
    const rows = [];
    let sha = before;
    let cursor = Number.MAX_SAFE_INTEGER;
    for (let hop = 0; hop < 10; hop++) {
      const older = await env.DB.prepare(
        'SELECT rowid AS id, before_sha FROM rewrites WHERE target = ? AND after_sha = ? AND rowid < ? ORDER BY rowid DESC LIMIT 1',
      ).bind(target, sha, cursor).first();
      if (!older) break;
      rows.push(older.id);
      cursor = older.id;
      sha = older.before_sha;
    }
    const id = await env.DB.prepare('INSERT INTO rewrites (target, before_sha, after_sha, at) VALUES (?, ?, ?, ?) RETURNING rowid AS id')
      .bind(target, before, after, now()).first('id');
    return { sha, rows: [...rows, id] };
  } catch (err) {
    console.error('rewrite memory unavailable', err);
    return { sha: before, rows: [] };
  }
}

export async function forgetRewrites(env, rows) {
  if (!env.DB || !rows.length) return;
  await env.DB.prepare(`DELETE FROM rewrites WHERE rowid IN (${rows.map(() => '?').join(', ')})`).bind(...rows).run()
    .catch((err) => console.error('could not clear rewrite memory', err));
}
