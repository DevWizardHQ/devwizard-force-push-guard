import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { decide, verifySignature } from '../src/index.js';

const env = {
  PROTECTED_REFS: '^refs/heads/(main|master|dev|develop)$',
  APP_BOT_LOGIN: 'devwizard-force-push-guard[bot]',
  ALLOWED_PUSHERS: '',
  ALERT_REPO: 'DevWizardHQ/.github-private',
  WEBHOOK_SECRET: 'test-secret',
  APP_ID: '1',
  DISCORD_GITHUB_GUARD_WEBHOOK_URL: 'https://discord.test/hook',
};
const BEFORE = 'a'.repeat(40);
const AFTER = 'b'.repeat(40);
const push = (over = {}) => ({
  ref: 'refs/heads/main', before: BEFORE, after: AFTER, forced: true, deleted: false,
  sender: { login: 'arifulhoque7' }, pusher: { name: 'arifulhoque7' },
  repository: { full_name: 'DevWizardHQ/WizCampus' }, installation: { id: 42 }, ...over,
});

test('decide: force push to protected branch is reset', () => {
  assert.deepEqual(decide('push', push(), env), { action: 'reset', sha: BEFORE, expect: AFTER });
});
test('decide: ignores feature branches, normal pushes, the bot itself and allow-listed users', () => {
  assert.equal(decide('push', push({ ref: 'refs/heads/feat/x' }), env), null);
  assert.equal(decide('push', push({ forced: false }), env), null);
  assert.equal(decide('push', push({ sender: { login: env.APP_BOT_LOGIN } }), env), null);
  assert.equal(decide('push', push(), { ...env, ALLOWED_PUSHERS: 'x, arifulhoque7' }), null);
});
test('decide: deleting a protected branch recreates it', () => {
  assert.deepEqual(decide('push', push({ deleted: true, forced: false }), env), { action: 'recreate', sha: BEFORE });
});
test('decide: uninstalling the app raises an alert', () => {
  assert.match(decide('installation', { action: 'deleted', sender: { login: 'x' } }, env).alertOnly, /uninstalled/);
});

async function sign(body, secret = env.WEBHOOK_SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}
test('verifySignature accepts the right secret and rejects others', async () => {
  const body = '{"x":1}';
  assert.equal(await verifySignature(env.WEBHOOK_SECRET, body, await sign(body)), true);
  assert.equal(await verifySignature(env.WEBHOOK_SECRET, body, await sign(body, 'wrong')), false);
  assert.equal(await verifySignature(env.WEBHOOK_SECRET, body, null), false);
});

async function pkcs8Pem() {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

async function run(payload, { currentSha = AFTER, event = 'push', badSig = false } = {}) {
  const calls = [];
  const waits = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body && JSON.parse(init.body), auth: init.headers?.authorization });
    if (url.endsWith('/access_tokens')) return Response.json({ token: 'inst-token' });
    if (url.includes('/git/ref/')) return Response.json({ object: { sha: currentSha } });
    return Response.json({});
  };
  const body = JSON.stringify(payload);
  const req = new Request('https://w.test/', { method: 'POST', body, headers: { 'x-github-event': event, 'x-hub-signature-256': badSig ? 'sha256=' + '0'.repeat(64) : await sign(body) } });
  const res = await worker.fetch(req, { ...env, PRIVATE_KEY: await pkcs8Pem() }, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { res, text: await res.text(), calls };
}

test('end to end: force push to main is reverted and alerted to GitHub and Discord', async () => {
  const { text, calls } = await run(push());
  assert.match(text, /^Reverted `heads\/main`/);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, 'https://api.github.com/repos/DevWizardHQ/WizCampus/git/refs/heads/main');
  assert.deepEqual(patch.body, { sha: BEFORE, force: true });
  assert.equal(patch.auth, 'Bearer inst-token');
  assert.ok(calls.find((c) => c.method === 'POST' && c.url.endsWith('/repos/DevWizardHQ/.github-private/issues')).body.title.startsWith('Force push reverted'));
  assert.ok(calls.find((c) => c.url === env.DISCORD_GITHUB_GUARD_WEBHOOK_URL));
  const jwt = calls.find((c) => c.url.endsWith('/access_tokens')).auth.split(' ')[1];
  assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).iss, '1');
});
test('end to end: branch moved again is not overwritten, alert says NOT reverted', async () => {
  const { text, calls } = await run(push(), { currentSha: 'c'.repeat(40) });
  assert.match(text, /^Not reverted/);
  assert.equal(calls.some((c) => c.method === 'PATCH'), false);
  assert.match(calls.find((c) => c.url.endsWith('/issues')).body.title, /NOT reverted/);
});
test('end to end: deleted main is recreated', async () => {
  const { text, calls } = await run(push({ deleted: true, forced: false, after: '0'.repeat(40) }));
  assert.match(text, /^Recreated/);
  assert.deepEqual(calls.find((c) => c.url.endsWith('/git/refs') && c.method === 'POST').body, { ref: 'refs/heads/main', sha: BEFORE });
});
test('end to end: bad signature is rejected before any GitHub call', async () => {
  const { res, calls } = await run(push(), { badSig: true });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});
