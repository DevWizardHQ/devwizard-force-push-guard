import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { readSigned, signValue } from '../src/settings.js';
import { readSettings, writeSettings } from '../src/store.js';
import { makeEnv, mockFetch } from './helpers.js';

const ORIGIN = 'https://ff.test';
const DISCORD = 'https://discord.com/api/webhooks/123/secret-token';

async function call(env, path, { method = 'GET', cookie, form, origin = ORIGIN, json, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.cookie = cookie;
  if (method === 'POST') init.headers.origin = origin;
  if (form) init.body = new URLSearchParams(form);
  if (json) {
    init.body = JSON.stringify(json);
    init.headers['content-type'] = 'application/json';
  }
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, { waitUntil() {} });
}

async function sessionCookie(env, installs = { 42: 'acme' }) {
  return `ff_session=${await signValue(env, { login: 'alice', installs, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
}

function githubUser({ admin = true, visible = 2 } = {}) {
  const userRepos = [{ permissions: { admin: true } }, { permissions: { admin } }].slice(0, visible);
  return mockFetch([
    ['/login/oauth/access_token', () => Response.json({ access_token: 'user-token' })],
    [/api\.github\.com\/user$/, () => Response.json({ login: 'alice' })],
    [/\/user\/installations\?/, () => Response.json({ installations: [{ id: 42, account: { login: 'acme' } }] })],
    ['/user/installations/42/repositories', () => Response.json({ total_count: visible, repositories: userRepos })],
    [/\/app\/installations\/42$/, () => Response.json({ account: { login: 'acme' } })],
    ['/access_tokens', () => Response.json({ token: 'inst-token' })],
    ['/installation/repositories', () => Response.json({ total_count: 2, repositories: [{ full_name: 'acme/app' }, { full_name: 'acme/alerts' }] })],
    [/\/repos\/acme\/alerts$/, () => Response.json({ full_name: 'acme/alerts', private: false, has_issues: true, owner: { login: 'acme' } })],
    [/\/repos\/acme\/elsewhere$/, () => Response.json({ full_name: 'acme/elsewhere', private: false, has_issues: true, owner: { login: 'acme' } })],
    [/\/repos\/other\/alerts$/, () => Response.json({ full_name: 'other/alerts', private: false, has_issues: true, owner: { login: 'other' } })],
    [/\/repos\/acme\/missing$/, () => new Response('', { status: 404 })],
  ]);
}

test('signed values round-trip and reject tampering or expiry', async () => {
  const env = await makeEnv();
  const value = await signValue(env, { a: 1, exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal((await readSigned(env, value)).a, 1);
  assert.equal(await readSigned(env, value.replace(/^./, (c) => (c === 'e' ? 'f' : 'e'))), null);
  assert.equal(await readSigned(env, await signValue(env, { exp: 1 })), null);
  assert.equal(await readSigned(await makeEnv({ SESSION_SECRET: 'other' }), value), null);
});

test('settings are encrypted at rest and bound to their installation', async () => {
  const env = await makeEnv();
  await writeSettings(env, 42, { discordWebhookUrl: DISCORD });
  const stored = env.DB.db.prepare('SELECT data FROM settings WHERE installation_id = 42').get().data;
  assert.equal(stored.includes('secret-token'), false);
  assert.deepEqual(await readSettings(env, 42), { discordWebhookUrl: DISCORD });
  env.DB.db.prepare('INSERT INTO settings VALUES (99, ?, 0)').run(stored);
  await assert.rejects(readSettings(env, 99));
  await writeSettings(env, 42, { discordWebhookUrl: undefined, telegramChats: [] });
  assert.equal(env.DB.db.prepare('SELECT COUNT(*) AS n FROM settings WHERE installation_id = 42').get().n, 0);
});

test('settings pages are off without the database binding', async () => {
  const res = await call(await makeEnv({ DB: undefined }), '/setup?installation_id=42');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /not enabled/);
});

test('setup without a session starts GitHub sign-in with a signed state', async () => {
  const res = await call(await makeEnv(), '/setup?installation_id=42&setup_action=install');
  assert.equal(res.status, 303);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin + location.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), 'Iv1.client');
  assert.equal(location.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`);
  assert.match(res.headers.get('set-cookie'), /^ff_oauth_state=.+HttpOnly; Secure; SameSite=Lax/);
});

