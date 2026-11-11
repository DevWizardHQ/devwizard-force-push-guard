import { github } from './github.js';
import { readSettings } from './store.js';

async function postJson(url, data) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error(`POST to ${new URL(url).hostname} failed: ${res.status}`);
}

export function sendDiscord(webhookUrl, title, body) {
  return postJson(webhookUrl, { content: `**${title}**\n${body}`.slice(0, 1990), allowed_mentions: { parse: [] } });
}

export function sendTelegram(env, chatId, text) {
  return postJson(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text: text.replace(/\*\*|`/g, '').slice(0, 4096),
    link_preview_options: { is_disabled: true },
  });
}

export async function alert(env, { installationId, token, repo }, title, body) {
  const settings = await readSettings(env, installationId).catch((err) => {
    console.error('settings unreadable', err);
    return {};
  });
  const issueRepo = settings.alertRepo || repo;
  const jobs = [];
  if (token && issueRepo) {
    jobs.push(['GitHub issue', github(`/repos/${issueRepo}/issues`, token, { method: 'POST', body: JSON.stringify({ title, body }) })]);
  }
  if (settings.discordWebhookUrl) jobs.push(['Discord', sendDiscord(settings.discordWebhookUrl, title, body)]);
  if (env.TELEGRAM_BOT_TOKEN) {
    for (const chat of settings.telegramChats ?? []) {
      jobs.push([`Telegram (${chat.title})`, sendTelegram(env, chat.id, `${title}\n${body}`)]);
    }
  }
  const results = await Promise.allSettled(jobs.map(([, job]) => job));
  return results.map((result, i) => {
    if (result.status === 'rejected') console.error(`${jobs[i][0]} alert failed`, result.reason?.message);
    return { channel: jobs[i][0], ok: result.status === 'fulfilled', error: result.reason?.message };
  });
}
