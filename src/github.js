const API = 'https://api.github.com';
const encoder = new TextEncoder();

export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function apiHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'force-fence',
  };
}

export async function github(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...apiHeaders(token), ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`GitHub ${init.method || 'GET'} ${path} failed: ${res.status} ${data?.message ?? ''}`), { status: res.status });
  return data;
}

export async function readFile(repo, path, token, ref) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await fetch(`${API}/repos/${repo}/contents/${path}${query}`, {
    headers: { ...apiHeaders(token), accept: 'application/vnd.github.raw+json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${repo}/${path} failed: ${res.status}`);
  return res.text();
}

export async function appJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const part = (obj) => b64url(encoder.encode(JSON.stringify(obj)));
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: String(env.APP_ID) })}`;
  const der = Uint8Array.from(atob(env.PRIVATE_KEY.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return `${unsigned}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned)))}`;
}

export async function installationToken(env, installationId) {
  return (await github(`/app/installations/${installationId}/access_tokens`, await appJwt(env), { method: 'POST' })).token;
}

let appSlug;
export async function appBotLogin(env, { refresh = false } = {}) {
  if (refresh || !appSlug) appSlug = (await github('/app', await appJwt(env))).slug;
  return `${appSlug}[bot]`;
}
