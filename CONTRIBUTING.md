# Contributing

Contributions and issues are welcome. For anything larger than a fix, open an issue first.

## Build and test

There is no build step, no npm dependencies and no test suite. Node.js 22 or newer.

```sh
for f in index.js lib/*.js hooks/*.js; do node --check "$f" || exit 1; done
node -e "import('./index.js').then(m => console.log(m.default.id))"
```

To try a change, install the checkout as an OpenClaw extension (see [README.md](README.md)) next to a
running MemOS API and watch the gateway log for lines prefixed `[MEMOS]`.

## Pull requests

- Branch from `main`, one concern per pull request.
- Use Conventional Commits as in the history (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`).
- Hooks must stay non-fatal when MemOS is down.
- When behaviour or a default changes, update the configuration section of [README.md](README.md),
  the manifest and add an entry to [CHANGELOG.md](CHANGELOG.md).
- Never commit secrets or tokens; report vulnerabilities as described in [SECURITY.md](SECURITY.md).
- Add new documents to [docs/INDEX.md](docs/INDEX.md).
