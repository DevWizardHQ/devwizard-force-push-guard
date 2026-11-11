# Self-hosting

Run your own GitHub App and Worker when you want full control of your data, the settings page and its storage. You need a GitHub account or organization, a Cloudflare account, and Node.js 24 or later.

Discord and Telegram are configured on the settings page, not with environment variables. Without the settings page, alerts are GitHub issues in the pushed repository only.

## 1. Create the GitHub App

App names are global on GitHub, so pick a unique one. These links pre-fill the form with the name `Force Fence (your-org)`, permissions, the push event, the Setup URL, "Redirect on update" and the callback URL. Replace `your-org` in the name, and replace `force-fence.example.com` with your own Worker host (see step 3). You can also edit these fields later on the App's settings page.

Personal account:

```
https://github.com/settings/apps/new?name=Force%20Fence%20%28your-org%29&url=https%3A%2F%2Fgithub.com%2FDevWizardHQ%2Fforce-fence&public=false&webhook_active=true&webhook_url=https%3A%2F%2Fforce-fence.example.com&setup_url=https%3A%2F%2Fforce-fence.example.com%2Fsetup&setup_on_update=true&callback_urls[]=https%3A%2F%2Fforce-fence.example.com%2Fauth%2Fcallback&contents=write&issues=write&metadata=read&events[]=push
```

Organization (replace `your-org` in the path):

```
https://github.com/organizations/your-org/settings/apps/new?name=Force%20Fence%20%28your-org%29&url=https%3A%2F%2Fgithub.com%2FDevWizardHQ%2Fforce-fence&public=false&webhook_active=true&webhook_url=https%3A%2F%2Fforce-fence.example.com&setup_url=https%3A%2F%2Fforce-fence.example.com%2Fsetup&setup_on_update=true&callback_urls[]=https%3A%2F%2Fforce-fence.example.com%2Fauth%2Fcallback&contents=write&issues=write&metadata=read&events[]=push
```

The App needs:

| Permission | Level |
|---|---|
| Contents | Read and write |
| Issues | Read and write |
| Metadata | Read |

It subscribes to the `push` event. GitHub delivers `installation` and `installation_repositories` events to every App automatically.

On the form, check or set:

1. Webhook URL: `https://force-fence.example.com`.
2. Webhook secret. GitHub cannot pre-fill it. Generate one, for example with `openssl rand -hex 32`, and keep it for step 3.
3. Callback URL: `https://force-fence.example.com/auth/callback`.
4. Setup URL: `https://force-fence.example.com/setup`, with "Redirect on update" checked.
5. Under "Where can this GitHub App be installed?", keep "Only on this account" unless you want others to install it.
6. Click Create GitHub App.

After creating the App:

1. Copy the App ID and the Client ID from the App's settings page.
2. Click Generate a new client secret and copy it.
3. Under Private keys, click Generate a private key. A `.pem` file downloads.
4. Convert the key to PKCS#8, the format the Worker expects:

```bash
openssl pkcs8 -topk8 -nocrypt -in app.pem -out app.pkcs8.pem
```

Keep the key and secrets private and never commit them.

## 2. Create the D1 database

Saved settings live in Cloudflare D1, encrypted.

```bash
npx wrangler d1 create force-fence
```

Copy the database ID from the output. You need it in step 3.

## 3. Deploy the Worker

```bash
git clone https://github.com/DevWizardHQ/force-fence.git
cd force-fence
cp wrangler.example.jsonc wrangler.jsonc
```

Edit `wrangler.jsonc`. `wrangler.jsonc` is gitignored, so your account details stay local.

| Field | Set it to |
|---|---|
| `routes[0].pattern` | Your Worker's hostname. The template has the placeholder `force-fence.example.com`. The domain must be on your Cloudflare account. |
| `d1_databases[0].database_id` | The database ID from step 2. Keep the binding name `DB`, the `database_name` `force-fence` and `migrations_dir` `migrations`. |
| `vars.GITHUB_CLIENT_ID` | The Client ID from step 1. |
| `vars.TELEGRAM_BOT_USERNAME` | Your bot's username without `@` (step 5). Leave the placeholder if you skip Telegram. |

If you do not want a custom domain, delete the `routes` line and use the Worker URL that `wrangler deploy` prints. Then update the App's Webhook, Callback and Setup URLs to that host.

```bash
npm ci
npm test
npx wrangler d1 migrations apply force-fence --remote
npx wrangler deploy
```

The migration creates the settings tables. Run it again after every update that adds files to `migrations/`.

Set the required secrets:

```bash
npx wrangler secret put APP_ID
npx wrangler secret put PRIVATE_KEY < app.pkcs8.pem
npx wrangler secret put WEBHOOK_SECRET
```

