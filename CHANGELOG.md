# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-11

### Added

- Per-repository protected branches in `.github/force-fence.yml`, with glob patterns (`*` and `**`) and an `allowed_pushers` list.
- Organization-wide default: the same file in the owner's `.github` repository is used when a repository has none.
- Settings page for each installation, opened after install and from Configure. It uses GitHub sign-in and is limited to people with admin access to every repository the installation covers (installations over 3000 repositories cannot be managed on the page). Settings are encrypted in Cloudflare D1 and deleted on uninstall.
- Per-installation alert repository and Discord webhook, plus a test alert.
- Telegram alerts through the `@ForceFenceBot` bot: up to 10 chats per installation, connected with a single-use code (valid 10 minutes) in a group, a direct message or a channel, and disconnected individually.
- Alerts when the App is uninstalled, suspended or loses repositories, sent to that installation's own channels.
- Runtime lookup of the App's bot login, so the Worker ignores its own reverts without configuration.
- User guide, self-hosting guide, privacy policy, security policy and contributor documentation.

- Safety rules: the config is read as it was before a default-branch rewrite, a "config changed" alert on normal pushes that edit the file, a brake after 3 rewrites of one branch by other bots in 10 minutes (force pushes by people are always reverted), rewrite memory that restores the commit from before the first of several quick rewrites, and no action on a deleted branch that someone already recreated.

### Changed

- Project renamed to Force Fence.
- Without a config file, only the repository's default branch is protected.
- Alert issues open in the pushed repository unless an alert repository is set on the settings page.
- Discord and Telegram are configured only on the settings page, for hosted and self-hosted deployments alike.

### Removed

- The `PROTECTED_REFS`, `ALLOWED_PUSHERS` and `APP_BOT_LOGIN` environment variables. Use `.github/force-fence.yml` instead.
- The `ALERT_REPO`, `DISCORD_WEBHOOK_URL` and `TELEGRAM_CHAT_ID` environment variables. Use the settings page instead.
