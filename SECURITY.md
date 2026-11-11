# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| Older   | No        |

## Reporting a vulnerability

Report vulnerabilities privately through GitHub Security Advisories:

https://github.com/DevWizardHQ/force-fence/security/advisories/new

Please do not open a public issue for a security report. Include:

1. What the issue is and its impact.
2. Steps to reproduce, with a proof of concept if you have one.
3. The version or commit, and whether you use the hosted App or a self-hosted Worker.

We will acknowledge your report, investigate, and release a fix before any public disclosure.

## Scope

In scope:

- The Worker code in this repository (`src/`).
- The hosted Force Fence GitHub App and how it handles webhooks, installation tokens and repository data.
- Bypasses of branch protection: a way to force-push or delete a protected branch without it being restored.
- Webhook signature verification and secret handling.

Out of scope:

- Vulnerabilities in GitHub, Cloudflare, Discord or Telegram themselves.
- A self-hosted deployment that was misconfigured, for example a leaked secret or a weak webhook secret.
- Force Fence not covering something it documents as not covered, such as tags.
- Reports that need physical access or social engineering.

## Known limitations

1. If someone force-pushes the default branch with a looser config and another protected branch in the same push, the other branch can be judged by the looser config before the default branch is reverted. The default-branch rewrite is still reverted and alerted.
2. Install Force Fence on the owner's `.github` repository. Otherwise, edits to the org-wide config there raise no "config changed" alert, even though the file is still read when that repository is public.
3. If `.github/force-fence.yml` is a symlink, edits to the file it points to are not detected as config changes.
4. Tags are not protected.

## Handling secrets

Never post webhook secrets, App private keys, bot tokens or Discord webhook URLs in an issue, pull request or discussion. If you leaked one, rotate it first, then tell us.