async function signInFlow(env) {
  const start = await call(env, '/setup?installation_id=42');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const stateCookie = start.headers.get('set-cookie').split(';')[0];
  return call(env, `/auth/callback?code=abc&state=${state}`, { cookie: stateCookie });
}

test('sign-in grants an installation only to admins of every covered repository', async () => {
  const env = await makeEnv();
  githubUser();
  const ok = await signInFlow(env);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/settings/42');
  const session = await readSigned(env, ok.headers.getSetCookie().find((c) => c.startsWith('ff_session=')).split(';')[0].slice(11));
  assert.deepEqual(session.installs, { 42: 'acme' });

  githubUser({ admin: false });
  assert.equal((await signInFlow(env)).status, 403);

  githubUser({ visible: 1 });
  const partial = await signInFlow(env);
  assert.equal(partial.status, 403);
  assert.match(await partial.text(), /admin access to every repository/);
});

test('callback with a forged state is refused', async () => {
  const env = await makeEnv();
  githubUser();
  const res = await call(env, '/auth/callback?code=abc&state=forged', { cookie: `ff_oauth_state=${await signValue(env, { state: 'real', exp: 9e9 })}` });
  assert.equal(res.status, 400);
});

test('padded installation ids are not routed', async () => {
  const env = await makeEnv();
  assert.equal((await call(env, '/settings/042', { cookie: await sessionCookie(env, { '042': 'acme' }) })).status, 404);
  assert.equal((await call(env, '/setup?installation_id=042')).status, 404);
});

test('a session for one installation cannot open another', async () => {
  const env = await makeEnv();
  const res = await call(env, '/settings/43', { cookie: await sessionCookie(env) });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^https:\/\/github\.com\/login\/oauth\/authorize/);
});

test('saving validates input, checks the alert repo and never echoes the Discord URL', async () => {
  const env = await makeEnv();
  const cookie = await sessionCookie(env);
  githubUser();

  const bad = await call(env, '/settings/42', { method: 'POST', cookie, form: { alertRepo: 'acme/missing', discordWebhookUrl: 'https://evil.test/hook' } });
  assert.equal(bad.status, 400);
  const badText = await bad.text();
  assert.match(badText, /cannot reach acme\/missing/);
  assert.match(badText, /must be a webhook URL/);
  assert.match(await (await call(env, '/settings/42', { method: 'POST', cookie, form: { alertRepo: 'other/alerts' } })).text(), /must belong to acme/);
  assert.match(await (await call(env, '/settings/42', { method: 'POST', cookie, form: { alertRepo: 'acme/elsewhere' } })).text(), /Add acme\/elsewhere to this installation first/);

  const good = await call(env, '/settings/42', { method: 'POST', cookie, form: { alertRepo: 'acme/alerts', discordWebhookUrl: DISCORD } });
  assert.equal(good.status, 303);
  assert.deepEqual(await readSettings(env, 42), { alertRepo: 'acme/alerts', discordWebhookUrl: DISCORD });

  const view = await (await call(env, '/settings/42?saved=1', { cookie })).text();
  assert.match(view, /Saved\./);
  assert.match(view, /value="acme\/alerts"/);
  assert.equal(view.includes('secret-token'), false);

  await call(env, '/settings/42', { method: 'POST', cookie, form: { alertRepo: 'acme/alerts', removeDiscord: '1' } });
  assert.deepEqual(await readSettings(env, 42), { alertRepo: 'acme/alerts' });
});

