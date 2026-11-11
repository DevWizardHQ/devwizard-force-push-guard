import { appJwt, b64url, github, installationToken } from './github.js';
import { alert, sendTelegram } from './alerts.js';
import { chooserView, errorNotice, esc, message, page, resultsView, savedNotice, settingsView, telegramView } from './pages.js';
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

function sameSite(request, url) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === url.origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(null, { status: 303, headers });
}

const notEnabled = () => page('Settings unavailable', message('<p>The settings page is not turned on for this deployment.</p>'), { status: 404 });

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
    return page('Sign-in expired', message('<p>The sign-in took too long or was started in another window.</p><p><a href="/settings">Sign in again</a></p>'), { status: 400 });
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
  if (!userToken) return page('Sign-in failed', message('<p>GitHub did not confirm the sign-in.</p><p><a href="/settings">Try again</a></p>'), { status: 400 });

  const user = await github('/user', userToken);
  const session = (await readSigned(env, readCookies(request)[SESSION_COOKIE])) ?? {};
  const installs = session.login === user.login ? { ...session.installs } : {};
  const clearState = cookie(STATE_COOKIE, '', 0);

  if (!saved.installationId) {
    const { installations } = await github('/user/installations?per_page=100', userToken);
    const manageable = installations.filter((i) => i.account.type === 'Organization' || i.account.login === user.login);
    return page('Choose an account', chooserView(manageable), { lede: `Signed in as <strong>${esc(user.login)}</strong>. Pick the account whose alerts you want to set up.`, cookies: [clearState] });
  }

  const check = await managementCheck(env, saved.installationId, userToken).catch((err) => {
    console.error('management check failed', err.message);
    return { allowed: false };
  });
  if (!check.allowed) {
    const why = check.reason === 'too-many'
      ? `This installation covers more than ${MAX_VERIFIED_REPOS} repositories, which is more than the settings page can verify. Install Force Fence on fewer repositories or self-host it.`
      : 'Only the account owner, an organization owner, or someone with admin access to every repository this installation covers can change its settings.';
    return page('Not allowed', message(`<p>${esc(why)}</p>`), { lede: `Signed in as <strong>${esc(user.login)}</strong>.`, status: 403, cookies: [clearState] });
  }
  installs[saved.installationId] = check.account;
  const value = await signValue(env, { login: user.login, installs, exp: now() + SESSION_SECONDS });
  return redirect(`/settings/${saved.installationId}`, [clearState, cookie(SESSION_COOKIE, value, SESSION_SECONDS)]);
}

function settingsPage(env, id, account, settings, notice = '', status = 200) {
  const body = settingsView({ id, account, settings, bot: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME, maxChats: MAX_TELEGRAM_CHATS, notice });
  return page('Alert settings', body, { lede: `Choose where Force Fence warns <strong>${esc(account)}</strong> when someone rewrites a protected branch.`, status, signedIn: true });
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
    return settingsPage(env, id, account, { ...settings, alertRepo }, errorNotice(errors), 400);
  }
  const discordWebhookUrl = form.get('removeDiscord') ? undefined : discord || settings.discordWebhookUrl;
  await writeSettings(env, id, { ...settings, alertRepo, discordWebhookUrl });
  return redirect(`/settings/${id}?saved=1`);
}

async function connectTelegram(env, id, account) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME) {
    return page('Telegram', message('<p>Telegram is not set up on this deployment.</p>'), { status: 404, signedIn: true });
  }
  const code = await createLinkCode(env, id, account);
  if (!code) {
    return page('Connect Telegram', message(`<p>Too many unused codes are open for this account. Use one of them, or wait ${LINK_TTL_SECONDS / 60} minutes.</p><p><a href="/settings/${id}">Back to settings</a></p>`), { status: 429, signedIn: true });
  }
  return page('Connect Telegram', telegramView({ id, code, bot: env.TELEGRAM_BOT_USERNAME }), {
    lede: `Pick where alerts for <strong>${esc(account)}</strong> should go. The code works once and expires in ${LINK_TTL_SECONDS / 60} minutes. The bot confirms in the chat when it is connected.`,
    signedIn: true,
  });
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
  return page('Test alert', resultsView({ id, results, issueSkipped: !settings.alertRepo }), {
    lede: `Here is what happened to the test alert for <strong>${esc(account)}</strong>.`,
    signedIn: true,
  });
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
    if (requested && !/^[1-9]\d*$/.test(requested)) return page('Not found', message('<p>This installation does not exist.</p>'), { status: 404 });
    if (requested && session?.installs?.[requested]) return redirect(`/settings/${requested}`);
    return startSignIn(request, env, requested);
  }

  const [, id, action] = pathname.match(SETTINGS_PATH);
  const account = session?.installs?.[id];
  if (!account) return request.method === 'GET' ? startSignIn(request, env, id) : page('Signed out', message('<p>Your session ended, so nothing was changed.</p><p><a href="/settings">Sign in again</a></p>'), { status: 401 });

  if (request.method === 'GET' && !action) {
    return settingsPage(env, id, account, await readSettings(env, id), url.searchParams.get('saved') ? savedNotice() : '');
  }
  if (request.method !== 'POST') return page('Not found', message('<p>This page does not exist.</p>'), { status: 404 });
  if (!sameSite(request, url)) return page('Blocked', message('<p>This request came from another site, so it was refused.</p>'), { status: 403 });
  if (!action) return saveSettings(request, env, id, account);
  if (action === '/telegram') return connectTelegram(env, id, account);
  if (action === '/telegram/remove') return removeTelegram(request, env, id);
  return testAlert(env, id, account);
}
