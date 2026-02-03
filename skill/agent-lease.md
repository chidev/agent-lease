# agent-lease Skill

Claude skill for interacting with the agent-lease v2 git hook system. Enables automatic lock detection, validation with pluggable runners, and release workflows.

## Overview

agent-lease v2 is a git hook system that forces validation before commits/pushes using pluggable runners. Claude uses this skill to:
- Detect when commits/pushes are blocked by agent-lease locks
- Run configured runners (build, lint, AI review, tests)
- Handle commit-phase vs push-phase validation
- Initialize hooks on new projects
- Manage stale lock cleanup

**Key v2 features:**
- Pluggable runners (any CLI with exit 0/1 contract)
- Template variables: `{{diff}}`, `{{files}}`, `{{project}}`, `{{branch}}`, `{{hash}}`
- Agentic runners: pipe diffs to Claude, Codex, Ollama
- Model cascading: fast models on commit, thorough models on push
- Phase support: separate commit and push runners
- XDG-compliant lock storage
- Env var overrides

## Detection

### Check for agent-lease Configuration

```bash
# Check if project uses agent-lease
ls -la /path/to/project/.agent-lease.json

# Check for active lock files (location varies by config)
# Default XDG location:
ls $XDG_RUNTIME_DIR/agent-lease/*.lock 2>/dev/null
# Fallback /tmp:
ls /tmp/agent-lease-*.lock 2>/dev/null
# Local locks:
ls /path/to/project/.agent-lease/locks/*.lock 2>/dev/null
```

When config file exists, agent-lease is installed. When lock file exists, a commit/push is in progress.

### Lock State

```bash
# Check current lock status
npx agent-lease status
```

Returns lock holder, timestamp, and audit proof status.

## Commands

### Initialize agent-lease on New Project

```bash
cd /path/to/project
npx agent-lease init
```

Installs git pre-commit and pre-push hooks. Creates `.agent-lease.json` config in project root.

### Release Lock with Validation (Commit Phase)

```bash
npx agent-lease release --audit-proof
```

Runs commit-phase runners (those with `"on": "commit"` or `"on": "both"`).

**What it runs:**
- Build commands (tsc, webpack, etc.)
- Linters (eslint, prettier)
- Fast AI reviews (haiku, gpt-3.5)
- Any runner configured with `"on": "commit"`

**Outcomes:**
- ✅ All runners pass → Lock released, ready to commit
- ❌ Any runner fails → Reports errors, lock remains held, must fix and retry

### Release Lock with Validation (Push Phase)

```bash
npx agent-lease release --audit-proof --phase push
```

Runs push-phase runners (those with `"on": "push"` or `"on": "both"`).

**What it runs:**
- Test suites (jest, mocha, etc.)
- Deep AI reviews (opus, gpt-4)
- Integration tests
- Security scans
- Any runner configured with `"on": "push"`

### List Configured Runners

```bash
npx agent-lease runners
```

Shows all configured runners, their commands, phases, and template variables available.

### Check Lock State

```bash
npx agent-lease status
```

Shows:
- Lock file location
- Lock phase (commit or push)
- Lock timestamp
- Project name
- Time elapsed since lock acquired

### Clear Stale Locks

```bash
npx agent-lease clear
```

Removes lock files that are orphaned or stale.

Use when:
- Agent process crashed and didn't clean up
- Lock file exists but git operation isn't blocked
- Want to reset lock state

## When to Auto-Trigger

### Blocked Commit Detection

When git push/commit fails with:
```
COMMIT BLOCKED: agent-lease lock held
```

Auto-recognize this as agent-lease block and offer to release.

### User Requests

Trigger when user says:
- "release the lock" or "release agent-lease"
- "unlock this" or "clear the lock"
- "install agent-lease" or "setup git hooks"
- "check the lock" or "what's the lock status"

### Workflow Detection