test('POSTs from another origin or without a session are refused', async () => {
  const env = await makeEnv();
  const cookie = await sessionCookie(env);
  assert.equal((await call(env, '/settings/42', { method: 'POST', cookie, origin: 'https://evil.test', form: {} })).status, 403);
  assert.equal((await call(env, '/settings/42', { method: 'POST', form: {} })).status, 401);
  assert.equal((await call(env, '/settings/42', { method: 'POST', cookie, origin: 'null', form: {}, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('browsers that send Origin: null on same-site forms are accepted via Sec-Fetch-Site', async () => {
  const env = await makeEnv();
  const cookie = await sessionCookie(env);
  mockFetch([]);
  const res = await call(env, '/settings/42/telegram', { method: 'POST', cookie, origin: 'null', headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('referrer-policy'), 'same-origin');
});

test('Telegram linking: group, channel, reused code and wrong secret', async () => {
  const env = await makeEnv();
  const cookie = await sessionCookie(env);
  const calls = mockFetch([]);

  const connect = await (await call(env, '/settings/42/telegram', { method: 'POST', cookie })).text();
  const code = connect.match(/startgroup=([\w-]{24})/)[1];
  assert.match(connect, new RegExp(`https://t.me/ForceFenceBot\\?start=${code}`));

  const secret = { 'x-telegram-bot-api-secret-token': 'tg-secret' };
  assert.equal((await call(env, '/telegram', { method: 'POST', json: {}, headers: { 'x-telegram-bot-api-secret-token': 'nope' } })).status, 403);

  await call(env, '/telegram', { method: 'POST', headers: secret, json: { message: { text: `/start@ForceFenceBot ${code}`, chat: { id: -1001, title: 'Ops', type: 'supergroup' } } } });
  assert.deepEqual((await readSettings(env, 42)).telegramChats, [{ id: -1001, title: 'Ops', type: 'supergroup' }]);
  assert.match(calls.at(-1).body.text, /Connected\. Force Fence alerts for acme/);

  await call(env, '/telegram', { method: 'POST', headers: secret, json: { message: { text: `/start ${code}`, chat: { id: 7, first_name: 'Eve', type: 'private' } } } });
  assert.equal((await readSettings(env, 42)).telegramChats.length, 1);
  assert.match(calls.at(-1).body.text, /expired or was already used/);

  const second = (await (await call(env, '/settings/42/telegram', { method: 'POST', cookie })).text()).match(/startgroup=([\w-]{24})/)[1];
  await call(env, '/telegram', { method: 'POST', headers: secret, json: { channel_post: { text: second, chat: { id: -1002, title: 'Alerts', type: 'channel' } } } });
  assert.deepEqual((await readSettings(env, 42)).telegramChats.map((c) => c.type), ['supergroup', 'channel']);

  await call(env, '/settings/42/telegram/remove', { method: 'POST', cookie, form: { chat: '-1001' } });
  assert.deepEqual((await readSettings(env, 42)).telegramChats.map((c) => c.id), [-1002]);
});

test('open Telegram codes per installation are capped', async () => {
  const env = await makeEnv();
  const cookie = await sessionCookie(env);
  mockFetch([]);
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call(env, '/settings/42/telegram', { method: 'POST', cookie })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test('test alert reports each channel', async () => {
  const env = await makeEnv();
  const cookie = await sessionCookie(env);
  await writeSettings(env, 42, { discordWebhookUrl: DISCORD, telegramChats: [{ id: 5, title: 'Ops', type: 'group' }] });
  mockFetch([
    ['/access_tokens', () => Response.json({ token: 'inst-token' })],
    ['discord.com', () => new Response('', { status: 404 })],
  ]);
  const text = await (await call(env, '/settings/42/test', { method: 'POST', cookie })).text();
  assert.match(text, /Discord: POST to discord\.com failed: 404/);
  assert.match(text, /Telegram \(Ops\): sent/);
});
