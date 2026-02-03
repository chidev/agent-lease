#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadConfig, createDefaultConfig, findProjectRoot } = require('../lib/config');
const {
  checkLock,
  releaseLock,
  clearAllLocks,
  runValidation
} = require('../lib/lock-manager');

const HELP = `
agent-lease - Git hooks that FORCE validation before commits

COMMANDS:
  init                    Install hooks to current project
  release --audit-proof   Run validation + release lock
  status                  Check current lock state
  clear                   Remove all locks for this project
  help                    Show this message

USAGE:
  npx agent-lease init           # Setup hooks
  npx agent-lease release --audit-proof   # Validate & release
  npx agent-lease status         # Check lock
  npx agent-lease clear          # Clean stale locks

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

  // Find our hooks (installed package or local)
  const sourceHooksDir = path.join(__dirname, '..', 'hooks');

  for (const hook of ['pre-commit', 'pre-push']) {
    const src = path.join(sourceHooksDir, hook);
    const dest = path.join(hooksDir, hook);

    if (!fs.existsSync(src)) {
      console.error(`Warning: ${hook} hook not found at ${src}`);
      continue;
    }

    // Back up existing hook
    if (fs.existsSync(dest)) {
      const backup = `${dest}.agent-lease-backup`;
      fs.copyFileSync(dest, backup);
      console.log(`  Backed up existing ${hook} → ${hook}.agent-lease-backup`);
    }

    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, '755');
    console.log(`  ✓ Installed ${hook}`);
  }

  // Create config if not exists
  const configPath = path.join(root, '.agent-lease.json');
  if (!fs.existsSync(configPath)) {
    createDefaultConfig(root);
    console.log('  ✓ Created .agent-lease.json');
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ agent-lease installed                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Next commit will create a validation gate.                  ║');
  console.log('║  Build + lint must pass before commits go through.           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

function cmd_release(args) {
  if (!args.includes('--audit-proof')) {
    console.error('Error: Must pass --audit-proof to confirm intentional release');
    console.error('Usage: agent-lease release --audit-proof');
    process.exit(1);
  }

  const { config, projectRoot } = loadConfig();
  const { projectName } = config;
  const lockDir = config.lockDir || '/tmp';

  // Check lock exists
  const lockState = checkLock(projectName, lockDir);
  if (!lockState.exists) {
    console.log('No active lock found. You can commit freely.');
    return;
  }

  if (lockState.auditPassed) {
    console.log('Lock already has audit proof. Commit should proceed.');
    return;
  }

  console.log('');
  console.log('🔍 Running validation...');
  console.log('');

  const { allPassed, results } = runValidation(config);

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}: ${r.command}`);
  }
  console.log('');

  if (!allPassed) {
    console.log('❌ Validation failed. Fix errors and try again.');
    console.log(`   Lock remains: ${lockState.lockPath}`);
    process.exit(1);
  }

  // All passed - stamp the lock
  const result = releaseLock(projectName, lockDir);
  console.log('✅ All validations passed. Lock released with audit proof.');
  console.log('');
  console.log('Now run your commit again:');
  console.log('  git commit -m "your message"');
  console.log('');
}

function cmd_status() {
  const { config } = loadConfig();
  const { projectName } = config;
  const lockDir = config.lockDir || '/tmp';

  const lockState = checkLock(projectName, lockDir);

  if (!lockState.exists) {
    console.log('🟢 No active lock. Commits are gated on next attempt.');
    return;
  }

  if (lockState.auditPassed) {
    console.log('🟢 Lock exists with audit proof. Next commit will pass.');
  } else {
    console.log('🔴 Lock exists. Validation required before commit.');
    console.log(`   Lock: ${lockState.lockPath}`);
    console.log('');
    console.log('   Release: npx agent-lease release --audit-proof');
  }
}

function cmd_clear() {
  const { config } = loadConfig();
  const { projectName } = config;
  const lockDir = config.lockDir || '/tmp';

  const { cleared, paths } = clearAllLocks(projectName, lockDir);

  if (cleared === 0) {
    console.log('No locks found to clear.');
  } else {
    console.log(`Cleared ${cleared} lock(s):`);
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
    cmd_status();
    break;
  case 'clear':
    cmd_clear();
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
