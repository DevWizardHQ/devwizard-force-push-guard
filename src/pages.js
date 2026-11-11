import { ICONS } from './icons.js';

const REPO_URL = 'https://github.com/DevWizardHQ/force-fence';
const CHAT_KINDS = { private: 'Direct message', group: 'Group', supergroup: 'Group', channel: 'Channel' };

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SECURITY_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cache-control': 'no-store',
};

const STYLE = `
:root{color-scheme:light dark;--paper:#f4f2ff;--panel:#fff;--field:#fbfaff;--ink:#241a4d;--muted:#5b5480;--rule:#e2def7;--edge:#241a4d;--drop:#241a4d;--violet:#6553f2;--on-violet:#fff;--gold:#e9b21c;--teal:#16808f;--teal-bg:#ddf4f7;--rose:#c2255c;--rose-bg:#fde7ee;--gh:#241a4d;--discord:#5865f2;--telegram:#229ed9}
@media (prefers-color-scheme:dark){:root{--paper:#14112a;--panel:#1e1a3b;--field:#171433;--ink:#eeebff;--muted:#aba4d6;--rule:#2f2958;--edge:#4a3f8f;--drop:#07061a;--violet:#8d7dff;--on-violet:#14112a;--gold:#f7c948;--teal:#5ad1e0;--teal-bg:#123a44;--rose:#ff86a6;--rose-bg:#3d1426;--gh:#eeebff}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:40px 16px 48px}
.masthead{display:flex;align-items:center;gap:22px;margin-bottom:32px}
.masthead img{display:block;width:112px;height:112px;border:2px solid var(--edge);border-radius:26px;box-shadow:4px 4px 0 var(--drop)}
.masthead picture{flex:none}
h1,h2{font-family:ui-rounded,"SF Pro Rounded","Nunito","Varela Round",system-ui,sans-serif;letter-spacing:-.01em;margin:0}
h1{font-size:clamp(1.75rem,4.5vw,2.3rem);line-height:1.12;font-weight:800;margin-bottom:8px}
h2{font-size:1.2rem;line-height:1.3;font-weight:800}
.lede{margin:0;color:var(--muted);max-width:52ch}
.lede strong{color:var(--ink)}
a{color:var(--violet);font-weight:600}
.panel{background:var(--panel);border:2px solid var(--edge);border-radius:20px;box-shadow:5px 5px 0 var(--drop);margin:0 0 24px;overflow:hidden}
.item{display:grid;grid-template-columns:48px minmax(0,1fr);gap:16px;padding:22px 24px}
.item.plain{grid-template-columns:minmax(0,1fr)}
.item+.item{border-top:2px solid var(--rule)}
.glyph{width:48px;height:48px;border-radius:14px;border:2px solid var(--edge);display:grid;place-items:center;background:var(--field)}
.glyph.github{color:var(--gh)}.glyph.discord{color:var(--discord)}.glyph.telegram{color:var(--telegram)}
.item-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-bottom:4px}
.hint{margin:0 0 14px;color:var(--muted);font-size:.95rem;max-width:60ch}
.item p:last-child{margin-bottom:0}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:.85rem;font-weight:600;background:var(--rule);color:var(--muted)}
.pill::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.pill.on{background:var(--teal-bg);color:var(--teal)}
label{display:block;font-weight:600;font-size:.95rem;margin-bottom:6px}
input[type=text],input[type=url]{width:100%;padding:11px 14px;border:2px solid var(--rule);border-radius:12px;background:var(--field);color:var(--ink);font:inherit}
input::placeholder{color:var(--muted);opacity:.75}
input[type=text]:focus,input[type=url]:focus{border-color:var(--violet);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--violet) 25%,transparent)}
.check{display:flex;align-items:center;gap:8px;font-weight:400;margin:12px 0 0}
.check input{width:18px;height:18px;margin:0;accent-color:var(--violet)}
.foot{display:flex;justify-content:flex-end;padding:16px 24px;background:var(--field);border-top:2px solid var(--rule)}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border:2px solid var(--edge);border-radius:12px;background:var(--violet);color:var(--on-violet);font:inherit;font-weight:700;text-decoration:none;cursor:pointer;box-shadow:3px 3px 0 var(--drop);transition:transform .08s ease,box-shadow .08s ease}
.btn:hover{filter:brightness(1.06)}
.btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--drop)}
.btn.quiet{background:var(--panel);color:var(--ink)}
.btn.small{padding:5px 12px;font-size:.9rem;box-shadow:2px 2px 0 var(--drop)}
.btn[disabled]{opacity:.5;cursor:not-allowed}
:focus-visible{outline:3px solid var(--violet);outline-offset:3px}
.chips{list-style:none;padding:0;margin:0 0 16px;display:grid;gap:8px}
.chip{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 8px 8px 14px;border:2px solid var(--rule);border-radius:14px;background:var(--field)}
.chip span{min-width:0;overflow-wrap:anywhere}
.chip small{color:var(--muted);margin-left:6px}
.chip form{flex:none}
.actions{display:flex;flex-wrap:wrap;gap:12px}
.strip{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;border:2px dashed var(--edge);border-radius:20px}
.strip p{margin:2px 0 0;color:var(--muted);font-size:.95rem}
.notice{display:flex;gap:12px;align-items:flex-start;padding:14px 18px;border-radius:16px;border:2px solid var(--edge);margin:0 0 24px;background:var(--panel)}
.notice p,.notice ul{margin:0}
.notice svg{flex:none;margin-top:2px}
.notice.ok svg{color:var(--gold)}
.notice.bad{background:var(--rose-bg);border-color:var(--rose)}
.notice.bad svg{color:var(--rose)}
.notice.bad ul{padding-left:18px}
.results{list-style:none;margin:0;padding:0}
.results li{display:flex;gap:14px;align-items:flex-start;padding:16px 24px}
.results li+li{border-top:2px solid var(--rule)}
.results .mark{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;border:2px solid currentColor}
.results .ok{color:var(--teal)}.results .bad{color:var(--rose)}
.results p{margin:0;color:var(--muted);font-size:.95rem;overflow-wrap:anywhere}
.code{display:inline-block;margin:0;font:700 1.1rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.03em;padding:12px 16px;border:2px dashed var(--edge);border-radius:12px;background:var(--field);user-select:all;overflow-wrap:anywhere;max-width:100%}
.list{list-style:none;margin:0;padding:0}
.list a{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;text-decoration:none;color:var(--ink)}
.list li+li{border-top:2px solid var(--rule)}
.list a:hover{background:var(--field)}
footer{margin-top:40px;padding-top:20px;border-top:2px solid var(--rule);color:var(--muted);font-size:.9rem;display:flex;flex-wrap:wrap;gap:8px 20px}
footer a{color:inherit;font-weight:500}
@media (max-width:560px){.wrap{padding-top:24px}.masthead{gap:14px;margin-bottom:24px}.masthead img{width:76px;height:76px;border-radius:18px;box-shadow:3px 3px 0 var(--drop)}.item{grid-template-columns:minmax(0,1fr);gap:12px;padding:20px}.foot,.strip,.results li,.list a{padding-left:20px;padding-right:20px}.foot .btn{width:100%;justify-content:center}}
@media (prefers-reduced-motion:reduce){.btn{transition:none}}
`;

