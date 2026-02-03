#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Lock/Lease Manager for agent-lease v2
 *
 * Supports:
 *   - XDG_RUNTIME_DIR for lock storage
 *   - Project-local locks (.agent-lease/locks/)
 *   - Env var overrides
 *   - Audit trail with runner output
 */

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getLockPath(projectName, lockDir) {
  ensureDir(lockDir);
  let shortHash = 'new';
  try {
    shortHash = execSync('git rev-parse --short HEAD 2>/dev/null', {
      encoding: 'utf8'
    }).trim();
  } catch (e) {}
  return path.join(lockDir, `agent-lease-${projectName}-${shortHash}.lock`);
}

function getAllLocks(projectName, lockDir) {
  const prefix = `agent-lease-${projectName}-`;
  try {
    ensureDir(lockDir);
    return fs.readdirSync(lockDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.lock'))
      .map(f => path.join(lockDir, f));
  } catch (e) {
    return [];
  }
}

function createLock(projectName, lockDir, phase = 'commit') {
  ensureDir(lockDir);
  const lockPath = getLockPath(projectName, lockDir);
  const guid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const content = [
    `LOCK_GUID=${guid}`,
    `CREATED=${new Date().toISOString()}`,
    `PROJECT=${projectName}`,
    `PHASE=${phase}`,
    `STATUS=PENDING`
  ].join('\n') + '\n';

  fs.writeFileSync(lockPath, content);
  return { lockPath, guid };
}

function checkLock(projectName, lockDir) {
  const lockPath = getLockPath(projectName, lockDir);

  if (!fs.existsSync(lockPath)) {
    return { exists: false, lockPath };
  }

  const content = fs.readFileSync(lockPath, 'utf8');
  const auditPassed = content.includes('AUDIT_PROOF_PASSED');

  // Parse lock file
  const lines = content.split('\n');
  const data = {};
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) data[key] = rest.join('=');
  }

  return {
    exists: true,
    auditPassed,
    lockPath,
    content,
    data
  };
}

function releaseLock(projectName, lockDir, runnerResults = []) {
  const lockPath = getLockPath(projectName, lockDir);

  if (!fs.existsSync(lockPath)) {
    return { released: false, reason: 'No lock found' };
  }

  let content = fs.readFileSync(lockPath, 'utf8');
  content += `AUDIT_PROOF_PASSED=${new Date().toISOString()}\n`;
  content += `STATUS=VALIDATED\n`;

  // Append runner results summary
  if (runnerResults.length > 0) {
    content += `RUNNERS_COUNT=${runnerResults.length}\n`;
    runnerResults.forEach((r, i) => {
      content += `RUNNER_${i}_NAME=${r.name}\n`;
      content += `RUNNER_${i}_PASSED=${r.passed}\n`;
      content += `RUNNER_${i}_DURATION=${r.duration}ms\n`;
    });
  }

  fs.writeFileSync(lockPath, content);

  return { released: true, lockPath };
}

function clearLock(projectName, lockDir) {
  const lockPath = getLockPath(projectName, lockDir);
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
    return { cleared: true, lockPath };
  }
  return { cleared: false, reason: 'No lock found' };
}

function clearAllLocks(projectName, lockDir) {
  const locks = getAllLocks(projectName, lockDir);
  locks.forEach(l => {
    try { fs.unlinkSync(l); } catch (e) {}
  });
  return { cleared: locks.length, paths: locks };
}

/**
 * Archive lock to audit trail after successful commit
 */
function archiveLock(projectName, lockDir, projectRoot) {
  const lockPath = getLockPath(projectName, lockDir);
  if (!fs.existsSync(lockPath)) return { archived: false };

  const auditDir = path.join(projectRoot, '.agent-lease', 'audit');
  ensureDir(auditDir);

  const timestamp = Date.now();
  const archivePath = path.join(auditDir, `${timestamp}.lock`);

  fs.copyFileSync(lockPath, archivePath);
  fs.unlinkSync(lockPath);

  return { archived: true, archivePath };
}

module.exports = {
  ensureDir,
  getLockPath,
  getAllLocks,
  createLock,
  checkLock,
  releaseLock,
  clearLock,
  clearAllLocks,
  archiveLock
};
