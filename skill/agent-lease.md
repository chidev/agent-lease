# agent-lease Skill

Claude skill for interacting with the agent-lease git hook system. Enables automatic lock detection, validation, and release workflows.

## Overview

agent-lease is a git hook system that prevents concurrent agent modifications to a project. Claude uses this skill to:
- Detect when commits are blocked by agent-lease locks
- Run validation and release procedures
- Initialize hooks on new projects
- Manage stale lock cleanup

## Detection

### Check for agent-lease Configuration

```bash
# Check if project uses agent-lease
ls -la /path/to/project/.agent-lease.json

# Check for active lock files
ls /tmp/agent-lease-*.lock 2>/dev/null
```

When either file exists, agent-lease is active on the project.

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

Installs git pre-commit hooks. Creates `.agent-lease.json` config in project root.

### Release Lock with Validation

```bash
npx agent-lease release --audit-proof
```

Runs validation checks and releases the lock. Proof must pass before release completes.

**What it validates:**
- No uncommitted changes outside lock scope
- Audit trail is consistent
- Proof signatures are valid

**Outcomes:**
- ✅ Passes → Lock released, ready to commit
- ❌ Fails → Reports validation errors, lock remains held

### Check Lock State

```bash
npx agent-lease status
```

Shows:
- Lock holder (agent ID or username)
- Lock timestamp
- Time elapsed since lock acquired
- Audit proof status

### Clear Stale Locks

```bash
npx agent-lease clear
```

Removes lock files that are orphaned or exceeded TTL.

Use when:
- Agent process crashed and didn't clean up
- Lock has been held for >24 hours
- Lock file exists but project isn't actually locked

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
COMMIT BLOCKED: agent-lease lock held (agent-id: researcher-2)
Lock acquired: 5 minutes ago
Run: npx agent-lease release --audit-proof
```

**Claude detects block and:**
1. Recognizes agent-lease lock message
2. Runs `npx agent-lease status` → Shows lock holder and timestamp
3. Runs `npx agent-lease release --audit-proof`
4. ✅ Validation passes
5. Offers to retry: `git commit -m "Fix: update agent adapter"`

---

### Example 2: User Asks to Install agent-lease on New Project

**User says:**
```
"Install agent-lease hooks on this project"
```

**Claude:**
1. Checks for existing `.agent-lease.json` → Not found
2. Runs `npx agent-lease init`
3. Verifies `.agent-lease.json` created
4. Confirms: "agent-lease initialized. Git hooks installed. Ready to use."

---

### Example 3: User Checks/Clears Stale Locks

**User says:**
```
"What's the lock status? There might be a stale lock from earlier."
```

**Claude:**
1. Runs `npx agent-lease status`
   ```
   Lock held by: researcher-1
   Lock age: 18 hours (STALE)
   Audit proof: INVALID
   ```

2. Suggests clearing: "Lock is stale. Running clear..."
3. Runs `npx agent-lease clear`
4. Verifies with `ls /tmp/agent-lease-*.lock` → No files found
5. Confirms: "Stale lock cleared. Project is unlocked."

## Integration with Git Workflow

When used with Claude Code team mode:

- **Team lead** can check lock status before assigning tasks
- **Workers** auto-trigger release when commits are blocked
- **QA** validates lock audit trail before merging

Use with validation gates:
```bash
# Pre-commit gate
npx agent-lease release --audit-proof

# On failure, block commit with error details
```

## Troubleshooting

| Issue | Check | Fix |
|-------|-------|-----|
| Lock won't release | `npx agent-lease status` | If stale: `npx agent-lease clear` |
| Validation fails | Review error output | Fix reported issues, retry release |
| Command not found | `npm list agent-lease` | Install: `npm install agent-lease` |
| Permission denied | `ls -la /tmp/agent-lease-*` | Check file ownership |

## Files & Paths

| Location | Purpose |
|----------|---------|
| `.agent-lease.json` | Project config (version controlled) |
| `/tmp/agent-lease-*.lock` | Active lock files (temp) |
| `.git/hooks/pre-commit` | Git hook installed by init |

## Related Concepts

- **Lock holder**: Agent ID or process name currently holding lock
- **Audit proof**: Cryptographic signature validating lock state
- **TTL**: Time-to-live for locks (default: 24 hours)
- **Stale lock**: Lock exceeding TTL or from crashed process
