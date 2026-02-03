# agent-lease - Validation Gate Skill

## Overview

Skill for managing agent-lease validation gates. Implements an FSM that detects project state and routes to appropriate actions. Agent-lease enforces that AI agents prove their work passes validation before commits land.

## State Machine

```
DETECT --> RECOMMEND --> INIT --> CONFIGURE --> ACTIVE
                                                  |
                                          BLOCKED --> RELEASE --> PROOF --> COMMIT
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

Check if agent-lease is installed:

1. Check for `.agent-lease.json` in project root
2. Check if `.git/hooks/pre-commit` contains "agent-lease"
3. Check `package.json` for agent-lease dependency

**Transitions:**
- If installed --> go to **ACTIVE**
- If not installed --> go to **RECOMMEND**

### Detection commands

```bash
# Check config
test -f .agent-lease.json && echo "CONFIG_FOUND" || echo "CONFIG_MISSING"

# Check hooks
grep -l "agent-lease" .git/hooks/pre-commit 2>/dev/null && echo "HOOK_FOUND" || echo "HOOK_MISSING"

# Check dependency
grep "agent-lease" package.json 2>/dev/null && echo "DEP_FOUND" || echo "DEP_MISSING"
```

---

## State: RECOMMEND

Scan the project for available validators:

1. Check `package.json` scripts for: `build`, `lint`, `test`, `typecheck`
2. Check for config files: `tsconfig.json`, `.eslintrc*`, `jest.config.*`, `prettier.config.*`
3. Check for CI: `.github/workflows/`, `.circleci/`, `Jenkinsfile`
4. Check for existing hook tools: `.husky/`, `.lefthook.yml`, `.pre-commit-config.yaml`

### Display recommendations dashboard

```
+==============================================================+
|  AGENT-LEASE RECOMMENDATIONS                                 |
+==============================================================+
|  Project: {name from package.json or dirname}                |
|  Status: NOT INSTALLED                                       |
+--------------------------------------------------------------+
|  Detected validators:                                        |
|  {for each found tool, show with recommended runner}         |
|  {for missing tools, show with suggestion}                   |
|                                                              |
|  Recommended .agent-lease.json:                              |
|  { show generated config based on detected tools }           |
+--------------------------------------------------------------+
|  Add AI code review?                                         |
|  - Claude: claude -p 'Review: {{diff}}'                      |
|  - Codex: codex -q 'Check: {{diff}}'                        |
|  - Ollama: ollama run llama3 'Review: {{diff}}'              |
+==============================================================+
```

Present as next steps with user choice to proceed.

**Transitions:**
- User confirms --> go to **INIT**

---

## State: INIT

Run initialization:

```bash
npx agent-lease init
```

**Transitions:**
- Success --> go to **CONFIGURE**

---

## State: CONFIGURE

Write `.agent-lease.json` based on recommendations from RECOMMEND state.

Always include proof config:

```json
{
  "runners": [
    // ... detected runners from RECOMMEND
  ],
  "proof": {
    "capture": true,
    "archive": true
  },
  "trailers": {
    "proof": "agent-lease-proof",
    "duration": "agent-lease-duration",
    "report": "agent-lease-report"
  }
}
```

**Transitions:**
- Config written --> go to **ACTIVE**

---

## State: ACTIVE (dashboard)

Show current status:

```
+==============================================================+
|  AGENT-LEASE STATUS                                          |
+==============================================================+
|  Installed: YES                                              |
|  Version: {from package.json or npx agent-lease --version}   |
|  Runners: {count} ({names})                                  |
|  Lock state: No active locks / Lock held                     |
|  Proofs archived: {count from .agent-lease/proofs/}          |
|  Last validation: {from most recent proof file}              |
+--------------------------------------------------------------+
|  Config: {show key settings from .agent-lease.json}          |
+==============================================================+
```

### How to gather status

```bash
# Version
npx agent-lease --version 2>/dev/null || echo "unknown"

# Runners
cat .agent-lease.json | jq '.runners | length' 2>/dev/null
cat .agent-lease.json | jq '[.runners[].name] | join(", ")' 2>/dev/null

