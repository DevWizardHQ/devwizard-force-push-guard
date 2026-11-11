import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { decide, globMatch, isRewrite, parseConfig, touchesConfig, verifySignature } from '../src/index.js';
import { readSettings, writeSettings } from '../src/store.js';
import { AFTER, BEFORE, makeEnv, mockFetch } from './helpers.js';

const push = (over = {}) => ({
  ref: 'refs/heads/main', before: BEFORE, after: AFTER, forced: true, deleted: false,
  sender: { login: 'octocat', type: 'User' }, pusher: { name: 'octocat' },
  repository: { full_name: 'acme/app', default_branch: 'main' }, installation: { id: 42 }, ...over,
});

test('globMatch: * stays inside one path segment, ** crosses segments, the rest is literal', () => {
  const cases = [
    ['main', 'main', true],
    ['main', 'main2', false],
    ['release/*', 'release/1.2', true],
    ['release/*', 'release/1.2/hotfix', false],
    ['release/**', 'release/1.2/hotfix', true],
    ['*-stable', 'v2-stable', true],
    ['feat.x', 'featyx', false],
    ['**', 'any/branch/at/all', true],
    ['Main', 'main', false],
  ];
  for (const [glob, branch, expected] of cases) assert.equal(globMatch(glob, branch), expected, `${glob} vs ${branch}`);
});

test('globMatch stays fast on hostile patterns', () => {
  const started = performance.now();
  assert.equal(globMatch('**a**a**a**a**a**a**a**a**a**a**b', 'a'.repeat(250)), false);
  assert.ok(performance.now() - started < 200);
});

test('touchesConfig: only default-branch pushes that change the config file', () => {
  const commits = [{ added: [], modified: ['.github/force-fence.yml'], removed: [] }];
  assert.equal(touchesConfig('push', push({ forced: false, commits })), true);
  assert.equal(touchesConfig('push', push({ forced: false, ref: 'refs/heads/feature', commits })), false);
  assert.equal(touchesConfig('push', push({ forced: false, commits: [{ added: ['README.md'] }] })), false);
});

test('parseConfig: lists, single strings, empty files and opt-out', () => {
  assert.deepEqual(parseConfig('branches: [main, "release/*"]\nallowed_pushers: [bot]'), { branches: ['main', 'release/*'], allowedPushers: ['bot'] });
  assert.deepEqual(parseConfig('branches: main'), { branches: ['main'], allowedPushers: [] });
  assert.deepEqual(parseConfig(''), { branches: undefined, allowedPushers: [] });
  assert.deepEqual(parseConfig('branches: []'), { branches: [], allowedPushers: [] });
  assert.throws(() => parseConfig('branches: [main'));
});

test('isRewrite: only forced or deleting pushes to branches', () => {
  assert.equal(isRewrite('push', push()), true);
  assert.equal(isRewrite('push', push({ forced: false, deleted: true })), true);
  assert.equal(isRewrite('push', push({ forced: false })), false);
  assert.equal(isRewrite('push', push({ ref: 'refs/tags/v1' })), false);
  assert.equal(isRewrite('create', push()), false);
});

test('decide: default branch without config, globs, allow list, opt-out and deletes', () => {
  assert.deepEqual(decide(push(), {}), { action: 'reset', sha: BEFORE, expect: AFTER });
  assert.equal(decide(push({ ref: 'refs/heads/develop' }), {}), null);
  assert.deepEqual(decide(push({ ref: 'refs/heads/release/2.0' }), { branches: ['release/*'] }), { action: 'reset', sha: BEFORE, expect: AFTER });
  assert.equal(decide(push(), { branches: ['main'], allowedPushers: ['octocat'] }), null);
  assert.equal(decide(push(), { branches: [] }), null);
  assert.deepEqual(decide(push({ deleted: true, forced: false }), {}), { action: 'recreate', sha: BEFORE });
});

