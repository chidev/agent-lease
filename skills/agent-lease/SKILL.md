---
name: agent-lease
description: Git hooks that FORCE validation before commits. Setup, manage, and dogfood agent-lease on any project with AI code review runners.
---

# agent-lease - Validation Gate Skill

## Overview

Skill for managing agent-lease validation gates. Implements an FSM that detects project state and routes to appropriate actions. Agent-lease enforces that AI agents prove their work passes validation before commits land.

**Key Differentiator**: Unlike husky/lefthook which run validation *during* commits (and can be forgotten), agent-lease creates a **lock** that persists until validation is explicitly run and passed. No escape. No accidents.

## Installation

### Quick Install

```bash
# Install globally
npm install -g agent-lease

# Or use npx in any project
npx agent-lease init
```

### What `init` Does

1. Installs hooks to `.git/hooks/`:
   - `pre-commit` - Creates lock, blocks until proof exists
   - `pre-push` - Same pattern for push phase
   - `prepare-commit-msg` - Appends trailers with proof hashes

2. Creates `.agent-lease.json` config

3. Creates `.agent-lease/` directory for locks and proofs

4. Adds `.agent-lease/locks/` and `.agent-lease/audit/` to `.gitignore`

### Verify Installation

```bash
npx agent-lease status
npx agent-lease runners
```

---

## State Machine

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AGENT-LEASE FSM                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  DETECT ──────► RECOMMEND ──────► INIT ──────► CONFIGURE                │
│    │                                              │                     │
│    │ (installed?)                                 │                     │
│    ▼                                              ▼                     │
│  ACTIVE ◄────────────────────────────────────────┘                     │
│    │                                                                    │
│    │ (commit attempted)                                                 │
│    ▼                                                                    │
│  BLOCKED ──────► RELEASE ──────► PROOF ──────► COMMIT                   │
│    │                │                                                   │
│    │                │ (validation fails)                                │
│    │                └────────────────────────────► (fix & retry)        │
│    │                                                                    │
│    │ (push attempted)                                                   │
│    ▼                                                                    │
│  BLOCKED_PUSH ─► RELEASE_PUSH ─► PROOF_PUSH ─► PUSH                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Entry Point: Route by argument or auto-detect

```
If argument is "init"      --> go to INIT
If argument is "status"    --> go to ACTIVE
If argument is "release"   --> go to RELEASE
If argument is "dashboard" --> go to DETECT
If no argument             --> go to DETECT
```

---

## State: DETECT

Check if agent-lease is installed and determine current state.

### Detection Logic

1. Check for `.agent-lease.json` in project root
2. Check if `.git/hooks/pre-commit` contains "agent-lease"
3. Check `package.json` for agent-lease dependency

### Detection Commands

```bash
# Check config exists
test -f .agent-lease.json && echo "CONFIG_FOUND" || echo "CONFIG_MISSING"

# Check hooks installed
grep -l "agent-lease" .git/hooks/pre-commit 2>/dev/null && echo "HOOK_FOUND" || echo "HOOK_MISSING"

# Check dependency
grep "agent-lease" package.json 2>/dev/null && echo "DEP_FOUND" || echo "DEP_MISSING"

# Check for active locks
ls $XDG_RUNTIME_DIR/agent-lease/*.lock 2>/dev/null || ls .agent-lease/locks/*.lock 2>/dev/null
```

**Transitions:**
- If installed --> go to **ACTIVE**
- If not installed --> go to **RECOMMEND**

---

## State: RECOMMEND

Scan the project for available validators and recommend configuration.

### Scan Targets

1. **package.json scripts**: `build`, `lint`, `test`, `typecheck`
2. **Config files**: `tsconfig.json`, `.eslintrc*`, `jest.config.*`, `prettier.config.*`
3. **CI configs**: `.github/workflows/`, `.circleci/`, `Jenkinsfile`
4. **Existing hook tools**: `.husky/`, `.lefthook.yml`, `.pre-commit-config.yaml`

### Recommendation Dashboard

