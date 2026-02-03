#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = '.agent-lease.json';

const DEFAULT_CONFIG = {
  validation: {
    build: 'npm run build',
    lint: 'npm run lint'
  },
  lockDir: '/tmp',
  projectName: null, // Auto-detected from package.json or dirname
  bypassWarning: true
};

function findProjectRoot(startDir = process.cwd()) {
  let dir = startDir;
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

function getProjectName(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) return pkg.name.replace(/[^a-zA-Z0-9-_]/g, '-');
    } catch (e) {}
  }
  return path.basename(projectRoot);
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

  return { config, projectRoot: root };
}

function saveConfig(config, projectRoot = null) {
  const root = projectRoot || findProjectRoot();
  const configPath = path.join(root, CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function createDefaultConfig(projectRoot = null) {
  const root = projectRoot || findProjectRoot();
  const config = {
    ...DEFAULT_CONFIG,
    projectName: getProjectName(root)
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
  CONFIG_FILE,
  DEFAULT_CONFIG
};
