import { appJwt, b64url, github, installationToken } from './github.js';
import { alert, sendTelegram } from './alerts.js';
import { consumeLinkCode, createLinkCode, LINK_TTL_SECONDS, readSettings, settingsEnabled, writeSettings } from './store.js';

const encoder = new TextEncoder();
const SESSION_COOKIE = 'ff_session';
const STATE_COOKIE = 'ff_oauth_state';
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_TELEGRAM_CHATS = 10;
const MAX_VERIFIED_REPOS = 3000;
const DISCORD_WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
const LINK_MESSAGE = /^(?:\/start(?:@\w+)?\s+)?([\w-]{24})$/;
const SETTINGS_PATH = /^\/settings\/([1-9]\d*)(\/telegram|\/telegram\/remove|\/test)?$/;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const now = () => Math.floor(Date.now() / 1000);

function readCookies(request) {
  const pairs = (request.headers.get('cookie') || '').split(/;\s*/).filter(Boolean);
  return Object.fromEntries(pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
}

const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function hmacKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signValue(env, data) {
  const payload = b64url(encoder.encode(JSON.stringify(data)));
  return `${payload}.${b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload)))}`;
}

export async function readSigned(env, value) {
  const [payload, mac] = (value || '').split('.');
  if (!payload || !mac) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(mac), encoder.encode(payload)))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return data.exp > now() ? data : null;
  } catch {
    return null;
  }
}

function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SECURITY_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status: 303, headers });
}