```
╔══════════════════════════════════════════════════════════════╗
║  AGENT-LEASE RECOMMENDATIONS                                 ║
╠══════════════════════════════════════════════════════════════╣
║  Project: {name from package.json or dirname}                ║
║  Status: NOT INSTALLED                                       ║
╠──────────────────────────────────────────────────────────────╣
║  Detected validators:                                        ║
║    ✓ build    npm run build         (package.json)           ║
║    ✓ lint     npm run lint          (package.json)           ║
║    ✓ test     npm test              (package.json)           ║
║    ○ typecheck  tsc --noEmit        (tsconfig.json found)    ║
║                                                              ║
╠──────────────────────────────────────────────────────────────╣
║  Recommended .agent-lease.json:                              ║
║  {                                                           ║
║    "runners": [                                              ║
║      { "name": "build", "command": "npm run build" },        ║
║      { "name": "lint", "command": "npm run lint" }           ║
║    ]                                                         ║
║  }                                                           ║
╠──────────────────────────────────────────────────────────────╣
║  Add AI code review? (recommended)                           ║
║  - Claude Haiku (fast):   claude -p 'Review: {{diff}}'       ║
║  - Claude Opus (deep):    claude --model opus 'Review: ...'  ║
║  - Codex:                 codex -q 'Check: {{diff}}'         ║
║  - Ollama (local):        ollama run llama3 'Review: ...'    ║
╚══════════════════════════════════════════════════════════════╝
```

**Transitions:**
- User confirms --> go to **INIT**

---

## State: INIT

Run initialization:

```bash
npx agent-lease init
```

### What Happens

1. Checks for `.git` directory (must be a git repo)
2. Creates `.git/hooks/` if missing
3. Backs up existing hooks to `*.agent-lease-backup`
4. Copies `pre-commit`, `pre-push`, `prepare-commit-msg` hooks
5. Creates `.agent-lease.json` with detected config
6. Creates `.agent-lease/` directory
7. Updates `.gitignore`

**Output:**
```
  ✓ Installed pre-commit
  ✓ Installed pre-push
  ✓ Installed prepare-commit-msg
  ✓ Created .agent-lease.json

╔══════════════════════════════════════════════════════════════╗
║  ✅ agent-lease installed                                    ║
╠══════════════════════════════════════════════════════════════╣
║  Next commit will create a validation gate.                  ║
║  Lock dir: /tmp                                              ║
║  Runners: 2 configured                                       ║
╚══════════════════════════════════════════════════════════════╝
```

**Transitions:**
- Success --> go to **CONFIGURE**

---

## State: CONFIGURE

Write or update `.agent-lease.json` based on recommendations.

### Full Configuration Schema

```json
{
  "projectName": "my-app",
  "lockDir": "auto",
  "runners": [
    { "name": "build", "command": "npm run build", "on": "commit" },
    { "name": "lint", "command": "npm run lint", "on": "commit" },
    { "name": "haiku", "command": "claude -p 'Quick check: {{diff}}'", "on": "commit" },
    { "name": "test", "command": "npm test", "on": "push" },
    { "name": "opus", "command": "claude --model opus -p 'Deep review: {{diff}}'", "on": "push" }
  ],
  "proof": {
    "capture": true,
    "archive": true,
    "retention": {
      "max_age_days": 90,
      "max_count": 500
    }
  },
  "trailers": {
    "proof": "agent-lease-proof",
    "duration": "agent-lease-duration",
    "report": "agent-lease-report"
  }
}
```

### Lock Directory Options

| Value | Location | Use Case |
|-------|----------|----------|
| `"auto"` | `$XDG_RUNTIME_DIR/agent-lease/` or `/tmp` | Default, OS-managed |
| `"local"` | `.agent-lease/locks/` | Project-local (for debugging) |
| `"xdg"` | `$XDG_RUNTIME_DIR/agent-lease/` | Explicit XDG |
| `"/path"` | Any absolute path | Custom location |

### Environment Overrides

