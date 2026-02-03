#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig } = require('./config');

/**
 * Lock/Lease Manager for agent-lease
 *
 * The lock is a file in /tmp that gates commits.
 * - First commit attempt: creates lock, blocks commit
 * - Validation runs (build + lint)
 * - Lock gets stamped with AUDIT_PROOF_PASSED
 * - Second commit attempt: sees proof, allows commit, cleans up
 */

function getLockPath(projectName, lockDir) {
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
    return fs.readdirSync(lockDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.lock'))
      .map(f => path.join(lockDir, f));
  } catch (e) {
    return [];
  }
}

function createLock(projectName, lockDir) {
  const lockPath = getLockPath(projectName, lockDir);
  const guid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const content = [
    `LOCK_GUID=${guid}`,
    `CREATED=${new Date().toISOString()}`,
    `PROJECT=${projectName}`,
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

  return {
    exists: true,
    auditPassed,
    lockPath,
    content
  };
}

function releaseLock(projectName, lockDir) {
  const lockPath = getLockPath(projectName, lockDir);

  if (!fs.existsSync(lockPath)) {
    return { released: false, reason: 'No lock found' };
  }

  let content = fs.readFileSync(lockPath, 'utf8');
  content += `AUDIT_PROOF_PASSED=${new Date().toISOString()}\n`;
  content += `STATUS=VALIDATED\n`;
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

function runValidation(config) {
  const results = [];
  const validations = config.validation || {};

  for (const [name, command] of Object.entries(validations)) {
    if (!command) continue;
    try {
      execSync(command, { stdio: 'inherit', timeout: 300000 });
      results.push({ name, command, passed: true });
    } catch (e) {
      results.push({ name, command, passed: false, error: e.message });
      return { allPassed: false, results };
    }
  }

  return { allPassed: true, results };
}

module.exports = {
  getLockPath,
  getAllLocks,
  createLock,
  checkLock,
  releaseLock,
  clearLock,
  clearAllLocks,
  runValidation
};
