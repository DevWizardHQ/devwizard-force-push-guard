# Privacy

This page describes the hosted Force Fence GitHub App at https://github.com/apps/force-fence. If you self-host the Worker, none of this applies to you: you control the data, the logs and every integration.

## What the App receives

GitHub sends the App two kinds of webhooks:

- `push` events for repositories where the App is installed: repository name, branch name, commit IDs, and the login of the person who pushed.
- `installation` and `installation_repositories` events: which account installed, uninstalled, suspended or changed the App's repositories.

## What the App reads

- `.github/force-fence.yml` in the pushed repository.
- `.github/force-fence.yml` in the owner's `.github` repository, when the pushed repository has no file.

It does not read your source code or any other file.

## What the App writes

- Branch references: it resets a force-pushed branch to its previous commit, or recreates a deleted branch.
- Issues: it opens an alert issue in the repository that was pushed to.

## Sign-in

The settings page asks you to sign in with GitHub. It verifies that you have admin access to every repository the installation covers. It stores no GitHub token. A short-lived signed cookie keeps you signed in.

## What is stored

Per installation, and only what you enter on the settings page:

- The alert repository name.
- The Discord webhook URL.
- The linked Telegram chats (up to 10). You never type a chat ID. The bot links the chat where you use your one-time code.

These are encrypted and stored in a Cloudflare D1 database. They are deleted when you uninstall the App.

One-time Telegram codes are single use and expire after 10 minutes. Nothing else is stored. There is no database, and no copy of your code, commits or issues. Short-lived GitHub installation tokens are created per event and are not saved.

The hosting provider keeps operational logs for a limited time. They contain request metadata and Worker log lines.

## Alerts

Each installation's alerts go only to that installation's own issue repository, Discord and Telegram. No installation sees another installation's alerts, and alerts are never sent to the maintainers' channels.

## Contact

Questions about privacy: open an issue at https://github.com/DevWizardHQ/force-fence/issues, or use the private reporting link in [SECURITY.md](SECURITY.md) for anything sensitive.