```bash
export AGENT_LEASE_LOCK_DIR=/custom/locks
export AGENT_LEASE_PROJECT=my-project
export AGENT_LEASE_RUNNERS="build:npm run build,lint:npm run lint"
```

**Transitions:**
- Config written --> go to **ACTIVE**

---

## State: ACTIVE (Dashboard)

Show current installation status and lock state.

### Status Dashboard

```
╔══════════════════════════════════════════════════════════════╗
║  AGENT-LEASE STATUS                                          ║
╠══════════════════════════════════════════════════════════════╣
║  Installed: YES                                              ║
║  Version: 2.0.0                                              ║
║  Project: my-app                                             ║
║  Lock dir: /var/folders/.../agent-lease                      ║
╠──────────────────────────────────────────────────────────────╣
║  COMMIT PHASE                                                ║
║    Runners: build, lint, haiku                               ║
║    Lock: 🟢 No active lock                                   ║
╠──────────────────────────────────────────────────────────────╣
║  PUSH PHASE                                                  ║
║    Runners: test, opus                                       ║
║    Lock: 🔴 Lock held (validation required)                  ║
║           Created: 2026-02-03T12:00:00Z                      ║
╠──────────────────────────────────────────────────────────────╣
║  Proofs archived: 47                                         ║
║  Last validation: 2026-02-03T11:45:00Z                       ║
╚══════════════════════════════════════════════════════════════╝
```

### Status Commands

```bash
# Full status
npx agent-lease status

# Commit phase only
npx agent-lease status --phase commit

# Push phase only
npx agent-lease status --phase push

# List runners
npx agent-lease runners

# Check proof count
ls .agent-lease/proofs/*.txt 2>/dev/null | wc -l
```

**Transitions:**
- If lock is held --> suggest **RELEASE**

---

## State: BLOCKED

Triggered when git commit is attempted and no valid proof exists.

### What the User Sees

```
╔══════════════════════════════════════════════════════════════╗
║  🔒 AGENT-LEASE: COMMIT BLOCKED                              ║
╠══════════════════════════════════════════════════════════════╣
║  Validation required before commit can proceed.              ║
╚══════════════════════════════════════════════════════════════╝

Lock: /var/folders/.../agent-lease-my-app-abc1234.lock

Run your configured runners to release:
  npx agent-lease release --audit-proof

Then commit again:
  git commit -m "your message"

For AI agents:
  Tell Claude: "release the agent-lease lock"

To bypass (USE SPARINGLY):
  git commit --no-verify
```

### Lock File Contents

```
LOCK_GUID=abc123def456
CREATED=2026-02-03T12:00:00Z
PROJECT=my-app
PHASE=commit
STATUS=PENDING
```

**Transitions:**
- Automatically --> go to **RELEASE**

---

## State: RELEASE

Run validation runners and release the lock.

### Release Command

```bash
# Run commit-phase runners
npx agent-lease release --audit-proof

# Run push-phase runners
npx agent-lease release --audit-proof --phase push

# Attach manual report data
npx agent-lease release --audit-proof --report '{"custom": "data"}'

# Read report from stdin
echo '{"test": "results"}' | npx agent-lease release --audit-proof --report-stdin
```

### What Happens

1. Loads config and finds active lock
2. Filters runners for the target phase
3. Executes runners sequentially (stops on first failure)
4. Captures stdout/stderr as proof
5. Hashes proof (SHA-256, 7 chars)
6. Archives proof to `.agent-lease/proofs/`
7. Writes `AUDIT_PROOF_PASSED` to lock file
8. Writes trailer info to lock file

### Runner Execution Output

```
🔍 Running 3 runner(s) for phase: commit

  ✅ build: npm run build (2.3s)
  ✅ lint: npm run lint (1.1s)
  ✅ haiku: claude -p 'Quick check: {{diff}}' (4.7s)
     No critical issues found. Code looks clean.
     Minor suggestion: Consider adding error handling to line 42.

  Total: 8.1s

✅ All runners passed. commit lock released with audit proof.

Now run your commit again:
  git commit -m "your message"
```