Trigger when:
- Commit fails → Check `npx agent-lease status`
- Multiple failed commits → Suggest `npx agent-lease clear`
- New project setup → Ask about initializing agent-lease

## Workflow: Blocked Commit Recovery

When user encounters a blocked commit:

1. **Recognize the block**
   ```bash
   # Git output shows: COMMIT BLOCKED: agent-lease lock held
   # → This is an agent-lease block, not a regular git error
   ```

2. **Check lock status**
   ```bash
   npx agent-lease status
   ```

3. **Attempt release with validation**
   ```bash
   npx agent-lease release --audit-proof
   ```

4. **Handle validation failure**
   - If fails: Report validation errors, ask user to fix
   - If passes: Lock released

5. **Retry commit**
   ```bash
   git commit -m "message"
   ```

## Example Interactions

### Example 1: User Commits, Gets Blocked, Claude Auto-Releases

**User runs:**
```bash
git commit -m "Fix: update agent adapter"
```

**Git output:**
```
COMMIT BLOCKED: agent-lease lock created
Run: npx agent-lease release --audit-proof
```

**Claude detects block and:**
1. Recognizes agent-lease lock message
2. Runs `npx agent-lease status` → Shows lock phase and timestamp
3. Runs `npx agent-lease release --audit-proof`
4. ✅ Validation passes:
   ```
   ✅ build: npm run build (2.1s)
   ✅ lint: eslint src/ (1.3s)
   ✅ haiku-review: claude quick check (3.2s)
   ```
5. Offers to retry: `git commit -m "Fix: update agent adapter"`

---

### Example 2: User Pushes, Gets Blocked, Claude Runs Push-Phase Runners

**User runs:**
```bash
git push
```

**Git output:**
```
PUSH BLOCKED: agent-lease lock created
Run: npx agent-lease release --audit-proof --phase push
```

**Claude detects block and:**
1. Recognizes push-phase lock
2. Runs `npx agent-lease release --audit-proof --phase push`
3. ✅ Validation passes:
   ```
   ✅ test: npm test (8.4s)
   ✅ opus-review: claude deep review (12.1s)

   Review summary from opus:
   - Auth logic handles edge cases correctly
   - No security issues detected
   - Suggests adding error boundary for user input validation
   ```
4. Offers to retry: `git push`

---

### Example 3: User Asks to Install agent-lease with AI Review

**User says:**
```
"Install agent-lease hooks with Claude review on this project"
```

**Claude:**
1. Checks for existing `.agent-lease.json` → Not found
2. Runs `npx agent-lease init`
3. Creates config with AI review:
```json
{
  "runners": [
    { "name": "build", "command": "npm run build", "on": "commit" },
    { "name": "lint", "command": "npm run lint", "on": "commit" },
    { "name": "haiku", "command": "claude -p 'Quick bug check: {{diff}}'", "on": "commit" },
    { "name": "opus", "command": "claude --model opus -p 'Deep review: {{diff}}'", "on": "push" }
  ]
}
```
4. Confirms: "agent-lease initialized with:
   - Commit phase: build + lint + haiku review
   - Push phase: opus deep review
   Ready to use."

---

### Example 4: User Checks/Clears Stale Locks

**User says:**
```
"What's the lock status? There might be a stale lock from earlier."
```

**Claude:**
1. Runs `npx agent-lease status`
   ```
   Lock file: /tmp/agent-lease-my-project.lock
   Phase: commit
   Age: 2 hours
   ```

2. Suggests clearing: "Lock is stale (2 hours old). Running clear..."
3. Runs `npx agent-lease clear`
4. Confirms: "Stale lock cleared. Project is unlocked."

## Integration with Git Workflow

When used with Claude Code team mode:

- **Team lead** can check lock status before assigning tasks
- **Workers** auto-trigger release when commits/pushes are blocked
- **QA** validates runner output (especially AI review results) before merging

Use with validation gates:
```bash
# Commit gate (fast checks)
npx agent-lease release --audit-proof

# Push gate (thorough checks)
npx agent-lease release --audit-proof --phase push
```

