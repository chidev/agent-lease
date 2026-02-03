---
name: agent-lease
description: Validation gate manager - setup, manage, and dogfood agent-lease
allowed-tools: Bash, Read, Glob, Grep, Task
argument-hint: '[init|status|release|dashboard]'
---

# /agent-lease - Validation Gate Manager

Setup, manage, and dogfood agent-lease on any project.

## Usage
```
/agent-lease              # Dashboard: status + recommendations
/agent-lease init         # Initialize on current project
/agent-lease status       # Lock state
/agent-lease release      # Run validation + release
```

## Implementation

This command delegates to the agent-lease skill FSM.

```
Skill(skill="agent-lease", args="$ARGUMENTS")
```
