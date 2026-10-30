const API = 'https://api.github.com';
const encoder = new TextEncoder();

export function decide(event, payload, env) {
  if (event === 'installation' && ['deleted', 'suspend'].includes(payload.action)) {
    return { alertOnly: `GitHub App ${payload.action === 'deleted' ? 'uninstalled' : 'suspended'} by ${payload.sender?.login}. Force pushes are no longer reverted.` };
  }
  if (event === 'installation_repositories' && payload.action === 'removed') {
    const names = payload.repositories_removed.map((r) => r.full_name).join(', ');
    return { alertOnly: `${payload.sender?.login} removed repositories from the guard: ${names}. Force pushes there are no longer reverted.` };
  }
  if (event !== 'push') return null;

  const { ref, before, after, forced, deleted, sender } = payload;
  if (!new RegExp(env.PROTECTED_REFS).test(ref)) return null;
  if (sender.login === env.APP_BOT_LOGIN) return null;
  const allowed = (env.ALLOWED_PUSHERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(sender.login)) return null;
  if (deleted) return { action: 'recreate', sha: before };
  if (forced) return { action: 'reset', sha: before, expect: after };
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

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function appJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const part = (obj) => b64url(encoder.encode(JSON.stringify(obj)));
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: String(env.APP_ID) })}`;
  const der = Uint8Array.from(atob(env.PRIVATE_KEY.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return `${unsigned}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned)))}`;
}

async function github(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'devwizard-force-push-guard',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} failed: ${res.status} ${data?.message ?? ''}`);
  return data;
}

async function installationToken(env, installationId) {
  const jwt = await appJwt(env);
  return (await github(`/app/installations/${installationId}/access_tokens`, jwt, { method: 'POST' })).token;
}

async function repair(decision, payload, token) {
  const repo = payload.repository.full_name;
  const shortRef = payload.ref.replace(/^refs\//, '');
  if (decision.action === 'recreate') {
    await github(`/repos/${repo}/git/refs`, token, { method: 'POST', body: JSON.stringify({ ref: payload.ref, sha: decision.sha }) });
    return `Recreated \`${shortRef}\` at \`${decision.sha.slice(0, 8)}\`.`;
  }
  const current = await github(`/repos/${repo}/git/ref/${shortRef}`, token);
  if (current.object.sha !== decision.expect) {
    return `Not reverted: \`${shortRef}\` moved again to \`${current.object.sha.slice(0, 8)}\` before the guard ran. Check it by hand.`;
  }
  await github(`/repos/${repo}/git/refs/${shortRef}`, token, { method: 'PATCH', body: JSON.stringify({ sha: decision.sha, force: true }) });
  return `Reverted \`${shortRef}\` from \`${decision.expect.slice(0, 8)}\` back to \`${decision.sha.slice(0, 8)}\`.`;
}

async function alert(env, token, title, body) {
  const jobs = [];
  if (token && env.ALERT_REPO) {
    jobs.push(github(`/repos/${env.ALERT_REPO}/issues`, token, { method: 'POST', body: JSON.stringify({ title, body }) }));
  }
  if (env.DISCORD_GITHUB_GUARD_WEBHOOK_URL) {
    jobs.push(fetch(env.DISCORD_GITHUB_GUARD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `**${title}**\n${body}`.slice(0, 1990), allowed_mentions: { parse: [] } }),
    }));
  }
  const results = await Promise.allSettled(jobs);
  results.filter((r) => r.status === 'rejected').forEach((r) => console.error('alert failed', r.reason));
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('devwizard-force-push-guard is running', { status: 200 });
    const body = await request.text();
    if (!(await verifySignature(env.WEBHOOK_SECRET, body, request.headers.get('x-hub-signature-256')))) {
      return new Response('invalid signature', { status: 401 });
    }
    const event = request.headers.get('x-github-event');
    const payload = JSON.parse(body);
    const decision = decide(event, payload, env);
    if (!decision) return new Response('ignored', { status: 200 });

    let token = null;
    try {
      token = await installationToken(env, payload.installation.id);
    } catch (err) {
      console.error(err);
    }

    if (decision.alertOnly) {
      ctx.waitUntil(alert(env, token, 'Force-push guard disabled', decision.alertOnly));
      return new Response('alerted', { status: 200 });
    }

    const repo = payload.repository.full_name;
    const what = payload.deleted ? 'deleted' : 'force-pushed';
    let outcome;
    try {
      if (!token) throw new Error('could not get an installation token');
      outcome = await repair(decision, payload, token);
    } catch (err) {
      outcome = `Repair FAILED: ${err.message}. Restore \`${payload.ref}\` to \`${decision.sha}\` by hand.`;
    }
    const details = [
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
    ctx.waitUntil(alert(env, token, `Force push ${outcome.startsWith('Reverted') || outcome.startsWith('Recreated') ? 'reverted' : 'NOT reverted'}: ${repo} ${payload.ref.replace('refs/heads/', '')} by ${payload.sender.login}`, details));
    return new Response(outcome, { status: 200 });
  },
};