async function sign(body, secret = 'test-secret') {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('verifySignature accepts the right secret and rejects others', async () => {
  const body = '{"x":1}';
  assert.equal(await verifySignature('test-secret', body, await sign(body)), true);
  assert.equal(await verifySignature('test-secret', body, await sign(body, 'wrong')), false);
  assert.equal(await verifySignature('test-secret', body, null), false);
});

async function run(payload, { files = {}, currentSha = AFTER, event = 'push', badSig = false, settings, env: extra, environment } = {}) {
  const env = environment ?? (await makeEnv(extra));
  if (settings) await writeSettings(env, 42, settings);
  const calls = mockFetch([
    ['/access_tokens', () => Response.json({ token: 'inst-token' })],
    [/api\.github\.com\/app$/, () => Response.json({ slug: 'force-fence' })],
    [/\/contents\/\.github\/force-fence\.yml(\?ref=\w+)?$/, ({ url }) => {
      const [, repo, ref] = url.match(/\/repos\/([^/]+\/[^/]+)\/contents\/[^?]+(?:\?ref=(\w+))?$/);
      const file = (ref && files[`${repo}@${ref}`]) ?? files[repo];
      if (file === undefined) return new Response('', { status: 404 });
      return typeof file === 'number' ? new Response('', { status: file }) : new Response(file);
    }],
    ['/git/ref/', () => (currentSha ? Response.json({ object: { sha: currentSha } }) : new Response('{}', { status: 404 }))],
  ]);
  const waits = [];
  const body = JSON.stringify(payload);
  const req = new Request('https://w.test/', {
    method: 'POST', body,
    headers: { 'x-github-event': event, 'x-hub-signature-256': badSig ? 'sha256=' + '0'.repeat(64) : await sign(body) },
  });
  const res = await worker.fetch(req, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { res, text: await res.text(), calls, env };
}

const issueCalls = (calls) => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/issues'));

test('force push to the default branch is reverted and an issue opens in the same repo', async () => {
  const { text, calls } = await run(push());
  assert.match(text, /^Reverted `heads\/main`/);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, 'https://api.github.com/repos/acme/app/git/refs/heads/main');
  assert.deepEqual(patch.body, { sha: BEFORE, force: true });
  assert.equal(patch.auth, 'Bearer inst-token');
  assert.equal(issueCalls(calls)[0].url, 'https://api.github.com/repos/acme/app/issues');
  assert.match(issueCalls(calls)[0].body.title, /^Force push reverted: acme\/app main by octocat/);
  assert.equal(calls.some((c) => c.url.includes('discord') || c.url.includes('telegram')), false);
  const jwt = calls.find((c) => c.url.endsWith('/access_tokens')).auth.split(' ')[1];
  assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).iss, '1');
});

test('the owner .github repo config applies when the repo has none', async () => {
  const { text, calls } = await run(push({ ref: 'refs/heads/release/2.0' }), { files: { 'acme/.github': 'branches: [main, "release/*"]' } });
  assert.match(text, /^Reverted `heads\/release\/2.0`/);
  const configReads = calls.filter((c) => c.url.includes('/contents/'));
  assert.deepEqual(configReads.map((c) => c.url.split('/repos/')[1].split('/contents')[0]), ['acme/app', 'acme/.github']);
  assert.equal(configReads[0].accept, 'application/vnd.github.raw+json');
});

test('a repo config replaces the org config', async () => {
  const { text, calls } = await run(push({ ref: 'refs/heads/develop' }), {
    files: { 'acme/app': 'branches: [main]', 'acme/.github': 'branches: [main, develop]' },
  });
  assert.equal(text, 'ignored');
  assert.equal(calls.some((c) => c.url.includes('acme/.github')), false);
});

test('allowed_pushers may force-push', async () => {
  const { text } = await run(push(), { files: { 'acme/app': 'allowed_pushers: [octocat]' } });
  assert.equal(text, 'ignored');
});

