#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = '.agent-lease.json';

/**
 * Lock directory resolution (priority order):
 * 1. AGENT_LEASE_LOCK_DIR env var
 * 2. Config file lockDir
 * 3. "local" mode: <project>/.agent-lease/locks/
 * 4. XDG_RUNTIME_DIR/agent-lease/
 * 5. /tmp (fallback)
 */
function resolveLockDir(config, projectRoot) {
  // Env var always wins
  if (process.env.AGENT_LEASE_LOCK_DIR) {
    return process.env.AGENT_LEASE_LOCK_DIR;
  }

  const configLockDir = config.lockDir || 'auto';

  if (configLockDir === 'local') {
    return path.join(projectRoot, '.agent-lease', 'locks');
  }

  if (configLockDir === 'auto' || configLockDir === 'xdg') {
    const xdg = process.env.XDG_RUNTIME_DIR;
    if (xdg) return path.join(xdg, 'agent-lease');
  }

  if (configLockDir !== 'auto' && configLockDir !== 'xdg') {
    return configLockDir; // Custom absolute path
  }

  return '/tmp';
}

/**
 * Runner = any CLI command with contract:
 *   exit 0 = pass, exit 1 = fail, stdout = review text
 *
 * Runner config format:
 *   { name, command, on?, env? }
 *
 * "on" controls when runner fires: "commit" | "push" | "both" (default: "commit")
 * "env" is extra env vars passed to the runner process
 *
 * Built-in template variables in command strings:
 *   {{diff}}        → git diff --cached (for commit) or git diff origin..HEAD (for push)
 *   {{files}}       → space-separated list of staged files
 *   {{project}}     → project name
 *   {{branch}}      → current branch
 */
const DEFAULT_RUNNERS = [
  { name: 'build', command: 'npm run build', on: 'commit' },
  { name: 'lint', command: 'npm run lint', on: 'commit' }
];

const DEFAULT_CONFIG = {
  runners: null, // Falls back to DEFAULT_RUNNERS
  lockDir: 'auto', // "auto" | "local" | "xdg" | "/custom/path"
  projectName: null,
  bypassWarning: true,
  // Legacy compat: "validation" key maps to runners
  validation: null
};

function findProjectRoot(startDir = process.cwd()) {
  // Use git to find canonical project root (handles macOS /var vs /private/var)
  try {
    const { execSync } = require('child_process');
    const root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      cwd: startDir
    }).trim();
    return root;
  } catch (e) {}

  // Fallback: walk up looking for .git
  let dir = fs.realpathSync(startDir);
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

function getProjectName(projectRoot) {
  if (process.env.AGENT_LEASE_PROJECT) return process.env.AGENT_LEASE_PROJECT;

  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return pkg.name.replace(/[^a-zA-Z0-9-_]/g, '-');
    } catch (e) {}
  }
  return path.basename(projectRoot);
}

/**
 * Normalize runners from config.
 * Supports:
 *   - New format: { runners: [{ name, command, on }] }
 *   - Legacy format: { validation: { build: "cmd", lint: "cmd" } }
 *   - Env override: AGENT_LEASE_RUNNERS="build:npm run build,lint:npm run lint"
 */
function normalizeRunners(config) {
  // Env var override
  if (process.env.AGENT_LEASE_RUNNERS) {
    return process.env.AGENT_LEASE_RUNNERS.split(',').map(entry => {
      const [name, ...rest] = entry.split(':');
      return { name: name.trim(), command: rest.join(':').trim(), on: 'commit' };
    });
  }

  // New format
  if (config.runners && Array.isArray(config.runners)) {
    return config.runners.map(r => ({
      name: r.name || 'unnamed',
      command: r.command,
      on: r.on || 'commit',
      env: r.env || {}
    }));
  }

  // Legacy format
  if (config.validation && typeof config.validation === 'object') {
    return Object.entries(config.validation)
      .filter(([, cmd]) => cmd)
      .map(([name, command]) => ({ name, command, on: 'commit', env: {} }));
  }

  return [...DEFAULT_RUNNERS];
}

function loadConfig(projectRoot = null) {
  const root = projectRoot || findProjectRoot();
  const configPath = path.join(root, CONFIG_FILE);

  let config = { ...DEFAULT_CONFIG };

  if (fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...config, ...userConfig };
    } catch (e) {
      console.error(`Warning: Could not parse ${CONFIG_FILE}`);
    }
  }

  if (!config.projectName) {
    config.projectName = getProjectName(root);
  }

  // Merge proof defaults if not present
  const defaultProof = { capture: true, archive: true, maxLength: 10000 };
  config.proof = { ...defaultProof, ...(config.proof || {}) };

  // Merge trailers defaults if not present
  const defaultTrailers = { proof: 'agent-lease-proof', duration: 'agent-lease-duration', report: 'agent-lease-report' };
  config.trailers = { ...defaultTrailers, ...(config.trailers || {}) };

  // Resolve lock dir
  config.lockDir = resolveLockDir(config, root);

  // Normalize runners
  config._runners = normalizeRunners(config);

  return { config, projectRoot: root };
}

function saveConfig(config, projectRoot = null) {
  const root = projectRoot || findProjectRoot();
  const configPath = path.join(root, CONFIG_FILE);
  // Don't persist internal fields
  const { _runners, ...persistable } = config;
  fs.writeFileSync(configPath, JSON.stringify(persistable, null, 2) + '\n');
}

function createDefaultConfig(projectRoot = null) {
  const root = projectRoot || findProjectRoot();
  const config = {
    lockDir: 'auto',
    projectName: getProjectName(root),
    runners: [
      { name: 'build', command: 'npm run build', on: 'commit' },
      { name: 'lint', command: 'npm run lint', on: 'commit' }
    ],
    proof: {
      capture: true,
      archive: true,
      maxLength: 10000
    },
    trailers: {
      proof: 'agent-lease-proof',
      duration: 'agent-lease-duration',
      report: 'agent-lease-report'
    }
  };
  saveConfig(config, root);
  return config;
}

module.exports = {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  findProjectRoot,
  getProjectName,
  resolveLockDir,
  normalizeRunners,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  DEFAULT_RUNNERS
};