### Model Cascading Workflow

**Optimal pattern for AI-assisted development:**

```
Commit → Fast AI (haiku) + build + lint
  ↓
  Catches obvious bugs, takes ~5 seconds
  ↓
Push → Slow AI (opus) + tests
  ↓
  Deep review, catches subtle issues, takes ~15 seconds
  ↓
CI → Full test suite + deploy
```

This gives constant AI review without slowing down the commit loop.

## Troubleshooting

| Issue | Check | Fix |
|-------|-------|-----|
| Lock won't release | `npx agent-lease status` | If stale: `npx agent-lease clear` |
| Runner fails | Review error output | Fix reported issues, retry release |
| Command not found | `npm list agent-lease` | Install: `npm install -g agent-lease` |
| Permission denied | `ls -la $XDG_RUNTIME_DIR/agent-lease/` | Check file ownership |
| AI runner slow | Check model size | Use haiku/gpt-3.5 on commit, opus/gpt-4 on push |
| Template var empty | `git diff --cached` | Ensure files are staged |

## Files & Paths

| Location | Purpose |
|----------|---------|
| `.agent-lease.json` | Project config (version controlled) |
| `$XDG_RUNTIME_DIR/agent-lease/*.lock` | Active lock files (XDG mode) |
| `/tmp/agent-lease-*.lock` | Active lock files (fallback) |
| `.agent-lease/locks/*.lock` | Active lock files (local mode) |
| `.git/hooks/pre-commit` | Commit hook installed by init |
| `.git/hooks/pre-push` | Push hook installed by init |

## Related Concepts

- **Runner**: Any CLI command with exit 0/1 contract
- **Phase**: When runner executes (commit, push, both)
- **Template variable**: Placeholder in command string replaced with git context
- **Agentic runner**: Runner that pipes diff to an LLM CLI for AI code review
- **Model cascading**: Using fast models on commit, thorough models on push
- **Lock holder**: Process currently holding lock (commit or push operation)
- **Audit proof**: Validation that all runners passed
- **Stale lock**: Lock from crashed process or very old operation

## Advanced: Creating Custom Agentic Runners

Any CLI that accepts stdin/args and returns exit 0/1 can be a runner.

### Custom Claude Wrapper

```bash
#!/bin/bash
# ~/.local/bin/claude-review

DIFF="$1"
PROMPT="Review this diff for bugs, security issues, and code quality:

$DIFF

Return exit 0 if no issues, exit 1 if issues found."

OUTPUT=$(claude -p "$PROMPT")
echo "$OUTPUT"

# Parse output for issues
if echo "$OUTPUT" | grep -qi "issue\|bug\|problem\|error"; then
  exit 1
else
  exit 0
fi
```

**Use in config:**
```json
{
  "name": "custom-review",
  "command": "claude-review '{{diff}}'",
  "on": "commit"
}
```

### Multi-Model Consensus

```bash
#!/bin/bash
# ~/.local/bin/consensus-review

DIFF="$1"

# Ask 3 models
HAIKU=$(claude -p "Review: $DIFF")
GPT=$(openai -p "Review: $DIFF")
LLAMA=$(ollama run llama3 "Review: $DIFF")

# If 2+ flag issues, fail
ISSUES=0
echo "$HAIKU" | grep -qi "issue" && ((ISSUES++))
echo "$GPT" | grep -qi "issue" && ((ISSUES++))
echo "$LLAMA" | grep -qi "issue" && ((ISSUES++))

if [ $ISSUES -ge 2 ]; then
  echo "Multiple models flagged issues:"
  echo "Haiku: $HAIKU"
  echo "GPT: $GPT"
  echo "Llama: $LLAMA"
  exit 1
fi

exit 0
```

**Use in config:**
```json
{
  "name": "consensus",
  "command": "consensus-review '{{diff}}'",
  "on": "push"
}
```
