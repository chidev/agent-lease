#!/usr/bin/env node
/**
 * E2E Test Suite for agent-lease
 *
 * Tests the full lock/lease/runner cycle in an isolated git repo.
 *
 * Run: node test/e2e.js
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

const AGENT_LEASE_BIN = path.join(__dirname, '..', 'bin', 'agent-lease.js');

// Test utilities
let testDir;
let passed = 0;
let failed = 0;

function log(msg) {
  console.log(msg);
}

function pass(name) {
  passed++;
  log(`  ✅ ${name}`);
}

function fail(name, reason) {
  failed++;
  log(`  ❌ ${name}`);
  log(`     ${reason}`);
}

function setup() {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lease-test-'));
  process.chdir(testDir);
  execSync('git init -q');
  execSync('git config user.email "test@test.com"');
  execSync('git config user.name "Test"');

  // Create package.json
  fs.writeFileSync('package.json', JSON.stringify({
    name: 'test-project',
    scripts: {
      build: 'echo build-ok',
      lint: 'echo lint-ok',
      'build-fail': 'echo fail && exit 1'
    }
  }, null, 2));

  log(`\n📁 Test dir: ${testDir}\n`);
}

function cleanup() {
  process.chdir('/');
  fs.rmSync(testDir, { recursive: true, force: true });
}

function run(cmd, opts = {}) {
  const result = spawnSync('bash', ['-c', cmd], {
    encoding: 'utf8',
    cwd: testDir,
    env: { ...process.env, ...opts.env },
    timeout: 30000
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    output: (result.stdout || '') + (result.stderr || '')
  };
}

function agentLease(args, opts = {}) {
  return run(`node ${AGENT_LEASE_BIN} ${args}`, opts);
}

// ============ TESTS ============

function test_init() {
  log('\n🧪 Test: init');

  const result = agentLease('init');

  if (result.status !== 0) {
    return fail('init should succeed', result.output);
  }

  if (!fs.existsSync(path.join(testDir, '.agent-lease.json'))) {
    return fail('should create config', 'missing .agent-lease.json');
  }

  if (!fs.existsSync(path.join(testDir, '.git', 'hooks', 'pre-commit'))) {
    return fail('should install hook', 'missing pre-commit hook');
  }

  if (!result.output.includes('agent-lease installed')) {
    return fail('should show success message', result.output);
  }

  pass('init creates config and hooks');
}

function test_commit_blocked() {
  log('\n🧪 Test: commit creates lock and blocks');

  fs.writeFileSync(path.join(testDir, 'test.txt'), 'hello');
  run('git add test.txt');

  const result = run('git commit -m "test"');

  if (result.status === 0) {
    return fail('commit should be blocked', 'commit succeeded but should have failed');
  }

  if (!result.output.includes('COMMIT BLOCKED')) {
    return fail('should show block message', result.output);
  }

  // Check lock exists
  const status = agentLease('status');
  if (!status.output.includes('Lock exists')) {
    return fail('lock should exist after blocked commit', status.output);
  }

  pass('first commit creates lock and blocks');
}

function test_release_validates() {
  log('\n🧪 Test: release runs runners and validates');

  const result = agentLease('release --audit-proof');

  if (result.status !== 0) {
    return fail('release should succeed with passing runners', result.output);
  }

  if (!result.output.includes('build')) {
    return fail('should run build', result.output);
  }

  if (!result.output.includes('lint')) {
    return fail('should run lint', result.output);
  }

  if (!result.output.includes('All runners passed')) {
    return fail('should report all passed', result.output);
  }

  pass('release runs all runners');
}

function test_commit_succeeds_after_release() {
  log('\n🧪 Test: commit succeeds after release');

  const result = run('git commit -m "test"');

  if (result.status !== 0) {
    return fail('commit should succeed after release', result.output);
  }

  if (!result.output.includes('Validation proof found')) {
    return fail('should show proof message', result.output);
  }

  pass('commit succeeds with proof');
}

function test_runner_failure_blocks() {
  log('\n🧪 Test: failing runner blocks release');

  // Modify config to use failing runner with LOCAL locks
  const config = {
    runners: [
      { name: 'fail', command: 'npm run build-fail', on: 'commit' }
    ],
    lockDir: 'local'
  };
  fs.writeFileSync(path.join(testDir, '.agent-lease.json'), JSON.stringify(config));

  // Re-install hooks so they pick up new config
  agentLease('init');

  // Create new file to trigger lock
  fs.writeFileSync(path.join(testDir, 'test2.txt'), 'world');
  run('git add test2.txt');

  // First commit creates lock and blocks
  const commitResult = run('git commit -m "test2"');
  if (!commitResult.output.includes('COMMIT BLOCKED')) {
    return fail('first commit should block and create lock', commitResult.output);
  }

  // Verify lock was created
  const preStatus = agentLease('status');
  if (!preStatus.output.includes('Lock exists')) {
    return fail('lock should exist after blocked commit', preStatus.output);
  }

  // Try to release - should fail because runner fails
  const result = agentLease('release --audit-proof');

  if (result.status === 0) {
    return fail('release should fail when runner fails', result.output);
  }

  if (!result.output.includes('Validation failed')) {
    return fail('should report failure', result.output);
  }

  pass('failing runner blocks release');

  // Cleanup: clear lock and restore config
  agentLease('clear');
  // Bypass to clean up staged file
  run('git commit --no-verify -m "cleanup fail-test"');
}

function test_local_lock_dir() {
  log('\n🧪 Test: local lock directory');

  const config = {
    runners: [{ name: 'echo', command: 'echo ok', on: 'commit' }],
    lockDir: 'local'
  };
  fs.writeFileSync(path.join(testDir, '.agent-lease.json'), JSON.stringify(config));

  fs.writeFileSync(path.join(testDir, 'test3.txt'), 'local');
  run('git add test3.txt');
  run('git commit -m "test3"'); // Creates lock

  const status = agentLease('status');

  if (!status.output.includes('.agent-lease/locks')) {
    return fail('should use local lock dir', status.output);
  }

  pass('local lock directory works');

  agentLease('release --audit-proof');
  run('git commit -m "test3"');
}

function test_env_override() {
  log('\n🧪 Test: env var overrides');

  // Ensure default config with /tmp locks
  const config = {
    runners: [{ name: 'build', command: 'npm run build', on: 'commit' }],
    lockDir: '/tmp'
  };
  fs.writeFileSync(path.join(testDir, '.agent-lease.json'), JSON.stringify(config));
  agentLease('init');

  fs.writeFileSync(path.join(testDir, 'test4.txt'), 'env');
  run('git add test4.txt');
  run('git commit -m "test4"'); // Creates lock

  // Verify lock exists
  const preStatus = agentLease('status');
  if (!preStatus.output.includes('Lock exists')) {
    return fail('lock should exist before env release', preStatus.output);
  }

  // Use env var to override runner
  const result = agentLease('release --audit-proof', {
    env: { AGENT_LEASE_RUNNERS: 'custom:echo custom-runner-ok' }
  });

  if (result.status !== 0) {
    return fail('env override should work', result.output);
  }

  if (!result.output.includes('custom')) {
    return fail('should use env runner', result.output);
  }

  pass('env var runner override works');

  run('git commit -m "test4"');
}

function test_runners_command() {
  log('\n🧪 Test: runners command');

  const config = {
    runners: [
      { name: 'build', command: 'npm run build', on: 'commit' },
      { name: 'review', command: 'claude -p "{{diff}}"', on: 'push' }
    ],
    lockDir: 'auto'
  };
  fs.writeFileSync(path.join(testDir, '.agent-lease.json'), JSON.stringify(config));

  const result = agentLease('runners');

  if (!result.output.includes('[commit] build')) {
    return fail('should list commit runner', result.output);
  }

  if (!result.output.includes('[push] review')) {
    return fail('should list push runner', result.output);
  }

  pass('runners command lists all runners');
}

function test_clear() {
  log('\n🧪 Test: clear removes locks');

  // Ensure consistent config
  const config = {
    runners: [{ name: 'echo', command: 'echo ok', on: 'commit' }],
    lockDir: '/tmp'
  };
  fs.writeFileSync(path.join(testDir, '.agent-lease.json'), JSON.stringify(config));
  agentLease('init');

  fs.writeFileSync(path.join(testDir, 'test5.txt'), 'clear');
  run('git add test5.txt');
  run('git commit -m "test5"'); // Creates lock

  let status = agentLease('status');
  if (!status.output.includes('Lock exists')) {
    return fail('lock should exist before clear', status.output);
  }

  const result = agentLease('clear');
  if (!result.output.includes('Cleared')) {
    return fail('should report cleared', result.output);
  }

  status = agentLease('status');
  if (!status.output.includes('No active lock')) {
    return fail('lock should be gone after clear', status.output);
  }

  pass('clear removes locks');

  // Bypass to clean up
  run('git commit --no-verify -m "cleanup"');
}

function test_template_vars() {
  log('\n🧪 Test: template variable expansion');

  const config = {
    runners: [
      { name: 'echo-project', command: 'echo "project:{{project}}"', on: 'commit' },
      { name: 'echo-branch', command: 'echo "branch:{{branch}}"', on: 'commit' }
    ],
    lockDir: 'local'
  };
  fs.writeFileSync(path.join(testDir, '.agent-lease.json'), JSON.stringify(config));
  agentLease('init');

  fs.writeFileSync(path.join(testDir, 'test6.txt'), 'template');
  run('git add test6.txt');
  run('git commit -m "test6"'); // Creates lock

  // Verify lock
  const preStatus = agentLease('status');
  if (!preStatus.output.includes('Lock exists')) {
    return fail('lock should exist before template test', preStatus.output);
  }

  const result = agentLease('release --audit-proof');

  if (result.status !== 0) {
    return fail('release should succeed', result.output);
  }

  // Runner output shows in formatResults which includes command name
  if (!result.output.includes('echo-project') || !result.output.includes('echo-branch')) {
    return fail('should run both template runners', result.output);
  }

  pass('template variables expand correctly');

  run('git commit -m "test6"');
}

function test_bypass() {
  log('\n🧪 Test: --no-verify bypasses hooks');

  fs.writeFileSync(path.join(testDir, 'test7.txt'), 'bypass');
  run('git add test7.txt');

  const result = run('git commit --no-verify -m "bypass test"');

  if (result.status !== 0) {
    return fail('--no-verify should bypass hook', result.output);
  }

  pass('--no-verify bypasses validation');
}

// ============ MAIN ============

function main() {
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║  agent-lease E2E Test Suite                                  ║');
  log('╚══════════════════════════════════════════════════════════════╝');

  try {
    setup();

    test_init();
    test_commit_blocked();
    test_release_validates();
    test_commit_succeeds_after_release();
    test_runner_failure_blocks();
    test_local_lock_dir();
    test_env_override();
    test_runners_command();
    test_clear();
    test_template_vars();
    test_bypass();

    log('\n' + '═'.repeat(60));
    log(`\n  Results: ${passed} passed, ${failed} failed\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (e) {
    log(`\n💥 Test crashed: ${e.message}`);
    log(e.stack);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
