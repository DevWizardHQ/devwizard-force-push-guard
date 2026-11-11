# Deploy: feat/force-fence

| Branch | PR | Downtime | Migrations |
|---|---|---|---|
| `feat/force-fence` | [#2](https://github.com/DevWizardHQ/force-fence/pull/2) | None expected. Alerts pause for about a minute while the App is renamed. | 1 D1 migration (`migrations/0001_init.sql`) |

## Deploy log

| Environment | Date | Deployed by | Commit | Result |
|---|---|---|---|---|
| production | | | | |

## Before deploying

1. Create the org-wide config so that branches other than the default stay protected. Commit
   `.github/force-fence.yml` to the `<org>/.github` repository with the branches that are protected today, for example
   `branches: [main, master, dev, develop]`.
2. Make sure the Telegram bot exists (`@BotFather`) and that its token has never been posted anywhere. If it has,
   run `/revoke` first.
3. Copy the current Discord webhook URL from Discord (channel settings, then Integrations, then Webhooks). You will
   paste it on the settings page. The Worker no longer reads it from a secret.

## Secrets and vars

| Name | Kind | Value |
|---|---|---|
| `GITHUB_CLIENT_ID` | var in `wrangler.jsonc` | Client ID from the GitHub App settings page |
| `TELEGRAM_BOT_USERNAME` | var in `wrangler.jsonc` | Bot username without `@` |
| `GITHUB_CLIENT_SECRET` | secret | Generated on the GitHub App settings page |
| `SESSION_SECRET` | secret | `openssl rand -base64 32` |
| `SETTINGS_KEY` | secret | `openssl rand -base64 32`. Keep a copy in the password manager; losing it means every installation re-enters its settings. |
| `TELEGRAM_BOT_TOKEN` | secret | From `@BotFather` |
| `TELEGRAM_WEBHOOK_SECRET` | secret | `openssl rand -hex 32` |

`APP_ID`, `PRIVATE_KEY` and `WEBHOOK_SECRET` stay as they are.

## Deploy steps

1. Rename the Worker in place to `force-fence` (Cloudflare dashboard, Worker, Settings, General, Name). Renaming keeps
   its secrets and custom domain. Do not deploy under the new name first, or a second Worker is created.
2. Update the local `wrangler.jsonc`: `name: "force-fence"`, add the `DB` D1 binding and the two vars. Use
   `wrangler.example.jsonc` as the reference.
3. `npx wrangler d1 create force-fence` creates the database. Put its id in `wrangler.jsonc`, then run
   `npx wrangler d1 migrations apply force-fence --remote` to create the tables.
4. In the GitHub App settings, set Callback URL `https://<worker-host>/auth/callback`, Setup URL
   `https://<worker-host>/setup`, turn on "Redirect on update", generate a client secret and copy the Client ID.
5. `npx wrangler secret put <NAME>` for each secret in the table above.
6. `npm ci && npm test` verifies the build.
7. `npx wrangler deploy` ships the new code. From now on the bot login is looked up at runtime, so the App can be
   renamed safely.
8. `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://<worker-host>/telegram -d secret_token=<TELEGRAM_WEBHOOK_SECRET>`
   points the bot at the Worker.
9. Rename the GitHub App to "Force Fence", make it public, and fill in the description, homepage
   (`https://github.com/DevWizardHQ/force-fence`) and logo (`docs/assets/logo.png`).
10. Open the settings page from the installation's Configure page and save the alert repository, the Discord webhook
    and the Telegram chats.
11. After a day without problems, run `npx wrangler secret delete DISCORD_GITHUB_GUARD_WEBHOOK_URL`.

## Verify after deploy

- [ ] `GET https://<worker-host>/` returns `force-fence is running`.
- [ ] The settings page signs you in and shows the installation.
- [ ] "Send test alert" reports the issue, Discord and every Telegram chat as sent.
- [ ] A force push to a protected branch of a throwaway repository is reverted and alerted.
- [ ] The App's recent deliveries show `200` responses.

## Rollback

- Before step 9: `npx wrangler rollback` restores the previous version.
- After step 9 the bot login has changed. The previous version compares against the old login, so its own reverts
  would be reverted again. Do not use `wrangler rollback`. Instead check out the previous commit, set
  `APP_BOT_LOGIN` to `force-fence[bot]` in its `wrangler.jsonc`, and deploy that.
