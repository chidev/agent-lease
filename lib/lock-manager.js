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

function getLockPath(projectName, lockDir, phase = 'commit') {
  ensureDir(lockDir);
  let shortHash = 'new';
  try {
    shortHash = execSync('git rev-parse --short HEAD 2>/dev/null', {
      encoding: 'utf8'
    }).trim();
  } catch (e) {}
  const suffix = phase === 'push' ? 'push-' : '';
  return path.join(lockDir, `agent-lease-${projectName}-${suffix}${shortHash}.lock`);
}

function getPushLockPath(projectName, lockDir) {
  return getLockPath(projectName, lockDir, 'push');
}

function getAllLocks(projectName, lockDir, phase = null) {
  const prefix = `agent-lease-${projectName}-`;
  try {
    ensureDir(lockDir);
    let files = fs.readdirSync(lockDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.lock'));

    // Filter by phase if specified
    if (phase === 'push') {
      files = files.filter(f => f.includes('-push-'));
    } else if (phase === 'commit') {
      files = files.filter(f => !f.includes('-push-'));
    }

    return files.map(f => path.join(lockDir, f));
  } catch (e) {
    return [];
  }
}

function createLock(projectName, lockDir, phase = 'commit') {
  ensureDir(lockDir);
  const lockPath = getLockPath(projectName, lockDir, phase);
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

function checkLock(projectName, lockDir, phase = 'commit') {
  const lockPath = getLockPath(projectName, lockDir, phase);

  if (!fs.existsSync(lockPath)) {
    return { exists: false, lockPath, phase };
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
    data,
    phase
  };
}

function checkPushLock(projectName, lockDir) {
  return checkLock(projectName, lockDir, 'push');
}

function releaseLock(projectName, lockDir, runnerResults = [], phase = 'commit', options = {}) {
  const lockPath = getLockPath(projectName, lockDir, phase);

  if (!fs.existsSync(lockPath)) {
    return { released: false, reason: 'No lock found', phase };
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

    // Generate git trailer strings for prepare-commit-msg hook
    const proofParts = runnerResults.map(r => {
      const durationSec = (r.duration / 1000).toFixed(1);
      const hash = r.proof ? r.proof.hash : '';
      return hash ? `${r.name}(${durationSec}s):${hash}` : `${r.name}(${durationSec}s)`;
    });
    const totalDurationSec = runnerResults.reduce((sum, r) => sum + r.duration, 0) / 1000;
    content += `GIT_TRAILER_PROOF=${proofParts.join(' ')}\n`;
    content += `GIT_TRAILER_DURATION=${totalDurationSec.toFixed(1)}s\n`;
  }

  // Archive proof files if runner results have proof data
  const projectRoot = options.projectRoot || process.cwd();
  if (runnerResults.some(r => r.proof)) {
    const proofDir = path.join(projectRoot, '.agent-lease', 'proofs');
    ensureDir(proofDir);

    // Write individual runner proofs
    runnerResults.forEach(r => {
      if (r.proof && r.proof.output) {
        fs.writeFileSync(path.join(proofDir, `${r.proof.hash}.txt`), r.proof.output);
      }
    });

    // Write consolidated report
    let shortHash = 'new';
    try {
      shortHash = execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
    } catch (e) {}
    const reportName = `commit-${shortHash}.json`;
    fs.writeFileSync(path.join(proofDir, reportName), JSON.stringify({
      timestamp: new Date().toISOString(),
      phase,
      runners: runnerResults.map(r => ({
        name: r.name,
        passed: r.passed,
        duration: r.duration,
        summary: r.proof ? r.proof.summary : null,
        hash: r.proof ? r.proof.hash : null
      }))
    }, null, 2));
    content += `GIT_TRAILER_REPORT=${reportName}\n`;
  }

  fs.writeFileSync(lockPath, content);

  return { released: true, lockPath, phase };
}

function releasePushLock(projectName, lockDir, runnerResults = []) {
  return releaseLock(projectName, lockDir, runnerResults, 'push');
}

function clearLock(projectName, lockDir, phase = 'commit') {
  const lockPath = getLockPath(projectName, lockDir, phase);
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
    return { cleared: true, lockPath, phase };
  }
  return { cleared: false, reason: 'No lock found', phase };
}

function clearAllLocks(projectName, lockDir, phase = null) {
  const locks = getAllLocks(projectName, lockDir, phase);
  locks.forEach(l => {
    try { fs.unlinkSync(l); } catch (e) {}
  });
  return { cleared: locks.length, paths: locks, phase };
}

/**
 * Archive lock to audit trail after successful commit/push
 */
function archiveLock(projectName, lockDir, projectRoot, phase = 'commit') {
  const lockPath = getLockPath(projectName, lockDir, phase);
  if (!fs.existsSync(lockPath)) return { archived: false, phase };

  const auditDir = path.join(projectRoot, '.agent-lease', 'audit');
  ensureDir(auditDir);

  const timestamp = Date.now();
  const phasePrefix = phase === 'push' ? 'push-' : '';
  const archivePath = path.join(auditDir, `${phasePrefix}${timestamp}.lock`);

  fs.copyFileSync(lockPath, archivePath);
  fs.unlinkSync(lockPath);

  return { archived: true, archivePath, phase };
}

module.exports = {
  ensureDir,
  getLockPath,
  getPushLockPath,
  getAllLocks,
  createLock,
  checkLock,
  checkPushLock,
  releaseLock,
  releasePushLock,
  clearLock,
  clearAllLocks,
  archiveLock
};
