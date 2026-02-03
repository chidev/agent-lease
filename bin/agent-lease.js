#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadConfig, createDefaultConfig, findProjectRoot } = require('../lib/config');
const {
  checkLock,
  releaseLock,
  clearAllLocks,
  archiveLock
} = require('../lib/lock-manager');
const { runRunners, formatResults } = require('../lib/runner');

const HELP = `
agent-lease - Forced validation gates for git commits

COMMANDS:
  init                      Install hooks to current project
  release --audit-proof     Run all runners + release lock
  status                    Check current lock state
  clear                     Remove all locks for this project
  runners                   List configured runners
  help                      Show this message

OPTIONS:
  --phase <commit|push>     Which runners to execute (default: commit)
                            Used with: release, status, clear

ENV VARS:
  AGENT_LEASE_LOCK_DIR      Override lock directory
  AGENT_LEASE_PROJECT       Override project name
  AGENT_LEASE_RUNNERS       Override runners (name:cmd,name:cmd)

RUNNER CONFIG (.agent-lease.json):
  {
    "runners": [
      { "name": "build", "command": "npm run build", "on": "commit" },
      { "name": "lint", "command": "npm run lint", "on": "commit" },
      { "name": "review", "command": "claude -p 'Review: {{diff}}'", "on": "push" }
    ],
    "lockDir": "auto"
  }

LOCK DIRS (priority):
  1. AGENT_LEASE_LOCK_DIR env var
  2. "local" → .agent-lease/locks/ (project-local)
  3. "xdg"   → $XDG_RUNTIME_DIR/agent-lease/
  4. "auto"  → XDG if available, else /tmp
  5. Custom path

TEMPLATE VARS IN COMMANDS:
  {{diff}}     git diff (staged for commit, branch for push)
  {{files}}    staged file list
  {{project}}  project name
  {{branch}}   current branch
  {{hash}}     current commit hash

EXAMPLES:
  # Traditional
  { "name": "build", "command": "npm run build" }

  # Agentic: Claude reviews your diff at commit time
  { "name": "claude-review", "command": "claude -p 'Review this for bugs: {{diff}}'", "on": "commit" }

  # Agentic: Larger model reviews on push
  { "name": "opus-review", "command": "claude -p --model opus 'Deep review: {{diff}}'", "on": "push" }

  # Any LLM CLI
  { "name": "codex-review", "command": "codex -q 'Check: {{diff}}'" }
  { "name": "ollama-review", "command": "echo '{{diff}}' | ollama run llama3 'Review this code'" }

FOR AI AGENTS:
  Tell Claude: "release the agent-lease lock"
`;

function cmd_init() {
  const root = findProjectRoot();
  const gitDir = path.join(root, '.git');

  if (!fs.existsSync(gitDir)) {
    console.error('Error: Not a git repository. Run `git init` first.');
    process.exit(1);
  }

  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const sourceHooksDir = path.join(__dirname, '..', 'hooks');

  for (const hook of ['pre-commit', 'pre-push']) {
    const src = path.join(sourceHooksDir, hook);
    const dest = path.join(hooksDir, hook);

    if (!fs.existsSync(src)) {
      console.error(`Warning: ${hook} hook not found at ${src}`);
      continue;
    }

    if (fs.existsSync(dest)) {
      const backup = `${dest}.agent-lease-backup`;
      fs.copyFileSync(dest, backup);
      console.log(`  Backed up existing ${hook} → ${hook}.agent-lease-backup`);
    }

    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, '755');
    console.log(`  ✓ Installed ${hook}`);
  }

  const configPath = path.join(root, '.agent-lease.json');
  if (!fs.existsSync(configPath)) {
    createDefaultConfig(root);
    console.log('  ✓ Created .agent-lease.json');
  }

  // Create .agent-lease dir for local locks/audit
  const leaseDir = path.join(root, '.agent-lease');
  if (!fs.existsSync(leaseDir)) {
    fs.mkdirSync(leaseDir, { recursive: true });
  }

  // Add .agent-lease/locks and .agent-lease/audit to .gitignore
  const gitignorePath = path.join(root, '.gitignore');
  const ignoreEntries = ['.agent-lease/locks/', '.agent-lease/audit/'];
  if (fs.existsSync(gitignorePath)) {
    let content = fs.readFileSync(gitignorePath, 'utf8');
    for (const entry of ignoreEntries) {
      if (!content.includes(entry)) {
        content += `\n${entry}`;
      }
    }
    fs.writeFileSync(gitignorePath, content);
  }

  const { config } = loadConfig(root);
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ agent-lease installed                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Next commit will create a validation gate.                  ║');
  console.log(`║  Lock dir: ${config.lockDir.padEnd(46)}  ║`);
  console.log(`║  Runners: ${config._runners.length} configured${' '.repeat(39)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

function cmd_release(args) {
  if (!args.includes('--audit-proof')) {
    console.error('Error: Must pass --audit-proof to confirm intentional release');
    console.error('Usage: agent-lease release --audit-proof [--phase commit|push]');
    process.exit(1);
  }

  const phaseIdx = args.indexOf('--phase');
  const phase = phaseIdx !== -1 ? args[phaseIdx + 1] : 'commit';

  if (!['commit', 'push'].includes(phase)) {
    console.error(`Error: Invalid phase '${phase}'. Must be 'commit' or 'push'.`);
    process.exit(1);
  }

  const { config, projectRoot } = loadConfig();
  const { projectName, lockDir } = config;

  const lockState = checkLock(projectName, lockDir, phase);
  if (!lockState.exists) {
    console.log(`No active ${phase} lock found. You can ${phase} freely.`);
    return;
  }

  if (lockState.auditPassed) {
    console.log(`Lock already has audit proof. ${phase === 'commit' ? 'Commit' : 'Push'} should proceed.`);
    return;
  }

  const runners = config._runners;
  const phaseRunners = runners.filter(r => (r.on || 'commit') === phase || (r.on || 'commit') === 'both');

  console.log('');
  console.log(`🔍 Running ${phaseRunners.length} runner(s) for phase: ${phase}`);
  console.log('');

  const { allPassed, results, totalDuration } = runRunners(runners, projectName, phase);

  console.log(formatResults(results));
  console.log('');
  console.log(`  Total: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('');

  if (!allPassed) {
    console.log('❌ Validation failed. Fix errors and try again.');
    console.log(`   Lock remains: ${lockState.lockPath}`);
    process.exit(1);
  }

  releaseLock(projectName, lockDir, results, phase);
  console.log(`✅ All runners passed. ${phase} lock released with audit proof.`);
  console.log('');
  if (phase === 'commit') {
    console.log('Now run your commit again:');
    console.log('  git commit -m "your message"');
  } else {
    console.log('Now run your push again:');
    console.log('  git push');
  }
  console.log('');
}

