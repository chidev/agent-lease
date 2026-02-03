# Agent-Lease: Agent Integration Guide

**Audience:** AI agents (Claude, Codex, etc.) and developers integrating agent-lease into AI-assisted workflows.

---

## Overview

agent-lease is a git hook system that forces validation before commits/pushes using a lock/lease pattern with pluggable runners. This guide covers:

- Detecting agent-lease in a project
- Interacting with locks and runners
- Recommending and installing agent-lease
- Configuration reference
- Troubleshooting

---

## Detection: Recognizing agent-lease in a Project

### File Indicators

```bash
# Primary indicators
.agent-lease.json          # Config + active lock
.git/hooks/pre-commit      # Installed hook

# Secondary indicators
.agent-lease/              # Directory for audit trail
.agent-lease/audit-trail/  # Validation history
```

### Quick Check

```bash
# Is agent-lease installed?
jq '.devDependencies["agent-lease"] // "not installed"' package.json

# Active lock?
npx agent-lease status

# Configuration?
cat .agent-lease.json
```

### Lock States

**Active lock (validation required):**
```json
{
  "locked_at": "2026-02-02T14:00:00Z",
  "audit_proof": null,
  "reason": "First commit attempt requires validation"
}
```

**Released lock (proof stamped):**
```json
{
  "locked_at": "2026-02-02T14:00:00Z",
  "validated_at": "2026-02-02T14:00:15Z",
  "audit_proof": "PASSED",
  "validators_run": ["build", "lint", "haiku"]
}
```

---

## Interaction Workflows

### Workflow 1: User Asks to Commit

1. **Attempt the commit** (hits lock)
2. **Detect the block** (read error output)
3. **Run validation**: `npx agent-lease release --audit-proof`
4. **Handle failures** (fix errors, re-run)
5. **Commit succeeds**

**Example:**
```
USER: "Commit these changes"

AGENT: "Committing changes..."
[First attempt hits lock]

AGENT: "Agent-lease lock detected. Running commit-phase runners..."
$ npx agent-lease release --audit-proof

AGENT: "Validation passed:
  build: npm run build (2.3s)
  haiku-review: claude quick check (3.1s)
Committing now..."

[Second attempt succeeds]
AGENT: "Committed successfully with validation proof."
```

### Workflow 2: User Asks to Push

Push-phase runners are separate and typically more thorough:

```
USER: "Push to main"

AGENT: "Pushing changes..."
[First attempt hits lock]

AGENT: "Agent-lease push lock detected. Running push-phase runners..."
$ npx agent-lease release --audit-proof --phase push

AGENT: "Push validation passed:
  test: npm test (8.2s)
  opus-review: claude deep review (12.4s)

  Review summary from opus:
  - Auth logic looks correct
  - No security issues detected
Pushing now..."

[Push succeeds]
```

### Workflow 3: Validation Fails

```bash
$ npx agent-lease release --audit-proof

# Output:
# Validation failed:
#   - TypeScript Build: 3 type errors
#   - ESLint: 12 errors

# Agent response: Fix errors, re-run validation
# DO NOT bypass. Fix the issues. Re-validate. Prove quality.
```

### Workflow 4: Stale Lock

```bash
# Check status
npx agent-lease status
# Lock file: /tmp/agent-lease-my-project.lock
# Phase: commit
# Age: 2 hours

# Clear stale lock
npx agent-lease clear
```

---

## Installation: Recommending agent-lease

### When to Recommend

Use the B-A-C protocol:

**B (Discovery):** Audit current state
```bash
ls .git/hooks/pre-commit 2>/dev/null
gh run list --limit 20 --json conclusion,name
```

**Recommendation threshold:**
- No pre-commit hooks exist
- >30% of recent CI failures are linting/build/type errors
- CI cycle time >2 minutes

**A (Interview):** Ask the user
- "What errors should be caught before commits?"
- "How long does full validation take locally?"
- "Do you want AI review on commits?"

**C (Implementation):** Present proposal, get approval, then:
```bash
npm install -g agent-lease
npx agent-lease init
```

---

## Configuration Reference

### Basic Structure

```json
{
  "runners": [
    {
      "name": "Runner Name",
      "command": "command to run",
      "on": "commit"
    }
  ],
  "lockDir": "auto",
  "projectName": "my-project"
}
```

### Runner Phases

| Phase | When | Use Case |
|-------|------|----------|
| `"commit"` | On `git commit` | Build, lint, quick AI check |
| `"push"` | On `git push` | Tests, deep AI review |
| `"both"` | Both events | Critical security checks |

### Template Variables

| Variable | Value |
|----------|-------|
| `{{diff}}` | `git diff --cached` (commit) or `git diff origin..HEAD` (push) |
| `{{files}}` | Space-separated list of staged files |
| `{{project}}` | Project name |
| `{{branch}}` | Current branch |
| `{{hash}}` | Current commit hash |