Set the settings page secrets:

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
openssl rand -base64 32 | npx wrangler secret put SETTINGS_KEY
```

`SETTINGS_KEY` encrypts every saved setting. Back it up. If you lose it, saved settings cannot be read and everyone has to enter them again.

## 4. Install the App

Open your App's public page or its Install App tab and install it on the account or organization, choosing the repositories to cover. GitHub then sends you to your settings page at `/setup`. Protection starts as soon as the App is installed. See [configuration.md](configuration.md) to choose branches.

## 5. Set up Telegram (optional)

Your own bot serves every installation of your App. The hosted bot `@ForceFenceBot` works only with the hosted App.

1. In Telegram, message @BotFather and send `/newbot`. Follow the prompts and copy the bot token and the bot's username.
2. Finish the bot's profile with BotFather:

   | Command | What to set |
   |---|---|
   | `/setuserpic` | The logo from `docs/assets/logo-light.png` |
   | `/setabouttext` | A one-line description of the bot |
   | `/setdescription` | What people see before they start the bot |
   | `/setcommands` | `start - Link this chat with your Force Fence code` |

   Leave Allow Groups and Privacy mode on. Their defaults work as is.
3. Put the username, without the `@`, in `vars.TELEGRAM_BOT_USERNAME` in `wrangler.jsonc` and redeploy.
4. Store the token, and a random secret that Telegram will send with every bot update:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
openssl rand -hex 32
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Paste the generated value when prompted for `TELEGRAM_WEBHOOK_SECRET`.

5. Point the bot at your Worker, with your values in place of the placeholders:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url=https://force-fence.example.com/telegram \
  -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

6. On the settings page, click Connect a Telegram chat. The page shows a code that works once and expires after 10 minutes. Use it one of three ways:
   - Add to a group.
   - Direct message the bot.
   - Channel: add the bot to the channel as an admin allowed to post messages, then post the code in the channel.

   The bot replies "Connected" in that chat. Each installation can connect up to 10 chats, and you can disconnect each one on the page.

## 6. Set up the settings page

Open `https://force-fence.example.com/setup` (GitHub sends you there after install and after Configure, then Save, on the installation page) and sign in with GitHub. Only someone with admin access to every repository the installation covers. This includes the personal account owner and organization owners. The page cannot manage installations that cover more than 3000 repositories.

| Setting | Meaning |
|---|---|
| Alert repository | Optional `owner/repo`, owned by the same account and covered by the installation. Alert issues go there. When empty, the issue is opened in the pushed repository. Pick a private repository so incidents in public repositories are not public. |
| Discord webhook | Optional. Only `https://discord.com/api/webhooks/...` URLs are accepted. |
| Telegram | Optional. Up to 10 chats, and at most 5 unused codes at a time. Connect as in step 5. |
| Send test alert | Sends a test alert to everything you configured. |

To get a Discord webhook URL, open the channel's settings in your Discord server, then Integrations, then Webhooks, click New Webhook and copy the URL.

Settings are encrypted with AES-GCM in D1 and deleted when the App is uninstalled.

## Configuration reference

| Name | Kind | Required | Meaning |
|---|---|---|---|
| `APP_ID` | secret | Yes | GitHub App ID |
| `PRIVATE_KEY` | secret | Yes | App private key in PKCS#8 form |
| `WEBHOOK_SECRET` | secret | Yes | App webhook secret |
| `TELEGRAM_BOT_TOKEN` | secret | For Telegram | Bot token from @BotFather. One bot serves every installation. |
| `TELEGRAM_BOT_USERNAME` | var | Settings page | Bot username without `@`, used for the Connect Telegram link |
| `TELEGRAM_WEBHOOK_SECRET` | secret | Settings page | Secret token Telegram sends with bot updates |
| `GITHUB_CLIENT_ID` | var | Settings page | GitHub App client ID, used for sign-in |
| `GITHUB_CLIENT_SECRET` | secret | Settings page | GitHub App client secret |
| `SESSION_SECRET` | secret | Settings page | Random string that signs the sign-in cookie |
| `SETTINGS_KEY` | secret | Settings page | Base64 32-byte key that encrypts saved settings |
| `DB` | D1 binding | Settings page and safety rules | D1 database used by the settings page and the safety rules (the brake and rewrite memory). Schema is in `migrations/`. Reverts work without it. |

Without the `DB` binding, the settings page is off and only issues in the pushed repository are sent. If the database is missing or broken, reverts still happen. Only the brake and the rewrite memory are skipped.

## Verify with a test repository

1. Create a throwaway repository and install the App on it.
2. Open the settings page and click Send test alert.
3. Add `.github/force-fence.yml` with `branches: [scratch]`, or rely on the default branch.
4. Push a commit to the protected branch, then force-push an earlier commit over it:

```bash
git push --force origin HEAD~1:scratch
```

5. Within moments the branch should return to its earlier commit, and an alert issue should appear (plus Discord and Telegram messages if connected).
6. If nothing happens, open the App's Advanced page in GitHub and check Recent Deliveries for the webhook response. Fix the cause, then redeliver the event.

## Update and rollback

Update:

```bash
git pull
npm ci
npm test
npx wrangler d1 migrations apply force-fence --remote
npx wrangler deploy
```

Roll back to the previous deployment:

```bash
npx wrangler rollback
```

## Limits

If Cloudflare is down when a push happens, nothing is restored. Redeliver the event from the App's Advanced page in GitHub once the Worker is back.
