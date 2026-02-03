# agent-lease

**Git hooks that FORCE validation before commits.** No broken code reaches CI.

Unlike husky or lefthook which *run* validation, agent-lease creates a **gate** that blocks commits until you prove validation passed. The "oh shit, forgot to build" pattern solved.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. git commit -m "my changes"                              │
│     ↓                                                       │
│  2. pre-commit hook creates LOCK file                       │
│     ↓                                                       │
│  3. ❌ COMMIT BLOCKED - "run validation first"              │
│     ↓                                                       │
│  4. npx agent-lease release --audit-proof                   │
│     ↓                                                       │
│  5. Runs configured runners (build, lint, AI review...)     │
│     ↓                                                       │
│  6. ✅ Lock stamped with AUDIT_PROOF_PASSED                 │
│     ↓                                                       │
│  7. git commit -m "my changes"                              │
│     ↓                                                       │
│  8. ✅ Commit succeeds, lock cleaned up                     │
└─────────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Global install
npm install -g agent-lease

# Or per-project
npm install --save-dev agent-lease

# Setup hooks
npx agent-lease init
```

## Runners

Runners are any CLI commands with a simple contract: **exit 0 = pass, exit 1 = fail, stdout = review text.**

This makes agent-lease extensible — plug in build tools, linters, or AI code review.

### Traditional Runners

```json
{
  "runners": [
    { "name": "build", "command": "npm run build", "on": "commit" },
    { "name": "lint", "command": "npm run lint", "on": "commit" },
    { "name": "test", "command": "npm test", "on": "push" }
  ]
}
```

### Agentic Runners (AI Code Review)

Pipe your diff into any LLM CLI. Smaller models on commit, larger models on push.

```json
{
  "runners": [
    { "name": "build", "command": "npm run build", "on": "commit" },
    { "name": "haiku-review", "command": "claude -p 'Quick check for bugs: {{diff}}'", "on": "commit" },
    { "name": "opus-review", "command": "claude -p --model opus 'Deep review for security and correctness: {{diff}}'", "on": "push" },
    { "name": "codex-review", "command": "codex -q 'Check: {{diff}}'", "on": "push" }
  ]
}
```

### Template Variables

Commands can use these variables:

| Variable | Value |
|----------|-------|
| `{{diff}}` | `git diff --cached` (commit) or `git diff origin..HEAD` (push) |
| `{{files}}` | Space-separated list of staged files |
| `{{project}}` | Project name |
| `{{branch}}` | Current branch |
| `{{hash}}` | Current commit hash |

### Runner Phases

| Phase | When | Use Case |
|-------|------|----------|
| `commit` | On `git commit` | Build, lint, quick AI check |
| `push` | On `git push` | Tests, deep AI review |
| `both` | Both events | Critical checks |

## Lock Storage (XDG-compliant)

```json
{ "lockDir": "auto" }
```

| Value | Location |
|-------|----------|
| `"auto"` | `$XDG_RUNTIME_DIR/agent-lease/` if available, else `/tmp` |
| `"local"` | `.agent-lease/locks/` (project-local) |
| `"xdg"` | `$XDG_RUNTIME_DIR/agent-lease/` |
| `"/custom/path"` | Any absolute path |

Override with env var: `AGENT_LEASE_LOCK_DIR=/path`

## Environment Variables

All config can be overridden via env vars:

| Variable | Description |
|----------|-------------|
| `AGENT_LEASE_LOCK_DIR` | Override lock directory |
| `AGENT_LEASE_PROJECT` | Override project name |
| `AGENT_LEASE_RUNNERS` | Override runners: `"build:npm run build,lint:npm run lint"` |

## Configuration

`.agent-lease.json`:

```json
{
  "runners": [
    { "name": "build", "command": "npm run build", "on": "commit" },
    { "name": "lint", "command": "npm run lint", "on": "commit" },
    { "name": "review", "command": "claude -p 'Review: {{diff}}'", "on": "push" }
  ],
  "lockDir": "auto",
  "projectName": "my-project"
}
```

Legacy format still works:

```json
{
  "validation": {
    "build": "npm run build",
    "lint": "npm run lint"
  }
}
```

## CLI Commands

```bash
agent-lease init              # Install hooks
agent-lease release --audit-proof   # Run runners + release lock
agent-lease release --audit-proof --phase push  # Run push runners
agent-lease status            # Check lock state
agent-lease runners           # List configured runners
agent-lease clear             # Remove stale locks
```

## For AI Agents

When working with an AI coding assistant:

```
Tell Claude: "release the agent-lease lock"
```

The agent runs `npx agent-lease release --audit-proof`, fixes any failures, then commits again. The agent thinks "oh shit, forgot to build" **for you**.

### Model Cascading Pattern

Use fast/cheap models for commit-time checks, powerful models for push-time review:

```
commit → haiku reviews diff (fast, catches obvious issues)
push   → opus reviews diff (thorough, catches subtle bugs)
```

This gives you constant AI review without slowing down development.

## Testing

```bash
node test/e2e.js
```

Runs 11 E2E tests covering the full lock/lease/runner cycle in an isolated git repo.

## Why Lock/Lease?

Other git hook tools run validation *during* the commit. agent-lease is different:

1. **First commit creates a lock** and blocks
2. **You must explicitly run validation** to release
3. **Second commit checks for proof** and proceeds

This forces the validation step. No accidents. No "I'll fix it later."

## License

MIT
