<p align="center"><img src="docs/assets/logo.svg" alt="Force Fence logo" width="96"></p>

# Force Fence

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
[![CI](https://github.com/DevWizardHQ/force-fence/actions/workflows/ci.yml/badge.svg)](https://github.com/DevWizardHQ/force-fence/actions/workflows/ci.yml)

A ward for your branches. Force Fence is a GitHub App that undoes force pushes and deletions on the branches you protect.

## What it does

When someone force-pushes or deletes a protected branch, Force Fence puts the branch back where it was and opens an issue so your team knows what happened. It runs as a small Cloudflare Worker.

It ignores normal pushes, branch creation, tags and branches you did not protect.

## How it works

1. GitHub sends a `push` webhook to the Worker.
2. The Worker checks the webhook signature and reads `.github/force-fence.yml` to see which branches are protected.
3. If the push force-updated or deleted a protected branch, the Worker resets the branch to the commit it pointed at before the push. A deleted branch is recreated at that commit.
4. If the branch moved again before the Worker ran, the Worker does not overwrite it and says so in the alert.
5. The Worker opens an issue describing the push, and posts to Discord and Telegram if you connected them.

Safety rules keep this from being turned against you. See [docs/configuration.md](docs/configuration.md#safety-rules): the config is read as it was before the push, config edits raise an alert, a brake stops fights with other bots, and a branch someone already recreated is left alone.

## Install the hosted App

1. Open https://github.com/apps/force-fence.
2. Click Install, or go straight to https://github.com/apps/force-fence/installations/new.
3. Choose the repositories to cover.

The App asks for:

| Permission | Why |
|---|---|
| Contents: read and write | Read `.github/force-fence.yml` and reset or recreate branches |
| Issues: read and write | Open the alert issue |
| Metadata: read | Required by GitHub for every App |

It subscribes to the `push` event. Without a config file, only each repository's default branch is protected.

### Set up alerts

After you install, GitHub sends you to the Force Fence settings page. You can reach it again from the installation page by clicking Configure and then Save. Sign in with GitHub. Only someone with admin access to every repository the installation covers. This includes the personal account owner and organization owners. The page cannot manage installations that cover more than 3000 repositories.

Each installation has its own settings:

| Setting | What it does |
|---|---|
| Alert repository | An `owner/repo` for alert issues. Leave it empty to open the issue in the pushed repository. Pick a private repository so incidents in public repositories stay private. |
| Discord webhook | Posts alerts to a Discord channel. |
| Telegram | Up to 10 chats per installation, through the hosted bot `@ForceFenceBot`. Click Connect a Telegram chat to get a one-time code, then use it in a group, a direct message or a channel (see below). |
| Send test alert | Checks that everything is wired up. |

Connecting Telegram:

1. Click Connect a Telegram chat. The page shows a code that works once and expires after 10 minutes.
2. Pick one way to use it:
   - Add to a group: open the group link, choose the group, and add the bot.
   - Direct message: open the direct message link and start the chat with the bot.
   - Channel: add `@ForceFenceBot` to the channel as an admin allowed to post messages, then post the code in the channel.
3. The bot replies "Connected" in that chat.

You can disconnect each chat on the settings page. You never type a chat ID.

An installation can have at most 5 unused Telegram codes at a time.

Settings are stored encrypted and deleted when you uninstall.

## Configure protected branches

Add `.github/force-fence.yml` to a repository:

```yaml
branches:
  - main
  - develop
  - "release/*"
allowed_pushers:
  - release-bot
```

Put the same file in your `.github` repository to set a default for every repository you own. The full guide, with glob rules and ready-made setups, is in [docs/configuration.md](docs/configuration.md).

## Alerts

Every alert is a GitHub issue. You can add Discord and Telegram on the settings page. Install, uninstall, suspend and repository-removed events are alerted the same way.

Each installation gets only its own alerts. No installation ever sees another installation's alerts.

## Self-host

Run your own App and Worker to keep everything under your control, including the settings page and its storage. See [docs/self-hosting.md](docs/self-hosting.md).

## Privacy and data

Force Fence stores nothing and has no database. See [PRIVACY.md](PRIVACY.md).

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE.md](LICENSE.md).