function page(title, content, status = 200, cookies = []) {
  const headers = new Headers(SECURITY_HEADERS);
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Force Fence</title>
<style>
:root{--bg:#f6f4fb;--card:#fff;--text:#1d1a2b;--muted:#5d5873;--line:#ddd8ea;--accent:#5b3fd1;--accent-text:#fff;--ok:#1d7a4a;--bad:#b42336}
@media (prefers-color-scheme:dark){:root{--bg:#14121d;--card:#1e1b2b;--text:#ece9f6;--muted:#a9a3c2;--line:#332e48;--accent:#9d86ff;--accent-text:#14121d;--ok:#5fd39a;--bad:#ff7d8f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px 64px}
header{display:flex;align-items:center;gap:12px;margin-bottom:24px}header svg{flex:none}
h1{font-size:1.5rem;margin:0}h2{font-size:1.1rem;margin:0 0 8px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
p{margin:0 0 12px}.muted{color:var(--muted);font-size:.95rem}
label{display:block;font-weight:600;margin-bottom:4px}
input[type=text],input[type=url]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
button,.button{display:inline-block;padding:10px 16px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-text);font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
ul{padding-left:20px;margin:0 0 12px}li{margin-bottom:6px}
.ok{color:var(--ok)}.bad{color:var(--bad)}.check{display:flex;gap:8px;align-items:center;font-weight:400}
code{font-size:.9em;overflow-wrap:anywhere}
</style>
</head>
<body><main>
<header><svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><path d="M18 2 4 8v9c0 8.5 6 14.6 14 17 8-2.4 14-8.5 14-17V8z" fill="currentColor" opacity=".15"/><path d="M11 25V13m7 12V10m7 15V13M9 17h18M9 21h18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><h1>${esc(title)}</h1></header>
${content}
</main></body></html>`, { status, headers });
}

const notEnabled = () => page('Settings unavailable', '<section><p>The settings page is not enabled on this deployment.</p></section>', 404);

function startSignIn(request, env, installationId) {
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', `${new URL(request.url).origin}/auth/callback`);
  authorize.searchParams.set('state', state);
  return signValue(env, { state, installationId, exp: now() + 600 }).then((value) => redirect(authorize.toString(), [cookie(STATE_COOKIE, value, 600)]));
}

export async function managementCheck(env, installationId, userToken) {
  const installation = await github(`/app/installations/${installationId}`, await appJwt(env));
  const covered = (await github('/installation/repositories?per_page=1', await installationToken(env, installationId))).total_count;
  if (covered > MAX_VERIFIED_REPOS) return { account: installation.account.login, allowed: false, reason: 'too-many' };
  let seen = 0;
  for (let pageNumber = 1; seen < covered; pageNumber++) {
    const { repositories, total_count: visible } = await github(`/user/installations/${installationId}/repositories?per_page=100&page=${pageNumber}`, userToken);
    if (visible !== covered || !repositories.length || !repositories.every((repo) => repo.permissions?.admin)) {
      return { account: installation.account.login, allowed: false };
    }
    seen += repositories.length;
  }
  return { account: installation.account.login, allowed: covered > 0 };
}

async function coveredByInstallation(token, fullName) {
  for (let pageNumber = 1; pageNumber <= MAX_VERIFIED_REPOS / 100; pageNumber++) {
    const { repositories } = await github(`/installation/repositories?per_page=100&page=${pageNumber}`, token);
    if (repositories.some((repo) => repo.full_name.toLowerCase() === fullName.toLowerCase())) return true;
    if (repositories.length < 100) return false;
  }
  return false;
}

export async function finishSignIn(request, env) {
  const url = new URL(request.url);
  const saved = await readSigned(env, readCookies(request)[STATE_COOKIE]);
  if (!saved || !sameString(saved.state, url.searchParams.get('state'))) {
    return page('Sign-in expired', '<section><p>Your sign-in took too long or was started elsewhere. Go back to GitHub and open the settings again.</p></section>', 400);
  }
  const exchange = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'force-fence' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: url.searchParams.get('code'),
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  const userToken = (await exchange.json().catch(() => ({}))).access_token;
  if (!userToken) return page('Sign-in failed', '<section><p>GitHub did not confirm the sign-in. Try again.</p></section>', 400);

  const user = await github('/user', userToken);
  const session = (await readSigned(env, readCookies(request)[SESSION_COOKIE])) ?? {};
  const installs = session.login === user.login ? { ...session.installs } : {};
  const clearState = cookie(STATE_COOKIE, '', 0);

  if (!saved.installationId) {
    const { installations } = await github('/user/installations?per_page=100', userToken);
    const items = installations.map((i) => `<li><a href="/setup?installation_id=${esc(i.id)}">${esc(i.account.login)}</a></li>`).join('');
    return page('Choose an installation', `<section><p>Signed in as <strong>${esc(user.login)}</strong>.</p>${items ? `<ul>${items}</ul>` : '<p>Force Fence is not installed on any account you can access.</p>'}</section>`, 200, [clearState]);
  }

  const check = await managementCheck(env, saved.installationId, userToken).catch((err) => {
    console.error('management check failed', err.message);
    return { allowed: false };
  });
  if (!check.allowed) {
    const why = check.reason === 'too-many'
      ? `This installation covers more than ${MAX_VERIFIED_REPOS} repositories, which is more than the settings page can verify. Install Force Fence on fewer repositories or self-host it.`
      : 'Only the account owner, an organization owner, or someone with admin access to every repository this installation covers can change its settings.';
    return page('Not allowed', `<section><p>${esc(why)}</p><p class="muted">Signed in as ${esc(user.login)}.</p></section>`, 403, [clearState]);
  }
  installs[saved.installationId] = check.account;
  const value = await signValue(env, { login: user.login, installs, exp: now() + SESSION_SECONDS });
  return redirect(`/settings/${saved.installationId}`, [clearState, cookie(SESSION_COOKIE, value, SESSION_SECONDS)]);
}

function settingsView(id, account, settings, notice = '') {
  const chats = settings.telegramChats ?? [];
  const chatItems = chats.map((chat) => `<li>${esc(chat.title)} <span class="muted">(${esc(chat.type)})</span>
<form method="post" action="/settings/${id}/telegram/remove" style="display:inline"><input type="hidden" name="chat" value="${esc(chat.id)}"><button class="secondary" type="submit">Disconnect</button></form></li>`).join('');
  return `${notice}
<p class="muted">Installation for <strong>${esc(account)}</strong>. <a href="/logout">Sign out</a></p>
<form method="post" action="/settings/${id}">
<section>
<h2>Alert repository</h2>
<p class="muted">Issues for blocked force pushes are opened here. Leave empty to open them in the repository that was pushed to. A private repository keeps incidents out of public view.</p>
<label for="alertRepo">Repository (owner/name)</label>
<input id="alertRepo" name="alertRepo" type="text" value="${esc(settings.alertRepo)}" placeholder="${esc(account)}/security-alerts" autocomplete="off">
</section>
<section>
<h2>Discord</h2>
<p class="muted">${settings.discordWebhookUrl ? '<span class="ok">Connected.</span> Paste a new URL to replace it.' : 'Paste a channel webhook URL (Channel settings → Integrations → Webhooks).'}</p>
<label for="discord">Webhook URL</label>
<input id="discord" name="discordWebhookUrl" type="url" placeholder="https://discord.com/api/webhooks/…" autocomplete="off">
${settings.discordWebhookUrl ? '<label class="check"><input type="checkbox" name="removeDiscord" value="1"> Remove the Discord webhook</label>' : ''}
</section>
<div class="row"><button type="submit">Save</button></div>
</form>
<section>
<h2>Telegram</h2>
${chatItems ? `<ul>${chatItems}</ul>` : '<p class="muted">No chats connected.</p>'}
<form method="post" action="/settings/${id}/telegram"><button type="submit"${chats.length >= MAX_TELEGRAM_CHATS ? ' disabled' : ''}>Connect a Telegram chat</button></form>
</section>
<section>
<h2>Test</h2>
<p class="muted">Sends a test alert to every place configured above.</p>
<form method="post" action="/settings/${id}/test"><button class="secondary" type="submit">Send test alert</button></form>
</section>`;
}

async function saveSettings(request, env, id, account) {
  const form = await request.formData();
  const settings = await readSettings(env, id);
  const alertRepo = String(form.get('alertRepo') || '').trim();
  const discord = String(form.get('discordWebhookUrl') || '').trim();
  const errors = [];

  if (alertRepo && !REPO_NAME.test(alertRepo)) errors.push('The alert repository must look like owner/name.');
  else if (alertRepo && alertRepo !== settings.alertRepo) {
    try {
      const token = await installationToken(env, id);
      const repo = await github(`/repos/${alertRepo}`, token);
      if (repo.owner.login.toLowerCase() !== account.toLowerCase()) errors.push(`The alert repository must belong to ${account}.`);
      else if (!repo.has_issues) errors.push(`${alertRepo} has issues turned off.`);
      else if (!repo.private && !(await coveredByInstallation(token, repo.full_name))) errors.push(`Add ${alertRepo} to this installation first.`);
    } catch {
      errors.push(`Force Fence cannot reach ${alertRepo}. Add it to this installation first.`);
    }
  }
  if (discord && !DISCORD_WEBHOOK.test(discord)) errors.push('The Discord URL must be a webhook URL that starts with https://discord.com/api/webhooks/.');

  if (errors.length) {
    const notice = `<section role="alert"><ul class="bad">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></section>`;
    return page('Alert settings', settingsView(id, account, { ...settings, alertRepo }, notice), 400);
  }
  const discordWebhookUrl = form.get('removeDiscord') ? undefined : discord || settings.discordWebhookUrl;
  await writeSettings(env, id, { ...settings, alertRepo, discordWebhookUrl });
  return redirect(`/settings/${id}?saved=1`);
}

async function connectTelegram(env, id, account) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME) {
    return page('Telegram', '<section><p>Telegram is not set up on this deployment.</p></section>', 404);
  }
  const code = await createLinkCode(env, id, account);
  if (!code) {
    return page('Connect Telegram', `<section><p>Too many unused codes are open for this installation. Use one, or wait ${LINK_TTL_SECONDS / 60} minutes.</p></section><p><a href="/settings/${id}">Back to settings</a></p>`, 429);
  }
  const bot = encodeURIComponent(env.TELEGRAM_BOT_USERNAME);
  return page('Connect Telegram', `<section>
<p>Pick where Force Fence should post alerts for <strong>${esc(account)}</strong>. This code works once and expires in ${LINK_TTL_SECONDS / 60} minutes.</p>
<div class="row"><a class="button" href="https://t.me/${bot}?startgroup=${code}">Add to a group</a><a class="button" href="https://t.me/${bot}?start=${code}">Direct message</a></div>
</section>
<section>
<h2>Channel</h2>
<p class="muted">Add @${esc(env.TELEGRAM_BOT_USERNAME)} to the channel as an admin who can post messages, then post this code in the channel:</p>
<p><code>${code}</code></p>
</section>
<p><a href="/settings/${id}">Back to settings</a></p>`);
}

async function removeTelegram(request, env, id) {
  const chatId = String((await request.formData()).get('chat'));
  const settings = await readSettings(env, id);
  await writeSettings(env, id, { ...settings, telegramChats: (settings.telegramChats ?? []).filter((chat) => String(chat.id) !== chatId) });
  return redirect(`/settings/${id}`);
}

async function testAlert(env, id, account) {
  let token = null;
  try {
    token = await installationToken(env, id);
  } catch (err) {
    console.error(err);
  }
  const settings = await readSettings(env, id);
  const results = await alert(env, { installationId: id, token }, 'Force Fence test alert', `This is a test alert for **${account}**. No branch was changed.`);
  const items = results.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">${esc(r.channel)}: ${r.ok ? 'sent' : esc(r.error)}</li>`).join('');
  const note = settings.alertRepo ? '' : '<p class="muted">No alert repository is set, so the test does not open an issue. Real alerts open one in the repository that was pushed to.</p>';
  return page('Test alert', `<section>${items ? `<ul>${items}</ul>` : '<p>Nothing is configured yet.</p>'}${note}</section><p><a href="/settings/${id}">Back to settings</a></p>`);
}

export async function telegramUpdate(request, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || !sameString(request.headers.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await request.json().catch(() => ({}));
  const message = update.message ?? update.channel_post;
  const code = message?.text?.trim().match(LINK_MESSAGE)?.[1];
  if (!code || !settingsEnabled(env)) return new Response('ok');

  const chat = message.chat;
  const reply = (text) => sendTelegram(env, chat.id, text).catch((err) => console.error('telegram reply failed', err.message));
  try {
    const link = await consumeLinkCode(env, code);
    if (!link) {
      await reply('This Force Fence code has expired or was already used. Open the settings page and connect Telegram again.');
      return new Response('ok');
    }
    const settings = await readSettings(env, link.installationId);
    const others = (settings.telegramChats ?? []).filter((c) => c.id !== chat.id);
    if (others.length >= MAX_TELEGRAM_CHATS) {
      await reply(`This installation already has ${MAX_TELEGRAM_CHATS} Telegram chats. Disconnect one first.`);
      return new Response('ok');
    }
    const title = chat.title || (chat.username ? `@${chat.username}` : chat.first_name) || 'Telegram chat';
    await writeSettings(env, link.installationId, { ...settings, telegramChats: [...others, { id: chat.id, title, type: chat.type }] });
    await reply(`Connected. Force Fence alerts for ${link.account} will be posted here.`);
  } catch (err) {
    console.error('telegram link failed', err);
    await reply('Force Fence could not link this chat. Open the settings page and try again with a new code.');
  }
  return new Response('ok');
}

export async function handleSettings(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === '/telegram' && request.method === 'POST') return telegramUpdate(request, env);
  if (!['/setup', '/settings', '/auth/callback', '/logout'].includes(pathname) && !SETTINGS_PATH.test(pathname)) return null;
  if (!settingsEnabled(env) || !env.GITHUB_CLIENT_ID || !env.SESSION_SECRET) return notEnabled();

  if (pathname === '/logout') return redirect('/settings', [cookie(SESSION_COOKIE, '', 0)]);
  if (pathname === '/auth/callback') return finishSignIn(request, env);

  const session = await readSigned(env, readCookies(request)[SESSION_COOKIE]);
  if (pathname === '/setup' || pathname === '/settings') {
    const requested = url.searchParams.get('installation_id');
    if (requested && !/^[1-9]\d*$/.test(requested)) return page('Not found', '<section><p>Unknown installation.</p></section>', 404);
    if (requested && session?.installs?.[requested]) return redirect(`/settings/${requested}`);
    return startSignIn(request, env, requested);
  }

  const [, id, action] = pathname.match(SETTINGS_PATH);
  const account = session?.installs?.[id];
  if (!account) return request.method === 'GET' ? startSignIn(request, env, id) : page('Signed out', '<section><p>Your session ended. <a href="/settings">Sign in again</a>.</p></section>', 401);

  if (request.method === 'GET' && !action) {
    const notice = url.searchParams.get('saved') ? '<section role="status"><p class="ok">Saved.</p></section>' : '';
    return page('Alert settings', settingsView(id, account, await readSettings(env, id), notice));
  }
  if (request.method !== 'POST') return page('Not found', '', 404);
  if (request.headers.get('origin') !== url.origin) return page('Blocked', '<section><p>This request came from another site.</p></section>', 403);
  if (!action) return saveSettings(request, env, id, account);
  if (action === '/telegram') return connectTelegram(env, id, account);
  if (action === '/telegram/remove') return removeTelegram(request, env, id);
  return testAlert(env, id, account);
}