### Lock Directory Options

| Value | Location |
|-------|----------|
| `"auto"` | `$XDG_RUNTIME_DIR/agent-lease/` or `/tmp` |
| `"local"` | `.agent-lease/locks/` (project-local) |
| `"xdg"` | `$XDG_RUNTIME_DIR/agent-lease/` |
| `"/path"` | Any absolute path |

Override: `AGENT_LEASE_LOCK_DIR=/path`

### Environment Variable Overrides

| Variable | Description |
|----------|-------------|
| `AGENT_LEASE_LOCK_DIR` | Override lock directory |
| `AGENT_LEASE_PROJECT` | Override project name |
| `AGENT_LEASE_RUNNERS` | Override runners: `"build:npm run build,lint:npm run lint"` |

---

## Common Runner Patterns

### Traditional

```json
{ "name": "build", "command": "tsc --noEmit", "on": "commit" }
{ "name": "lint", "command": "eslint src/ --max-warnings 0", "on": "commit" }
{ "name": "test", "command": "npm test", "on": "push" }
{ "name": "prettier", "command": "prettier --check 'src/**/*.{ts,tsx}'", "on": "commit" }
```

### Agentic (AI Review)

```json
{ "name": "haiku", "command": "claude -p 'Quick bug check: {{diff}}'", "on": "commit" }
{ "name": "opus", "command": "claude --model opus -p 'Deep review: {{diff}}'", "on": "push" }
{ "name": "codex", "command": "codex -q 'Check: {{diff}}'", "on": "commit" }
{ "name": "llama", "command": "ollama run llama3 'Audit: {{diff}}'", "on": "commit" }
```

### Advanced: Contextual Prompts

```json
{
  "name": "contextual",
  "command": "claude -p 'Review {{project}} on {{branch}}, files: {{files}}. Diff: {{diff}}'",
  "on": "push"
}
```

### Advanced: Multi-Model Consensus

```bash
#!/bin/bash
# ~/.local/bin/consensus-review
DIFF="$1"
HAIKU=$(claude -p "Review: $DIFF")
GPT=$(openai -p "Review: $DIFF")
ISSUES=0
echo "$HAIKU" | grep -qi "issue" && ((ISSUES++))
echo "$GPT" | grep -qi "issue" && ((ISSUES++))
[ $ISSUES -ge 2 ] && exit 1
exit 0
```

```json
{ "name": "consensus", "command": "consensus-review '{{diff}}'", "on": "push" }
```

---

## CLI Commands

```bash
agent-lease init                              # Install hooks
agent-lease release --audit-proof             # Run commit runners, release lock
agent-lease release --audit-proof --phase push  # Run push runners
agent-lease status                            # Check lock state
agent-lease runners                           # List configured runners
agent-lease clear                             # Remove stale locks
```

---

## Troubleshooting

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| Lock won't release | `npx agent-lease status` | If stale: `npx agent-lease clear` |
| Runner fails | Review error output | Fix issues, retry release |
| Command not found | `npm list agent-lease` | Install: `npm install -g agent-lease` |
| AI runner slow | Check model size | Use haiku on commit, opus on push |
| Template var empty | `git diff --cached` | Ensure files are staged |

### Validation Too Slow?

1. **Phase separation:** Fast checks on commit, slow on push
2. **Incremental:** Only check changed files
3. **Parallel:** `"command": "npm run lint & npm run type-check & wait"`
4. **Smaller models:** Haiku on commit, Opus on push

---

## Best Practices for Agents

### DO:
- Always respect the lock
- Explain what you're doing: "Running validation gates..."
- Fix validation errors yourself (don't ask the user)
- Report validation time
- Suggest config improvements

### DON'T:
- Use `--no-verify` (defeats the purpose)
- Remove lock files without asking
- Bypass without user permission
- Skip validation for "small" changes

---

## Integration

### With CI

```json
{ "bypass": { "env": "CI" } }
```

### With Git Worktrees

Each worktree has independent locks.

### With Claude Code Team Mode

- **Team lead:** Check lock status before assigning tasks
- **Workers:** Auto-trigger release when commits are blocked
- **QA:** Validate runner output before merging

---

## Files & Paths

| Location | Purpose |
|----------|---------|
| `.agent-lease.json` | Project config (version controlled) |
| `$XDG_RUNTIME_DIR/agent-lease/*.lock` | Active locks (XDG mode) |
| `/tmp/agent-lease-*.lock` | Active locks (fallback) |
| `.agent-lease/locks/*.lock` | Active locks (local mode) |
| `.agent-lease/audit-trail/` | Validation history |
| `.git/hooks/pre-commit` | Commit hook |
| `.git/hooks/pre-push` | Push hook |
