#!/usr/bin/env node
const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

/**
 * Runner engine for agent-lease
 *
 * Runners are abstract CLI commands with a simple contract:
 *   - exit 0 = pass
 *   - exit 1 = fail
 *   - stdout = review text (captured for audit trail)
 *
 * Template variables:
 *   {{diff}}     → git diff output (--cached for commit, origin..HEAD for push)
 *   {{files}}    → staged files list
 *   {{project}}  → project name
 *   {{branch}}   → current git branch
 *   {{hash}}     → current commit hash (or "new")
 *
 * Agentic runners (examples):
 *   claude -p "Review this diff: {{diff}}"
 *   codex -q "Check for issues: {{diff}}"
 *   ollama run llama3 "Review: {{diff}}"
 */

function getGitContext() {
  const ctx = {
    diff: '',
    diffPush: '',
    files: '',
    branch: '',
    hash: 'new'
  };

  try {
    ctx.diff = execSync('git diff --cached', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (e) {}

  try {
    ctx.diffPush = execSync('git diff origin/main...HEAD', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (e) {
    try {
      ctx.diffPush = execSync('git diff origin/master...HEAD', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
    } catch (e2) {}
  }

  try {
    ctx.files = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim().split('\n').join(' ');
  } catch (e) {}

  try {
    ctx.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {}

  try {
    ctx.hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {}

  return ctx;
}

/**
 * Expand template variables in command string
 */
function expandCommand(command, context, projectName, phase = 'commit') {
  const diff = phase === 'push' ? context.diffPush : context.diff;

  return command
    .replace(/\{\{diff\}\}/g, diff)
    .replace(/\{\{files\}\}/g, context.files)
    .replace(/\{\{project\}\}/g, projectName)
    .replace(/\{\{branch\}\}/g, context.branch)
    .replace(/\{\{hash\}\}/g, context.hash);
}

/**
 * Execute a single runner
 *
 * Returns: { name, command, passed, output, error, duration }
 */
function executeRunner(runner, context, projectName, phase = 'commit') {
  const start = Date.now();
  const expandedCommand = expandCommand(runner.command, context, projectName, phase);

  // Merge env vars
  const env = { ...process.env, ...runner.env };

  // If command contains {{diff}} and diff is huge, use stdin instead
  const usesInlineDiff = runner.command.includes('{{diff}}');
  let finalCommand = expandedCommand;
  let input = undefined;

  // For very large diffs, pass via stdin to avoid arg length limits
  const diffContent = phase === 'push' ? context.diffPush : context.diff;
  if (usesInlineDiff && diffContent.length > 100000) {
    // Replace inline diff with stdin marker
    finalCommand = runner.command.replace(/\{\{diff\}\}/g, '$(cat)');
    input = diffContent;
  }

  try {
    const result = spawnSync('bash', ['-c', finalCommand], {
      encoding: 'utf8',
      env,
      input,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600000 // 10 min max
    });

    const output = (result.stdout || '') + (result.stderr || '');
    const passed = result.status === 0;

    const trimmedOutput = output.trim();
    const result_obj = {
      name: runner.name,
      command: runner.command,
      expandedCommand: finalCommand,
      passed,
      output: trimmedOutput,
      error: passed ? null : `Exit code ${result.status}`,
      duration: Date.now() - start
    };

    // Add proof capture
    result_obj.proof = {
      summary: (trimmedOutput || '').split('\n').filter(l => l.trim()).slice(0, 1).join(''),
      hash: crypto.createHash('sha256').update(trimmedOutput || '').digest('hex').slice(0, 7),
      output: (trimmedOutput || '').slice(0, 10000)
    };

    return result_obj;
  } catch (e) {
    const emptyOutput = '';
    const result_obj = {
      name: runner.name,
      command: runner.command,
      expandedCommand: finalCommand,
      passed: false,
      output: emptyOutput,
      error: e.message,
      duration: Date.now() - start
    };

    // Add proof capture
    result_obj.proof = {
      summary: '',
      hash: crypto.createHash('sha256').update(emptyOutput).digest('hex').slice(0, 7),
      output: ''
    };

    return result_obj;
  }
}

/**
 * Run all runners for a given phase (commit or push)
 *
 * Returns: { allPassed, results, totalDuration }
 */
function runRunners(runners, projectName, phase = 'commit') {
  const context = getGitContext();
  const results = [];
  const start = Date.now();

  // Filter runners for this phase
  const phaseRunners = runners.filter(r => {
    const on = r.on || 'commit';
    return on === phase || on === 'both';
  });

  if (phaseRunners.length === 0) {
    return { allPassed: true, results: [], totalDuration: 0 };
  }

  let allPassed = true;

  for (const runner of phaseRunners) {
    const result = executeRunner(runner, context, projectName, phase);
    results.push(result);

    if (!result.passed) {
      allPassed = false;
      break; // Stop on first failure
    }
  }

  return {
    allPassed,
    results,
    totalDuration: Date.now() - start
  };
}

/**
 * Format runner results for display
 */
function formatResults(results) {
  const lines = [];
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    const time = `(${(r.duration / 1000).toFixed(1)}s)`;
    lines.push(`  ${icon} ${r.name}: ${r.command} ${time}`);

    // Show output for agentic runners or on failure
    if (r.output && (r.command.includes('claude') || r.command.includes('codex') || !r.passed)) {
      const outputLines = r.output.split('\n').slice(0, 20); // First 20 lines
      outputLines.forEach(l => lines.push(`     ${l}`));
      if (r.output.split('\n').length > 20) {
        lines.push('     ... (output truncated)');
      }
    }
  }
  return lines.join('\n');
}

module.exports = {
  getGitContext,
  expandCommand,
  executeRunner,
  runRunners,
  formatResults
};
