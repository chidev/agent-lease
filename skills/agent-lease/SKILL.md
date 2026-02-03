---
name: agent-lease
description: Standards-enforcing validation gates for git commits. Catches what linters miss.
version: 3.3.0
tags: validation, git-hooks, agent, code-review, husky, lefthook
---

# agent-lease

Standards-enforcing validation gates for AI agents. Scans your codebase, learns your patterns, and blocks commits until validation passes.
**Not a replacement for lint/build/test.** Those are deterministic — run them in CI. agent-lease catches everything else: the patterns linters miss, the standards PR reviewers enforce manually.

---

## Installation

**skills.sh** (Claude Code, Codex, Cursor):
```bash
npx skills add chidev/agent-lease
```

**ClawdHub** (OpenClaw):
```bash
npx clawhub@latest install agent-lease
```

Then invoke:
```
"Use agent-lease to add standards-enforcing validation gates to this repo"
```

---

## Workflow

### Step 1: Scan

Read the project to understand what exists before configuring anything.

1. **package.json** — Read `scripts` (build, lint, test, typecheck), `devDependencies`, detect package manager (npm/pnpm/bun via lockfile)
2. **Existing hooks** — Check `.husky/`, `lefthook.yml`, `.git/hooks/*` for active hook systems
3. **Configuration** — Check for `.agent-lease.json` (already configured? skip to Step 4)
4. **Standards** — Read `CLAUDE.md`, `AGENTS.md` for existing agent instructions and project standards
5. **PR history** — Run `gh pr list --limit 5 --json title,url` and check recent review comments for recurring feedback patterns

### Step 2: Present Findings

Show the user what was discovered:

```
╔══════════════════════════════════════════════════════════════╗
║  AGENT-LEASE DISCOVERY                                       ║
╠══════════════════════════════════════════════════════════════╣
║  Project: {name}          Package Manager: {pm}              ║
╠──────────────────────────────────────────────────────────────╣
║  EXISTING HOOKS                                              ║
║    {list hooks found, or "None detected"}                    ║
╠──────────────────────────────────────────────────────────────╣
║  DETERMINISTIC CHECKS (from package.json scripts)            ║
║    {list: lint, build, test, typecheck — mark found/missing} ║
╠──────────────────────────────────────────────────────────────╣
║  NON-DETERMINISTIC PATTERNS                                  ║
║    {from PR comments: "update changelog", "add tests", etc}  ║
║    {from CLAUDE.md: project standards found}                 ║
╚══════════════════════════════════════════════════════════════╝
```

Ask the user:
- Which standards should agent-lease enforce?
- Which deterministic checks to include as runners?
- Hook system preference? (use existing if found, husky by default, lefthook as option)

### Step 3: Configure

1. Run `npx agent-lease init` — installs hooks (detects husky automatically, falls back to `.git/hooks/`)
2. Edit `.agent-lease.json` with runners based on user input:
   - Add deterministic runners (lint, build, test) with their actual commands from `package.json`
   - Add pattern runners (LLM review) if requested
3. Create `.agent-lease/commit.md` — template with standards the user chose, injected into LLM review prompts via `{{standards}}`
4. Create `.agent-lease/push.md` — template for push-phase review standards (if push runners configured)

### Step 4: Show Dashboard

Display what was configured:

```
╔══════════════════════════════════════════════════════════════╗
║  AGENT-LEASE CONFIGURED                                      ║
╠══════════════════════════════════════════════════════════════╣
║  Hook System: {husky | lefthook | .git/hooks}                ║
╠──────────────────────────────────────────────────────────────╣
║  COMMIT PHASE                                                ║
║    [deterministic] lint       {command}                       ║
║    [deterministic] typecheck  {command}                       ║
║    [pattern]       review     claude -p '...'                ║
╠──────────────────────────────────────────────────────────────╣
║  PUSH PHASE                                                  ║
║    [deterministic] test       {command}                       ║
╠──────────────────────────────────────────────────────────────╣
║  Templates: .agent-lease/commit.md, .agent-lease/push.md     ║
║  Config:    .agent-lease.json                                ║
╚══════════════════════════════════════════════════════════════╝
```

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `agent-lease init` | Install hooks + config + templates (detects husky) |
| `agent-lease commit` | DENY: show gate template, create lock, exit 1 |
| `agent-lease commit --audit-proof='...'` | RELEASE: accept proof, release lock, exit 0 |
| `agent-lease push` | DENY: show gate template, create lock, exit 1 |
| `agent-lease push --audit-proof='...'` | RELEASE: accept proof, release lock, exit 0 |
| `agent-lease status` | Check current lock state |
| `agent-lease clear` | Remove all locks for this project |
| `agent-lease release --audit-proof` | Legacy: run all runners internally and release |

---

## For AI Agents

When an agent attempts `git commit`:

1. Hook calls `npx agent-lease commit` → DENY: shows gate template with `⛔ --no-verify is FORBIDDEN` header
2. Template shows configured runners and callback format
3. Agent runs each runner, captures output
4. Agent submits proof: `npx agent-lease commit --audit-proof='## Validation Report\nRunner: lint\nStatus: PASS\nOutput: clean\n\nSummary: All passed.'`
5. Lock releases, agent runs `git commit` again → hook calls `agent-lease commit` → sees proof → exit 0 → commit succeeds

The key: agents cannot skip validation. The lock persists until proof is submitted.

---

## Template Variables

Available in runner `command` strings:

| Variable | Value |
|----------|-------|
| `{{diff}}` | Staged changes (commit phase) or `origin/main...HEAD` diff (push phase) |
| `{{files}}` | List of changed file paths |
| `{{project}}` | Project name from `.agent-lease.json` |
| `{{branch}}` | Current git branch |
| `{{hash}}` | Current commit hash |

---

## Adding Runners

Runners are defined in `.agent-lease.json` under `"runners"`:

**Deterministic** (binary pass/fail):
```json
{ "name": "lint", "command": "pnpm run lint", "on": "commit" }
{ "name": "test", "command": "pnpm test", "on": "push" }
```

**Pattern** (LLM review):
```json
{
  "name": "haiku-review",
  "command": "claude -p 'Review against standards:\n{{diff}}'",
  "on": "commit",
  "llm": true
}
```

Each runner needs `name`, `command`, and `on` (which phase: `"commit"` or `"push"`).
