import { load } from 'js-yaml';
import { alert } from './alerts.js';
import { appBotLogin, github, installationToken, readFile } from './github.js';
import { handleSettings } from './settings.js';
import { deleteSettings, forgetRewrites, MAX_REVERTS_PER_WINDOW, restoreTarget, REVERT_WINDOW_SECONDS, revertAllowed } from './store.js';

const CONFIG_PATH = '.github/force-fence.yml';
const MAX_LISTED_COMMITS = 2048;
const encoder = new TextEncoder();
const ownerOf = (fullName) => fullName.split('/')[0];
const branchOf = (ref) => ref.slice('refs/heads/'.length);
const refPath = (ref) => ref.replace(/^refs\//, '').split('/').map(encodeURIComponent).join('/');

export function globMatch(glob, branch) {
  const tokens = glob.match(/\*\*|\*|[^*]/g) ?? [];
  let next = Array(branch.length + 1).fill(false);
  next[branch.length] = true;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const current = Array(branch.length + 1).fill(false);
    for (let j = branch.length; j >= 0; j--) {
      const token = tokens[i];
      if (token === '**') current[j] = next[j] || (j < branch.length && current[j + 1]);
      else if (token === '*') current[j] = next[j] || (j < branch.length && branch[j] !== '/' && current[j + 1]);
      else current[j] = j < branch.length && branch[j] === token && next[j + 1];
    }
    next = current;
  }
  return next[0];
}

export function parseConfig(text) {
  const data = (text.trim() && load(text)) || {};
  const list = (value) => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.map(String) : undefined);
  return { branches: list(data.branches), allowedPushers: list(data.allowed_pushers) ?? [] };
}

export function isRewrite(event, payload) {
  return event === 'push' && Boolean(payload.ref?.startsWith('refs/heads/')) && Boolean(payload.forced || payload.deleted);
}

export function touchesConfig(event, payload) {
  if (event !== 'push' || payload.ref !== `refs/heads/${payload.repository?.default_branch}`) return false;
  if ((payload.commits ?? []).length >= MAX_LISTED_COMMITS) return true;
  return (payload.commits ?? []).some((c) => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])].includes(CONFIG_PATH));
}

export function decide(payload, config) {
  const { ref, before, after, deleted, sender, repository } = payload;
  const patterns = config.branches ?? [repository.default_branch];
  if (!patterns.some((pattern) => globMatch(pattern, branchOf(ref)))) return null;
  if (config.allowedPushers?.includes(sender.login)) return null;
  return deleted ? { action: 'recreate', sha: before } : { action: 'reset', sha: before, expect: after };
}

export function installationNotice(event, payload) {
  const who = payload.sender?.login;
  if (event === 'installation' && payload.action === 'deleted') {
    return { title: 'Force Fence uninstalled', body: `${who} uninstalled Force Fence from **${payload.installation.account.login}**. Force pushes are no longer reverted.` };
  }
  if (event === 'installation' && payload.action === 'suspend') {
    return { title: 'Force Fence suspended', body: `${who} suspended Force Fence on **${payload.installation.account.login}**. Force pushes are no longer reverted.` };
  }
  if (event === 'installation_repositories' && payload.action === 'removed') {
    const names = payload.repositories_removed.map((r) => r.full_name).join(', ');
    return { title: 'Repositories removed from Force Fence', body: `${who} removed repositories from Force Fence: ${names}. Force pushes there are no longer reverted.` };
  }
  return null;
}

export async function verifySignature(secret, body, header) {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const hex = header.slice(7);
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
  return crypto.subtle.verify('HMAC', key, sig, encoder.encode(body));
}

async function loadConfig(payload, token) {
  const repo = payload.repository.full_name;
  const shared = `${ownerOf(repo)}/.github`;
  // A rewrite of the default branch must not be judged by the config it just pushed.
  const pinned = branchOf(payload.ref) === payload.repository.default_branch ? payload.before : undefined;
  try {
    let text = await readFile(repo, CONFIG_PATH, token, pinned);
    if (text === null && repo !== shared) text = await readFile(shared, CONFIG_PATH, token);
    return text === null ? {} : parseConfig(text);
  } catch (err) {
    console.error('config unreadable, protecting the default branch only', err);
    return {};
  }
}

async function isOwnBot(env, sender) {
  if (sender.type !== 'Bot') return false;
  try {
    return sender.login === (await appBotLogin(env)) || sender.login === (await appBotLogin(env, { refresh: true }));
  } catch (err) {
    // Unknown identity: treat a bot push as our own revert so two reverts can never undo each other in a loop.
    console.error(err);
    return true;
  }
}

