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
│  5. Runs: npm run build && npm run lint                     │
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

This creates:
- `.git/hooks/pre-commit` - The validation gate
- `.git/hooks/pre-push` - Optional upstream protection
- `.agent-lease.json` - Configuration

## Usage

### Normal workflow

```bash
# Make changes...
git add .

# First commit attempt - blocked, lock created
git commit -m "my feature"
# ❌ COMMIT BLOCKED - Validation required

# Run validation
npx agent-lease release --audit-proof
# ✅ build passed
# ✅ lint passed
# Lock released with audit proof

# Second commit attempt - passes
git commit -m "my feature"
# ✅ Commit allowed
```

### Check status

```bash
npx agent-lease status
# 🔴 Lock exists. Validation required before commit.
```

### Clear stale locks

```bash
npx agent-lease clear
# Cleared 1 lock(s)
```

### Bypass (emergencies only)

```bash
git commit --no-verify
```

## Configuration

`.agent-lease.json`:

```json
{
  "validation": {
    "build": "npm run build",
    "lint": "npm run lint"
  },
  "lockDir": "/tmp",
  "projectName": "my-project",
  "blockedRemotes": "upstream"
}
```

### Options

| Key | Default | Description |
|-----|---------|-------------|
| `validation.build` | `npm run build` | Build command |
| `validation.lint` | `npm run lint` | Lint command |
| `validation.test` | (none) | Optional test command |
| `lockDir` | `/tmp` | Where lock files live |
| `projectName` | from package.json | Lock file prefix |
| `blockedRemotes` | `upstream` | Remotes to block pushes to |

## For AI Agents (Claude, Cursor, etc.)

When working with an AI coding assistant:

```
Tell Claude: "release the agent-lease lock"
```

The agent will run:
```bash
npx agent-lease release --audit-proof
```

Then commit again.

## Why Lock/Lease?

Other git hook tools run validation *during* the commit. If you forget to run them, broken code goes through.

agent-lease is different:
1. **First commit creates a lock** and blocks
2. **You must explicitly run validation** to release
3. **Second commit checks for proof** and proceeds

This forces the validation step. No accidents.

## Lock Files

Locks are stored in `/tmp` by default:
```
/tmp/agent-lease-my-project-abc123.lock
```

Contents:
```
LOCK_GUID=abc123def
CREATED=2026-02-02T20:00:00Z
PROJECT=my-project
STATUS=PENDING
AUDIT_PROOF_PASSED=2026-02-02T20:01:00Z  # Added after validation
```

## License

MIT
