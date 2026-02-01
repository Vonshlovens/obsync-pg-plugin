#!/usr/bin/env node
/**
 * Build script that creates a complete plugin distribution
 * with all necessary dependencies for installation.
 */

import { execSync } from 'child_process';
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist', 'obsync-pg');

// pg dependencies that need to be bundled (runtime deps only)
const pgDeps = [
  'pg',
  'pg-cloudflare',
  'pg-connection-string',
  'pg-int8',
  'pg-pool',
  'pg-protocol',
  'pg-types',
  'pgpass',
  'postgres-array',
  'postgres-bytea',
  'postgres-date',
  'postgres-interval',
  'split2',
  'xtend',
];

console.log('Building obsync-pg plugin...\n');

// Clean dist folder
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// Run the production build
console.log('1. Compiling TypeScript and bundling...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

// Copy main files
console.log('\n2. Copying plugin files...');
copyFileSync(join(rootDir, 'main.js'), join(distDir, 'main.js'));
copyFileSync(join(rootDir, 'manifest.json'), join(distDir, 'manifest.json'));

// Copy pg dependencies
console.log('\n3. Bundling pg dependencies...');
const nodeModulesDir = join(distDir, 'node_modules');
mkdirSync(nodeModulesDir, { recursive: true });

for (const dep of pgDeps) {
  const src = join(rootDir, 'node_modules', dep);
  const dest = join(nodeModulesDir, dep);

  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
    console.log(`   ✓ ${dep}`);
  } else {
    console.warn(`   ⚠ ${dep} not found`);
  }
}

console.log('\n✅ Build complete!');
console.log(`\nOutput: ${distDir}`);
console.log('\nTo install:');
console.log('  1. Copy the "dist/obsync-pg" folder to your vault\'s .obsidian/plugins/');
console.log('  2. Enable the plugin in Obsidian settings');