async function repair(env, decision, payload, token) {
  const repo = payload.repository.full_name;
  const shortRef = payload.ref.replace(/^refs\//, '');
  const target = `${repo}:${payload.ref}`;
  if (payload.sender.type === 'Bot' && !(await revertAllowed(env, target).catch(() => true))) {
    return `Not reverted: \`${shortRef}\` was rewritten ${MAX_REVERTS_PER_WINDOW} times in ${REVERT_WINDOW_SECONDS / 60} minutes. Force Fence stopped acting on it so it cannot fight another tool. Check it by hand.`;
  }
  const { sha, rows } = await restoreTarget(env, target, decision.sha, payload.after);
  const current = await github(`/repos/${repo}/git/ref/${refPath(payload.ref)}`, token).catch((err) => {
    if (err.status === 404) return null;
    throw err;
  });
  if (decision.action === 'recreate') {
    if (current) return `Not recreated: \`${shortRef}\` already exists again at \`${current.object.sha.slice(0, 8)}\`. Check it by hand.`;
    await github(`/repos/${repo}/git/refs`, token, { method: 'POST', body: JSON.stringify({ ref: payload.ref, sha }) });
    await forgetRewrites(env, rows);
    return `Recreated \`${shortRef}\` at \`${sha.slice(0, 8)}\`.`;
  }
  if (current?.object.sha !== decision.expect) {
    return `Not reverted: \`${shortRef}\` moved again to \`${current?.object.sha.slice(0, 8) ?? 'nowhere'}\` before Force Fence ran. Check it by hand.`;
  }
  await github(`/repos/${repo}/git/refs/${refPath(payload.ref)}`, token, { method: 'PATCH', body: JSON.stringify({ sha, force: true }) });
  await forgetRewrites(env, rows);
  return `Reverted \`${shortRef}\` from \`${decision.expect.slice(0, 8)}\` back to \`${sha.slice(0, 8)}\`.`;
}

function rewriteAlert(payload, outcome) {
  const repo = payload.repository.full_name;
  const what = payload.deleted ? 'deleted' : 'force-pushed';
  const fixed = outcome.startsWith('Reverted') || outcome.startsWith('Recreated');
  const title = `Force push ${fixed ? 'reverted' : 'NOT reverted'}: ${repo} ${branchOf(payload.ref)} by ${payload.sender.login}`;
  const body = [
    `**${payload.sender.login}** ${what} \`${payload.ref}\` in **${repo}**.`,
    '',
    outcome,
    '',
    `- Before: \`${payload.before}\``,
    `- After: \`${payload.after}\``,
    `- Pusher: ${payload.pusher?.name ?? payload.sender.login}`,
    `- Time: ${new Date().toISOString()}`,
    '',
    'If this was not a deliberate, coordinated change, treat the pusher\'s machine and tokens as compromised.',
  ].join('\n');
  return { title, body };
}

function configAlert(payload) {
  const repo = payload.repository.full_name;
  return {
    title: `Force Fence config changed: ${repo} by ${payload.sender.login}`,
    body: [
      (payload.commits ?? []).length >= MAX_LISTED_COMMITS
        ? `**${payload.sender.login}** pushed too many commits to \`${payload.repository.default_branch}\` in **${repo}** for Force Fence to check whether \`${CONFIG_PATH}\` changed.`
        : `**${payload.sender.login}** changed \`${CONFIG_PATH}\` on \`${payload.repository.default_branch}\` in **${repo}**.`,
      '',
      'This file decides which branches Force Fence protects and who may force-push. If you did not expect this change, review it now.',
      '',
      `- Changes: ${payload.compare}`,
      `- Time: ${new Date().toISOString()}`,
    ].join('\n'),
  };
}

async function handleWebhook(request, env, ctx) {
  const body = await request.text();
  if (!(await verifySignature(env.WEBHOOK_SECRET, body, request.headers.get('x-hub-signature-256')))) {
    return new Response('invalid signature', { status: 401 });
  }
  const event = request.headers.get('x-github-event');
  const payload = JSON.parse(body);
  const installationId = payload.installation?.id;

  const notice = installationNotice(event, payload);
  if (notice) {
    const token = event === 'installation_repositories' ? await installationToken(env, installationId).catch(() => null) : null;
    const uninstalled = event === 'installation' && payload.action === 'deleted';
    ctx.waitUntil(
      alert(env, { installationId, token }, notice.title, notice.body).then(() => uninstalled && deleteSettings(env, installationId)),
    );
    return new Response('alerted', { status: 200 });
  }

  const rewrite = isRewrite(event, payload);
  const configChanged = touchesConfig(event, payload);
  if ((!rewrite && !configChanged) || (await isOwnBot(env, payload.sender))) return new Response('ignored', { status: 200 });

  const repo = payload.repository.full_name;
  let token = null;
  try {
    token = await installationToken(env, installationId);
  } catch (err) {
    console.error(err);
  }

  const decision = rewrite && decide(payload, token ? await loadConfig(payload, token) : {});
  if (decision) {
    let outcome;
    try {
      if (!token) throw new Error('could not get an installation token');
      outcome = await repair(env, decision, payload, token);
    } catch (err) {
      outcome = `Repair FAILED: ${err.message}. Restore \`${payload.ref}\` to \`${decision.sha}\` by hand.`;
    }
    const { title, body: details } = rewriteAlert(payload, outcome);
    ctx.waitUntil(alert(env, { installationId, token, repo }, title, details));
    return new Response(outcome, { status: 200 });
  }
  if (configChanged) {
    const { title, body: details } = configAlert(payload);
    ctx.waitUntil(alert(env, { installationId, token, repo }, title, details));
    return new Response('config change alerted', { status: 200 });
  }
  return new Response('ignored', { status: 200 });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/' && request.method === 'POST') return handleWebhook(request, env, ctx);
    if (pathname === '/') return new Response('force-fence is running', { status: 200 });
    return (await handleSettings(request, env)) ?? new Response('Not found', { status: 404 });
  },
};