# Lock state
npx agent-lease status 2>/dev/null

# Proof count
ls .agent-lease/proofs/*.txt 2>/dev/null | wc -l

# Last proof
ls -t .agent-lease/proofs/commit-*.json 2>/dev/null | head -1
```

**Transitions:**
- If lock is held --> suggest **RELEASE**

---

## State: BLOCKED (auto-detect)

Triggered when git commit output contains "COMMIT BLOCKED" or "agent-lease lock".

This state is entered automatically when the agent detects a blocked commit.

**Transitions:**
- Automatically --> go to **RELEASE**

---

## State: RELEASE

Run validation and release:

```bash
npx agent-lease release --audit-proof
```

**Transitions:**
- Validation fails --> report errors, suggest fixes, stay in RELEASE
- Validation passes --> go to **PROOF**

---

## State: PROOF

After successful release, display proof summary:

- Runner names and their pass/fail status
- Duration of each runner
- Proof hashes (sha256, 7 chars)
- Archived proof location (`.agent-lease/proofs/`)
- Consolidated report path

```
+==============================================================+
|  PROOF SUMMARY                                               |
+==============================================================+
|  Runner       | Status | Duration | Hash                     |
|  -------------|--------|----------|--------------------------|
|  typecheck    | PASS   | 2.3s     | a1b2c3d                  |
|  lint         | PASS   | 1.1s     | e4f5g6h                  |
|  haiku        | PASS   | 4.7s     | i7j8k9l                  |
+--------------------------------------------------------------+
|  Report: .agent-lease/proofs/commit-abc1234.json             |
+==============================================================+
```

**Transitions:**
- --> go to **COMMIT**

---

## State: COMMIT

Prompt user to retry their commit:

- The `prepare-commit-msg` hook will append trailers automatically
- Show expected trailer format:

```
agent-lease-proof: typecheck=a1b2c3d lint=e4f5g6h haiku=i7j8k9l
agent-lease-duration: typecheck=2.3s lint=1.1s haiku=4.7s
agent-lease-report: .agent-lease/proofs/commit-abc1234.json
```

User can now run `git commit` and the trailers will be appended.

---

## Adding Runners: Project Governance Guide

### For TypeScript projects

```json
{ "name": "typecheck", "command": "tsc --noEmit", "on": "commit" }
```

### For ESLint

```json
{ "name": "lint", "command": "eslint src/", "on": "commit" }
```

### For test suites

```json
{ "name": "test", "command": "npm test", "on": "push" }
```

### For AI code review (the differentiator)

```json
{ "name": "haiku", "command": "claude -p 'Quick check for bugs and security issues: {{diff}}'", "on": "commit" }
```

```json
{ "name": "opus", "command": "claude --model opus -p 'Deep review for correctness, security, and architecture: {{diff}}'", "on": "push" }
```

### For Codex

```json
{ "name": "codex", "command": "codex -q 'Review: {{diff}}'", "on": "commit" }
```

### For local models (Ollama)

```json
{ "name": "llama", "command": "echo '{{diff}}' | ollama run llama3 'Audit this code'", "on": "commit" }
```

---

## Proof Protocol

Runners produce proof that gets archived:

1. Each runner's stdout is captured as proof
2. Proof is hashed (sha256, 7 chars) for trailer reference
3. Full output archived to `.agent-lease/proofs/{hash}.txt`
4. Consolidated report: `.agent-lease/proofs/commit-{shortHash}.json`
5. Git trailers reference proof hashes for verifiability

See `references/proof-protocol.md` for the full proof protocol specification.

---

## Template Variables Available

| Variable      | Value                                      |
|---------------|--------------------------------------------|
| `{{diff}}`    | Staged changes (commit) or full diff (push)|
| `{{files}}`   | Changed file paths                         |
| `{{project}}` | Project name                               |
| `{{branch}}`  | Current branch                             |
| `{{hash}}`    | Commit hash                                |

---

## Integration with skills.sh

This skill can be installed via:

```bash
npx skills add chidev/agent-lease
```
