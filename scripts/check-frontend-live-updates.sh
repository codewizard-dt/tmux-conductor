#!/usr/bin/env bash
set -euo pipefail

node <<'NODE'
const fs = require('fs');
const path = require('path');

const allowed = path.normalize('frontend/src/hooks/useSSE.ts');
const roots = ['frontend/src'];
const offenders = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
    } else if (/\.[tj]sx?$/.test(entry.name)) {
      const normalized = path.normalize(file);
      const source = fs.readFileSync(file, 'utf8');
      if (normalized !== allowed && source.includes('new EventSource')) {
        offenders.push(file);
      }
    }
  }
}

for (const root of roots) walk(root);

if (offenders.length > 0) {
  console.error('Direct EventSource construction is only allowed in frontend/src/hooks/useSSE.ts');
  for (const offender of offenders) console.error(`- ${offender}`);
  process.exit(1);
}
NODE
