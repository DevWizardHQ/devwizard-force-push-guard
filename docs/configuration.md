# Configuration

Force Fence reads one file, `.github/force-fence.yml`, to decide which branches to protect and who may force-push them.

## Lookup order

The first file found wins. Files are never merged.

1. `.github/force-fence.yml` in the repository that was pushed to.
2. `.github/force-fence.yml` in the owner's `.github` repository. This is an organization-wide or account-wide default.
3. No file: only the repository's default branch is protected.

Using the `.github` repository fallback needs the App installed on that repository, or that repository to be public.

If a file cannot be parsed, or GitHub fails to return it, Force Fence falls back to protecting only the default branch.

## Keys

```yaml
branches:
  - main
  - develop
  - "release/*"
allowed_pushers:
  - release-bot
```

| Key | Type | Meaning |
|---|---|---|
| `branches` | list of glob patterns | Branch names to protect. Matched against the name without `refs/heads/`. |
| `allowed_pushers` | list of GitHub logins | Users who may force-push or delete protected branches. |

Notes:

- `branches: []` turns protection off for that repository.
- A single string, such as `branches: main`, is accepted as a one-item list.
- Quote any pattern that starts with `*`, because YAML treats a bare `*` specially: `"*-stable"`.
- Tags are not covered.
- The file holds no secrets. Alert repository, Discord and Telegram are set on the settings page, not here.

## Glob rules

- `*` matches any characters except `/`.
- `**` matches any characters, including `/`.
- Everything else is literal and case-sensitive.

| Pattern | Matches | Does not match |
|---|---|---|
| `main` | `main` | `Main`, `main-old` |
| `release/*` | `release/1.2`, `release/next` | `release/1.2/hotfix`, `release` |
| `release/**` | `release/1.2`, `release/1.2/hotfix` | `releases/1.2` |
| `"*-stable"` | `v2-stable`, `lts-stable` | `stable`, `v2/stable` |
| `team-*/release` | `team-a/release` | `team-a/b/release` |
| `team-**/release` | `team-a/release`, `team-a/b/release` | `team/release/x` |

## Which branches to protect

Protect:

- The default branch.
- Long-lived shared branches, such as `develop`, `staging` and release lines like `release/*`.

Do not protect:

- Personal branches.
- Feature branches. People rebase them, and rebasing needs force pushes.

Keep the list short. Every protected branch is one that nobody can rewrite. Two to four patterns cover most teams.

## Ready-made configs

### GitHub flow

One long-lived branch.

```yaml
branches:
  - main
```

### Git flow

```yaml
branches:
  - main
  - develop
  - "release/*"
```

### Trunk with release branches

```yaml
branches:
  - main
  - "release/*"
```

### Monorepo with per-team release branches

```yaml
branches:
  - main
  - "release/**"
```

`release/**` covers `release/payments/2.1` and `release/web/4.0`. If teams use a flat name such as `release/payments-2.1`, `release/*` is enough.

### Organization-wide default with one override

Create `.github/force-fence.yml` in your `.github` repository:

```yaml
branches:
  - main
  - develop
```

Repositories without their own file use this. One repository can override it by adding its own file. The override replaces the default entirely:

```yaml
branches:
  - main
  - "release/*"
```

This repository no longer protects `develop`. List it again if you want it.

### Opt a repository out

```yaml
branches: []
```

### Let a release bot force-push

```yaml
branches:
  - main
allowed_pushers:
  - release-bot
```

Use the GitHub login of the pusher. Keep this list as short as the branch list.

### A deliberate, coordinated force push

Sometimes you really need to rewrite a protected branch, for example to remove a leaked secret.

1. Open a pull request that adds your login to `allowed_pushers`. Get it reviewed and merged.
2. Force-push.
3. Open another pull request that removes your login.

The change stays in review history, and the window stays small.

Adding yourself to `allowed_pushers` raises a "Force Fence config changed" alert, as any edit to the file does. This is expected.

## Safety rules

These rules stop a push from switching off its own protection.

- When the default branch is force-pushed or deleted, Force Fence reads the config as it was at the commit before the push. A push cannot turn off its own revert.
- A normal push to the default branch that adds, edits or removes `.github/force-fence.yml` raises a "Force Fence config changed" alert (an issue, plus Discord and Telegram if connected).
- A brake applies only to pushes by other bots. If a bot rewrites one branch more than 3 times in 10 minutes, Force Fence stops acting on it and alerts "Not reverted ... check it by hand". This prevents a fight with another tool. Force pushes by people are always reverted.
- Rewrite memory: if a branch is force-pushed several times in quick succession, Force Fence restores the commit from before the first rewrite, not an intermediate commit someone pushed in between. It remembers for 10 minutes.
- A push to the default branch with 2048 or more commits raises the "config changed" alert, worded "too many commits to check", because Force Fence cannot tell whether the config file changed.
- A deleted branch that someone already recreated is left alone, and Force Fence alerts you.

These rules have limits. See Known limitations in [SECURITY.md](../SECURITY.md#known-limitations).

## Troubleshooting and FAQ

**My file is not picked up.**
Check that it is at `.github/force-fence.yml` (not `.yaml`) and that the YAML parses. A file that does not parse is ignored and only the default branch is protected. If you rely on the org-wide default, check that the `.github` repository is public or has the App installed.

**My repository file ignores the org default.**
Yes. The first file found wins and files are not merged. Repeat any patterns you still want.

**Are tags protected?**
No. Force Fence only handles branches.

**The branch moved again before Force Fence ran.**
Force Fence does not overwrite newer work. The alert says the branch had moved. Check the branch and restore it yourself if needed.

**I got no alert issue.**
Alerts are GitHub issues. Enable Issues on the repository that receives them: the pushed repository, or the alert repository set on the settings page.

**Where do I set up Discord or Telegram?**
On the settings page, not in this file. See the README for how to reach it.

**How do I connect Telegram?**
On the settings page, click Connect a Telegram chat and use the one-time code in a group, a direct message or a channel. Each installation can connect up to 10 chats, and each can be disconnected on the page. The code works once and expires after 10 minutes. For a channel, add the bot as an admin allowed to post messages, then post the code in the channel.

**Force Fence stopped reverting a branch.**
Another bot rewrote the branch more than 3 times in 10 minutes, so Force Fence left it for you to check by hand. Look for the "Not reverted" alert and find the tool that keeps rewriting the branch. Force pushes by people are always reverted.

**Force Fence reverted my push, but I am in `allowed_pushers`.**
Check the login spelling, and that the file is the one Force Fence finds first (see lookup order).

**Does Force Fence block the push?**
No. GitHub accepts the push first, then Force Fence restores the branch within moments.
