# Contributing

Thanks for helping improve Force Fence. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Setup

You need Node.js 24 or later. The tests use `node:sqlite`.

```bash
git clone https://github.com/DevWizardHQ/force-fence.git
cd force-fence
npm ci
```

## Tests

```bash
npm test
```

Tests use the built-in Node test runner and need no network access or credentials. Add or update a test for every behavior change.

## Style

- Plain JavaScript, ES modules. Keep the dependency list short.
- No inline comments unless they explain a non-obvious reason why. Prefer clear names over comments.
- Update the docs in `docs/` when behavior or configuration changes.

## Commits and pull requests

1. Fork the repository and create a branch from `main`.
2. Make focused commits that follow [Conventional Commits](https://www.conventionalcommits.org/), for example `fix: keep tags out of protection` or `feat: support nested globs`.
3. Run `npm test`.
4. Open a pull request against `main` and fill in the template. CI must pass.

## Testing against a real repository

Use a throwaway repository, never one you care about.

1. Follow [docs/self-hosting.md](docs/self-hosting.md) to run your own App and Worker, and install it on the throwaway repository.
2. Add `.github/force-fence.yml` with a branch such as `main` or `scratch`.
3. Force-push or delete that branch and confirm it is restored and an alert issue is opened.
4. Remove the repository and rotate any secrets you used when you are done.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