export function page(title, body, { lede = '', status = 200, cookies = [], signedIn = false } = {}) {
  const headers = new Headers(SECURITY_HEADERS);
  cookies.forEach((c) => headers.append('set-cookie', c));
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Force Fence</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>${STYLE}</style>
</head>
<body><div class="wrap">
<header class="masthead">
<picture><source srcset="/logo-dark.png" media="(prefers-color-scheme: dark)"><img src="/logo-light.png" width="112" height="112" alt="Force Fence"></picture>
<div><h1>${esc(title)}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>
</header>
<main>
${body}
</main>
<footer><a href="${REPO_URL}">Source code</a><a href="${REPO_URL}/blob/main/PRIVACY.md">Privacy</a><a href="${REPO_URL}/security/policy">Security</a>${signedIn ? '<a href="/logout">Sign out</a>' : ''}</footer>
</div></body></html>`, { status, headers });
}

export const message = (html) => `<section class="panel"><div class="item plain"><div>${html}</div></div></section>`;

export const savedNotice = () => `<div class="notice ok" role="status">${ICONS.sparkle}<p><strong>Saved.</strong> The next alert uses these settings.</p></div>`;

export const errorNotice = (errors) => `<div class="notice bad" role="alert">${ICONS.cross}<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;

export function settingsView({ id, account, settings, bot, maxChats, notice = '' }) {
  const chats = settings.telegramChats ?? [];
  const discord = Boolean(settings.discordWebhookUrl);
  const webhookId = settings.discordWebhookUrl?.match(/\/webhooks\/(\d+)\//)?.[1] ?? 'saved';
  const chatItems = chats.map((chat) => `<li class="chip"><span>${esc(chat.title)}<small>${esc(CHAT_KINDS[chat.type] ?? chat.type)}</small></span>
<form method="post" action="/settings/${id}/telegram/remove"><input type="hidden" name="chat" value="${esc(chat.id)}"><button class="btn quiet small" type="submit">Disconnect</button></form></li>`).join('');
  return `${notice}
<form method="post" action="/settings/${id}" class="panel">
<div class="item">
<span class="glyph github">${ICONS.github}</span>
<div>
<div class="item-head"><h2>GitHub issue</h2><span class="pill on">Always on</span></div>
<p class="hint">Every blocked push opens an issue. Leave this empty to open it in the repository that was pushed to. A private repository keeps incidents out of public view.</p>
<label for="alertRepo">Repository</label>
<input id="alertRepo" name="alertRepo" type="text" value="${esc(settings.alertRepo)}" placeholder="${esc(account)}/security-alerts" autocomplete="off" spellcheck="false">
</div>
</div>
<div class="item">
<span class="glyph discord">${ICONS.discord}</span>
<div>
<div class="item-head"><h2>Discord</h2><span class="pill${discord ? ' on' : ''}">${discord ? 'Connected' : 'Not connected'}</span></div>
<p class="hint">${discord ? `Saved webhook <strong>${esc(webhookId)}</strong>. The rest of the URL is a secret, so it is never shown again. Paste a new URL only to replace it.` : 'Paste a channel webhook URL. In Discord, open the channel settings, then Integrations, then Webhooks.'}</p>
<label for="discord">${discord ? 'Replace the webhook URL' : 'Webhook URL'}</label>
<input id="discord" name="discordWebhookUrl" type="url" placeholder="${discord ? 'Saved. Leave empty to keep it.' : 'https://discord.com/api/webhooks/…'}" autocomplete="off" spellcheck="false">
${discord ? '<label class="check"><input type="checkbox" name="removeDiscord" value="1"> Disconnect Discord</label>' : ''}
</div>
</div>
<div class="foot"><button class="btn" type="submit">Save changes</button></div>
</form>
<section class="panel" aria-labelledby="telegram-title">
<div class="item">
<span class="glyph telegram">${ICONS.telegram}</span>
<div>
<div class="item-head"><h2 id="telegram-title">Telegram</h2><span class="pill${chats.length ? ' on' : ''}">${chats.length ? `${chats.length} ${chats.length === 1 ? 'chat' : 'chats'}` : 'Not connected'}</span></div>
<p class="hint">${bot ? `@${esc(bot)} posts alerts to groups, channels or direct messages.` : 'Telegram posts alerts to groups, channels or direct messages.'} Connect up to ${maxChats}.</p>
${chatItems ? `<ul class="chips">${chatItems}</ul>` : ''}
<form method="post" action="/settings/${id}/telegram"><button class="btn quiet" type="submit"${chats.length >= maxChats ? ' disabled' : ''}>Connect a Telegram chat</button></form>
</div>
</div>
</section>
<div class="strip">
<div><h2>Send a test alert</h2><p>Checks every place above. No branch is touched.</p></div>
<form method="post" action="/settings/${id}/test"><button class="btn quiet" type="submit">Send test alert</button></form>
</div>`;
}

export function telegramView({ id, code, bot }) {
  const handle = encodeURIComponent(bot);
  return `<section class="panel">
<div class="item plain">
<div>
<h2>Add to a group</h2>
<p class="hint">Telegram opens and asks which group should get the alerts.</p>
<a class="btn" href="https://t.me/${handle}?startgroup=${code}">Choose a group</a>
</div>
</div>
<div class="item plain">
<div>
<h2>Direct message</h2>
<p class="hint">Alerts arrive in your own chat with @${esc(bot)}.</p>
<a class="btn quiet" href="https://t.me/${handle}?start=${code}">Open the chat</a>
</div>
</div>
<div class="item plain">
<div>
<h2>Channel</h2>
<p class="hint">Add @${esc(bot)} to the channel as an admin who can post messages, then post this code in the channel.</p>
<p class="code">${code}</p>
</div>
</div>
</section>
<a href="/settings/${id}">Back to settings</a>`;
}

export function resultsView({ id, results, issueSkipped }) {
  const items = results.map((r) => `<li><span class="mark ${r.ok ? 'ok' : 'bad'}">${r.ok ? ICONS.check : ICONS.cross}</span><div><strong>${esc(r.channel)}</strong><p>${r.ok ? 'Sent' : esc(r.error)}</p></div></li>`).join('');
  const skipped = issueSkipped
    ? '<li><span class="mark">–</span><div><strong>GitHub issue</strong><p>Skipped. No alert repository is set, and real alerts open the issue in the repository that was pushed to.</p></div></li>'
    : '';
  const body = items || skipped ? `<ul class="results">${items}${skipped}</ul>` : '<div class="item plain"><p>Nothing is set up yet. Add a repository, Discord or Telegram first.</p></div>';
  return `<section class="panel">${body}</section>
<a href="/settings/${id}">Back to settings</a>`;
}

export function chooserView(installations) {
  if (!installations.length) return message('<p>Force Fence is not installed on any account you can manage. Install it from GitHub first.</p>');
  const items = installations.map((i) => `<li><a href="/setup?installation_id=${esc(i.id)}"><span>${esc(i.account.login)}</span><span aria-hidden="true">›</span></a></li>`).join('');
  return `<section class="panel"><ul class="list">${items}</ul></section>`;
}