test('broken or unreadable config falls back to the default branch only', async () => {
  assert.match((await run(push(), { files: { 'acme/app': 'branches: [main' } })).text, /^Reverted/);
  assert.equal((await run(push({ ref: 'refs/heads/develop' }), { files: { 'acme/app': 500 } })).text, 'ignored');
});

test('saved settings route the issue and send Discord and every Telegram chat', async () => {
  const { calls } = await run(push(), {
    settings: {
      alertRepo: 'acme/security-alerts',
      discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
      telegramChats: [{ id: -100123, title: 'Ops', type: 'supergroup' }, { id: 555, title: '@alice', type: 'private' }],
    },
  });
  assert.equal(issueCalls(calls)[0].url, 'https://api.github.com/repos/acme/security-alerts/issues');
  assert.ok(calls.find((c) => c.url === 'https://discord.com/api/webhooks/1/abc'));
  const telegram = calls.filter((c) => c.url === 'https://api.telegram.org/bot123:abc/sendMessage');
  assert.deepEqual(telegram.map((c) => c.body.chat_id), [-100123, 555]);
  assert.doesNotMatch(telegram[0].body.text, /\*\*|`/);
});

test('our own revert is ignored without asking for a token', async () => {
  const { text, calls } = await run(push({ sender: { login: 'force-fence[bot]', type: 'Bot' } }));
  assert.equal(text, 'ignored');
  assert.equal(calls.some((c) => c.url.endsWith('/access_tokens') || c.method === 'PATCH'), false);
});

test('a different bot force-pushing is reverted', async () => {
  const { text } = await run(push({ sender: { login: 'some-bot[bot]', type: 'Bot' } }));
  assert.match(text, /^Reverted/);
});

test('branch moved again is not overwritten and the alert says NOT reverted', async () => {
  const { text, calls } = await run(push(), { currentSha: 'c'.repeat(40) });
  assert.match(text, /^Not reverted/);
  assert.equal(calls.some((c) => c.method === 'PATCH'), false);
  assert.match(issueCalls(calls)[0].body.title, /NOT reverted/);
});

test('deleted default branch is recreated, unless someone already recreated it', async () => {
  const { text, calls } = await run(push({ deleted: true, forced: false, after: '0'.repeat(40) }), { currentSha: null });
  assert.match(text, /^Recreated/);
  assert.deepEqual(calls.find((c) => c.url.endsWith('/git/refs') && c.method === 'POST').body, { ref: 'refs/heads/main', sha: BEFORE });
  assert.match((await run(push({ deleted: true, forced: false, after: '0'.repeat(40) }))).text, /^Not recreated/);
});

test('a force push cannot switch off its own revert by editing the config', async () => {
  const { text, calls } = await run(push(), { files: { [`acme/app@${BEFORE}`]: 'branches: [main]', 'acme/app': 'branches: []' } });
  assert.match(text, /^Reverted/);
  assert.ok(calls.find((c) => c.url.endsWith(`/contents/.github/force-fence.yml?ref=${BEFORE}`)));
});

test('branch names are escaped in API paths', async () => {
  const { calls } = await run(push({ ref: 'refs/heads/release/1#x' }), { files: { 'acme/app': 'branches: ["release/*"]' } });
  assert.ok(calls.find((c) => c.method === 'PATCH').url.endsWith('/git/refs/heads/release/1%23x'));
  assert.ok(calls.find((c) => c.url.includes('/git/ref/')).url.endsWith('/git/ref/heads/release/1%23x'));
});

test('the brake stops a fight with another bot but never lets people through', async () => {
  const environment = await makeEnv();
  const bot = { login: 'other-guard[bot]', type: 'Bot' };
  const botTexts = [];
  for (let i = 0; i < 4; i++) botTexts.push((await run(push({ sender: bot }), { environment })).text);
  assert.deepEqual(botTexts.map((t) => t.split(' ')[0]), ['Reverted', 'Reverted', 'Reverted', 'Not']);
  assert.match(botTexts[3], /rewritten 3 times in 10 minutes/);

  const people = await makeEnv();
  for (let i = 0; i < 5; i++) assert.match((await run(push(), { environment: people })).text, /^Reverted/);
});

test('the brake and rewrite memory fail open when the database is broken', async () => {
  const broken = { prepare() { throw new Error('no such table'); } };
  assert.match((await run(push({ sender: { login: 'x[bot]', type: 'Bot' } }), { env: { DB: broken } })).text, /^Reverted/);
});

test('two quick force pushes are rolled back to the commit before the first one', async () => {
  const environment = await makeEnv();
  const X1 = '1'.repeat(40);
  const X2 = '2'.repeat(40);
  assert.match((await run(push({ before: BEFORE, after: X1 }), { environment, currentSha: X2 })).text, /^Not reverted/);
  const { text, calls } = await run(push({ before: X1, after: X2 }), { environment, currentSha: X2 });
  assert.match(text, /back to `aaaaaaaa`/);
  assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { sha: BEFORE, force: true });
});

test('rewrite memory survives loops and forgets chains that were already resolved', async () => {
  const O = 'o'.repeat(40);
  const E = 'e'.repeat(40);
  const C = 'c'.repeat(40);
  const loop = await makeEnv();
  await run(push({ before: O, after: E }), { environment: loop, currentSha: C });
  await run(push({ before: E, after: O }), { environment: loop, currentSha: C });
  const looped = await run(push({ before: O, after: C }), { environment: loop, currentSha: C });
  assert.deepEqual(looped.calls.find((c) => c.method === 'PATCH').body, { sha: O, force: true });

  const resolved = await makeEnv();
  await run(push({ before: O, after: E }), { environment: resolved, currentSha: E });
  const later = await run(push({ before: E, after: C }), { environment: resolved, currentSha: C });
  assert.deepEqual(later.calls.find((c) => c.method === 'PATCH').body, { sha: E, force: true });
});

test('a push too large to inspect counts as a possible config change', async () => {
  const commits = Array.from({ length: 2048 }, () => ({ added: [], modified: ['src/a.js'], removed: [] }));
  const { text, calls } = await run(push({ forced: false, commits }));
  assert.equal(text, 'config change alerted');
  assert.match(issueCalls(calls)[0].body.body, /too many commits/);
});

test('a normal push that edits the config on the default branch raises an alert', async () => {
  const commits = [{ added: [], modified: ['.github/force-fence.yml'], removed: [] }];
  const { text, calls } = await run(push({ forced: false, commits, compare: 'https://github.com/acme/app/compare/a...b' }));
  assert.equal(text, 'config change alerted');
  assert.match(issueCalls(calls)[0].body.title, /^Force Fence config changed: acme\/app by octocat/);
  assert.equal(calls.some((c) => c.method === 'PATCH'), false);
});

test('normal pushes cost no GitHub calls and bad signatures are rejected', async () => {
  assert.equal((await run(push({ forced: false }))).calls.length, 0);
  const { res, calls } = await run(push(), { badSig: true });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('uninstall alerts the installation chats, then deletes its settings', async () => {
  const payload = { action: 'deleted', sender: { login: 'octocat' }, installation: { id: 42, account: { login: 'acme' } } };
  const { calls, env } = await run(payload, { event: 'installation', settings: { discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc' } });
  assert.match(calls.find((c) => c.url.startsWith('https://discord.com')).body.content, /uninstalled Force Fence from \*\*acme\*\*/);
  assert.deepEqual(await readSettings(env, 42), {});
});

test('GET / answers a health check', async () => {
  const res = await worker.fetch(new Request('https://w.test/'), await makeEnv(), {});
  assert.equal(await res.text(), 'force-fence is running');
});