**Transitions:**
- Validation fails --> report errors, suggest fixes, stay in RELEASE
- Validation passes --> go to **PROOF**

---

## State: PROOF

After successful release, display proof summary and archive location.

### Proof Summary Dashboard

```
╔══════════════════════════════════════════════════════════════╗
║  PROOF SUMMARY                                               ║
╠══════════════════════════════════════════════════════════════╣
║  Runner       │ Status │ Duration │ Hash                     ║
║  ─────────────┼────────┼──────────┼────────────────────────  ║
║  build        │ PASS   │ 2.3s     │ a1b2c3d                  ║
║  lint         │ PASS   │ 1.1s     │ e4f5g6h                  ║
║  haiku        │ PASS   │ 4.7s     │ i7j8k9l                  ║
╠──────────────────────────────────────────────────────────────╣
║  Individual proofs:                                          ║
║    .agent-lease/proofs/a1b2c3d.txt                           ║
║    .agent-lease/proofs/e4f5g6h.txt                           ║
║    .agent-lease/proofs/i7j8k9l.txt                           ║
║                                                              ║
║  Consolidated report:                                        ║
║    .agent-lease/proofs/commit-abc1234.json                   ║
╚══════════════════════════════════════════════════════════════╝
```

### Consolidated Report Format

```json
{
  "version": "1.0",
  "timestamp": "2026-02-03T12:00:00Z",
  "phase": "commit",
  "runners": [
    {
      "name": "build",
      "passed": true,
      "duration": 2300,
      "summary": "Build completed successfully",
      "hash": "a1b2c3d"
    },
    {
      "name": "lint",
      "passed": true,
      "duration": 1100,
      "summary": "No lint errors",
      "hash": "e4f5g6h"
    },
    {
      "name": "haiku",
      "passed": true,
      "duration": 4700,
      "summary": "No critical issues found. Code looks clean.",
      "hash": "i7j8k9l"
    }
  ]
}
```

**Transitions:**
- --> go to **COMMIT**

---

## State: COMMIT

Lock released, user can now commit. The `prepare-commit-msg` hook appends trailers.

### Git Trailers Appended

```
feat: add authentication module

Implemented form validation with zod schemas.

agent-lease-proof: build(2.3s):a1b2c3d lint(1.1s):e4f5g6h haiku(4.7s):i7j8k9l
agent-lease-duration: 8.1s
agent-lease-report: commit-abc1234.json
```

### Verifying Proof

```bash
# Extract trailer from commit
git log -1 --format='%(trailers:key=agent-lease-proof)'

# Look up individual proof
cat .agent-lease/proofs/a1b2c3d.txt

# Verify hash
sha256sum .agent-lease/proofs/a1b2c3d.txt | cut -c1-7

# Read consolidated report
cat .agent-lease/proofs/commit-abc1234.json | jq .
```

---

## Adding Runners: AI Code Review Examples

### Claude Code Review (The Killer Feature)

**Model Cascading** - Fast feedback on commit, deep review on push:

```json
{
  "runners": [
    {
      "name": "haiku-quick",
      "command": "claude -p 'Quick bug and security check. Exit 0 if ok, exit 1 if critical issues. Be terse:\n\n{{diff}}'",
      "on": "commit"
    },
    {
      "name": "opus-deep",
      "command": "claude --model opus -p 'Deep code review for correctness, security, performance, and architecture. Exit 1 only for critical issues:\n\n{{diff}}'",
      "on": "push"
    }
  ]
}
```

**Contextual Review** with template variables:

```json
{
  "name": "claude-contextual",
  "command": "claude -p 'Review {{project}} on branch {{branch}}. Files changed: {{files}}. Focus on:\n1. Security vulnerabilities\n2. Logic errors\n3. Performance issues\n\nDiff:\n{{diff}}'",
  "on": "push"
}
```

### OpenAI Codex

```json
{
  "name": "codex-review",
  "command": "codex -q 'Review this code for bugs and security issues. Exit 0 if acceptable, exit 1 if critical issues found:\n\n{{diff}}'",
  "on": "commit"
}
```

