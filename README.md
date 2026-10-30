# Force-push guard

A Cloudflare Worker that receives push events from the `DevWizardHQ Force Push Guard` GitHub App. When a push
force-updates or deletes a protected branch, it resets the branch to its previous commit, opens an issue in
`DevWizardHQ/.github-private` and posts to Discord.

## Config

| Name | Kind | Value |
|---|---|---|
| `PROTECTED_REFS` | var | `^refs/heads/(main\|master\|dev\|develop)$` |
| `ALLOWED_PUSHERS` | var | Comma-separated GitHub logins allowed to force-push protected branches (empty by default) |
| `ALERT_REPO` | var | `DevWizardHQ/.github-private` |
| `APP_BOT_LOGIN` | var | The app's bot login, so the Worker ignores its own reverts |
| `APP_ID` | secret | GitHub App ID |
| `PRIVATE_KEY` | secret | GitHub App private key in PKCS#8 form (`openssl pkcs8 -topk8 -nocrypt -in app.pem`) |
| `WEBHOOK_SECRET` | secret | GitHub App webhook secret |
| `DISCORD_WEBHOOK_URL` | secret | Discord channel webhook URL (optional) |

## Deploy

```bash
npm test
npx wrangler deploy
npx wrangler secret put APP_ID
npx wrangler secret put PRIVATE_KEY < app.pkcs8.pem
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put DISCORD_WEBHOOK_URL
```

## GitHub App

Owned by DevWizardHQ and installed on all repositories. It needs Contents (read and write), Issues (read and
write) and Metadata (read), and subscribes to the Push event. Its webhook URL is the Worker URL.

## Limits

On the Workers Free plan, each request gets 10 ms of CPU time; this Worker uses a few. If Cloudflare is down when a
push happens, nothing is reverted. Redeliver the event from the app's Advanced page in GitHub.
