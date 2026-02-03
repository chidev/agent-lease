# Contributing to agent-lease

Thanks for your interest in contributing to agent-lease! This project is part of the [lev-os](https://github.com/lev-os) ecosystem, sponsored by [kinglystudio.ai](https://kinglystudio.ai).

---

## Development Setup

```bash
# Clone the repo
git clone https://github.com/chidev/agent-lease.git
cd agent-lease

# Link globally for local development
npm link

# Verify it works
agent-lease --help
```

---

## Running Tests

All 23 tests must pass before submitting a PR:

```bash
npm test
```

This runs:
- `test/e2e.js` — End-to-end tests covering the full lock/lease/runner cycle in isolated git repos
- `test/stress.js` — Stress tests for concurrent access and edge cases

Tests create temporary git repos, so they are self-contained and safe to run.

---

## Adding Custom Runners

Runners follow a simple contract:

- **Exit 0** = pass
- **Exit 1** = fail
- **stdout** = review text (displayed to user)

### Steps

1. Create your runner script or CLI command
2. Add it to `.agent-lease.json` in the `runners` array:

```json
{
  "name": "my-runner",
  "command": "my-command '{{diff}}'",
  "on": "commit"
}
```

3. Test it: `npx agent-lease release --audit-proof`
4. If contributing a built-in runner, add tests in `test/`

### Available Template Variables

| Variable | Value |
|----------|-------|
| `{{diff}}` | Git diff (staged or origin..HEAD) |
| `{{files}}` | Changed file paths |
| `{{project}}` | Project name |
| `{{branch}}` | Current branch |
| `{{hash}}` | Commit hash |

---

## Project Structure

```
agent-lease/
  bin/           # CLI entry point
  hooks/         # Git hook scripts (pre-commit, pre-push)
  lib/           # Core logic (lock-manager, runner execution)
  test/          # E2E and stress tests
  docs/          # Documentation (article, guide, tweets)
  examples/      # Example configurations
  package.json
  README.md
  LICENSE
```

---

## Submitting Changes

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test` (all 23 must pass)
5. Commit with clear message
6. Open a PR against `main`

### PR Guidelines

- Keep PRs focused (one feature or fix per PR)
- Include tests for new functionality
- Update README.md if adding user-facing features
- Update docs/GUIDE.md if changing agent interaction patterns

---

## Code Style

- Plain JavaScript (no transpilation step)
- No external dependencies (keep it zero-dep)
- XDG compliance for file storage
- Exit codes: 0 = success, 1 = failure

---

## Reporting Issues

File issues at [github.com/chidev/agent-lease/issues](https://github.com/chidev/agent-lease/issues).

Include:
- OS and Node.js version
- agent-lease version (`agent-lease --version`)
- Steps to reproduce
- Expected vs actual behavior

---

## Sponsor

This project is sponsored by [kinglystudio.ai](https://kinglystudio.ai).

Part of the [lev-os](https://github.com/lev-os) ecosystem.

---

## License

MIT