### Local Models (Ollama)

```json
{
  "name": "llama-local",
  "command": "echo '{{diff}}' | ollama run codellama 'Review this code diff for issues. Respond with PASS or FAIL followed by explanation.'",
  "on": "commit"
}
```

### Traditional Validators

```json
{
  "runners": [
    { "name": "typecheck", "command": "tsc --noEmit", "on": "commit" },
    { "name": "lint", "command": "eslint src/ --max-warnings=0", "on": "commit" },
    { "name": "format", "command": "prettier --check src/", "on": "commit" },
    { "name": "test", "command": "npm test", "on": "push" },
    { "name": "e2e", "command": "npm run test:e2e", "on": "push" }
  ]
}
```

### Custom Environment Variables

```json
{
  "name": "secure-review",
  "command": "claude -p 'Security audit: {{diff}}'",
  "on": "push",
  "env": {
    "ANTHROPIC_API_KEY": "sk-...",
    "CLAUDE_MODEL": "opus"
  }
}
```

---

## Template Variables

| Variable | Value | Phase Context |
|----------|-------|---------------|
| `{{diff}}` | Staged changes (commit) or `origin/main...HEAD` (push) | Phase-aware |
| `{{files}}` | Space-separated list of changed files | Both |
| `{{project}}` | Project name from config or package.json | Both |
| `{{branch}}` | Current git branch | Both |
| `{{hash}}` | Current commit hash (or "new") | Both |

**Large Diff Handling**: If `{{diff}}` exceeds 100KB, it's passed via stdin instead of inline to avoid shell argument limits.

---

## CLI Reference

```bash
# Install hooks
agent-lease init

# Release lock (run validation)
agent-lease release --audit-proof
agent-lease release --audit-proof --phase push
agent-lease release --audit-proof --report '{"manual": "data"}'

# Check status
agent-lease status
agent-lease status --phase commit
agent-lease status --phase push

# List runners
agent-lease runners

# Clear stale locks
agent-lease clear
agent-lease clear --phase commit
agent-lease clear --phase push

# Help
agent-lease help
```

---

## Project Governance Integration

### CI/CD Pipeline

Agent-lease is designed to complement CI, not replace it:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: |
          # Verify commits have agent-lease trailers
          git log --format='%(trailers:key=agent-lease-proof)' -1 | grep -q . || {
            echo "Warning: Commit missing agent-lease proof"
          }
      - run: npm test
```

### Team Onboarding

```bash
# After cloning a repo with agent-lease
npm install
npx agent-lease init  # Re-installs hooks locally

# Verify setup
npx agent-lease status
```

### Audit Trail Queries

```bash
# All validated commits
git log --grep="agent-lease-proof"

# Commits with specific runner
git log --grep="haiku.*:"

# Validation durations over time
git log --format="%h %s" --grep="agent-lease-duration" | head -20

# Find commits that bypassed (no trailer)
git log --format="%h %s %(trailers:key=agent-lease-proof)" | grep -v "agent-lease-proof:"
```

---

## For AI Agents

When working with an AI coding assistant:

```
Tell Claude: "release the agent-lease lock"
```

### Agent Protocol

1. **Attempt commit** --> hits lock, sees BLOCKED message
2. **Run validation**: `npx agent-lease release --audit-proof`
3. **Fix any failures** --> re-run release
4. **Commit succeeds** with proof trailers

### Agent Benefits

- Agent thinks "oh shit, forgot to build" **for you**
- No more "CI failed" surprises
- AI review catches issues before human review
- Audit trail proves agent ran validation

---

## Proof Protocol Reference

See `references/proof-protocol.md` for complete specification of:

- Proof capture mechanism
- SHA-256 hashing (7-char truncation)
- Archive storage format
- Consolidated report JSON schema
- Verification procedures
- Retention policies
- Security properties

---

## Integration with skills.sh

```bash
npx skills add chidev/agent-lease
```