function cmd_status(args) {
  const { config } = loadConfig();
  const { projectName, lockDir } = config;

  const phaseIdx = args.indexOf('--phase');
  const phase = phaseIdx !== -1 ? args[phaseIdx + 1] : null;

  if (phase && !['commit', 'push'].includes(phase)) {
    console.error(`Error: Invalid phase '${phase}'. Must be 'commit' or 'push'.`);
    process.exit(1);
  }

  console.log(`Project:  ${projectName}`);
  console.log(`Lock dir: ${lockDir}`);
  console.log('');

  // Check both phases if no specific phase requested
  const phasesToCheck = phase ? [phase] : ['commit', 'push'];

  for (const p of phasesToCheck) {
    const lockState = checkLock(projectName, lockDir, p);

    console.log(`[${p.toUpperCase()} PHASE]`);

    if (!lockState.exists) {
      console.log(`  🟢 No active lock. ${p === 'commit' ? 'Commits' : 'Pushes'} are gated on next attempt.`);
    } else if (lockState.auditPassed) {
      console.log(`  🟢 Lock exists with audit proof. Next ${p} will pass.`);
    } else {
      console.log(`  🔴 Lock exists. Validation required before ${p}.`);
      console.log(`     Lock: ${lockState.lockPath}`);
      if (lockState.data && lockState.data.CREATED) {
        console.log(`     Created: ${lockState.data.CREATED}`);
      }
      if (lockState.data && lockState.data.REMOTE) {
        console.log(`     Remote: ${lockState.data.REMOTE}`);
      }
      console.log('');
      console.log(`     Release: npx agent-lease release --audit-proof --phase ${p}`);
    }
    console.log('');
  }
}

function cmd_runners() {
  const { config } = loadConfig();
  const runners = config._runners;

  console.log(`Configured runners (${runners.length}):\n`);

  for (const r of runners) {
    const phase = r.on || 'commit';
    console.log(`  [${phase}] ${r.name}`);
    console.log(`         ${r.command}`);
    if (r.env && Object.keys(r.env).length > 0) {
      console.log(`         env: ${JSON.stringify(r.env)}`);
    }
    console.log('');
  }

  console.log('Lock dir:', config.lockDir);
}

function cmd_clear(args) {
  const { config } = loadConfig();
  const { projectName, lockDir } = config;

  const phaseIdx = args.indexOf('--phase');
  const phase = phaseIdx !== -1 ? args[phaseIdx + 1] : null;

  if (phase && !['commit', 'push'].includes(phase)) {
    console.error(`Error: Invalid phase '${phase}'. Must be 'commit' or 'push'.`);
    process.exit(1);
  }

  const { cleared, paths } = clearAllLocks(projectName, lockDir, phase);

  if (cleared === 0) {
    console.log(`No ${phase ? phase + ' ' : ''}locks found to clear.`);
  } else {
    console.log(`Cleared ${cleared} ${phase ? phase + ' ' : ''}lock(s):`);
    paths.forEach(p => console.log(`  ✓ ${p}`));
  }
}

// --- Main ---
const [,, command, ...args] = process.argv;

switch (command) {
  case 'init':
    cmd_init();
    break;
  case 'release':
    cmd_release(args);
    break;
  case 'status':
    cmd_status(args);
    break;
  case 'runners':
    cmd_runners();
    break;
  case 'clear':
    cmd_clear(args);
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
}
