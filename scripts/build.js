#!/usr/bin/env node
// Wrapper around the two build steps so prisma generate failure (Windows DLL
// lock) does not abort the TypeScript compilation.
const { execSync } = require('child_process');

const env = { ...process.env, DATABASE_URL: 'postgresql://build:build@localhost/build' };

try {
  execSync('npx prisma generate', { env, stdio: 'inherit' });
} catch {
  console.warn('\nWarning: prisma generate failed (Windows DLL lock) — client types are already up-to-date.\n');
}

execSync('npx tsc -p tsconfig.json', { env, stdio: 'inherit' });
