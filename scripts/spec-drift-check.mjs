#!/usr/bin/env node
/**
 * Spec drift guard — keeps docs/architecture/spec/ synchronized with the code
 * it describes, structurally rather than by contributor discipline.
 * Documented in docs/architecture/DRIFT-GUARD.md.
 *
 *   node scripts/spec-drift-check.mjs --check    (default; CI runs this)
 *   node scripts/spec-drift-check.mjs --update   (pnpm spec:sync)
 *
 * Three checks:
 *  1. SPEC↔CODE: every spec in spec-map.json has a recorded digest of its
 *     watched source files (.spec-hashes.json). Changing watched code without
 *     re-syncing (which forces you past the spec) fails CI.
 *  2. REGISTRY↔GUARDS: every guard file referenced in INVARIANTS.md exists,
 *     and every INV-n a guard file claims to cover has a row in INVARIANTS.md.
 *  3. LAYERING (CI-F1): apps/api/src/lib/** and services/** must not import
 *     from modules/** (the downward-only rule, 02-dependency-graph.md §1).
 *
 * Zero dependencies; Node 20+.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_MAP = join(ROOT, 'docs/architecture/spec/spec-map.json');
const HASHES = join(ROOT, 'docs/architecture/spec/.spec-hashes.json');
const REGISTRY = join(ROOT, 'docs/architecture/INVARIANTS.md');
const GUARD_DIR = join(ROOT, 'apps/api/src/__tests__/guards');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

const update = process.argv.includes('--update');
const errors = [];

function listFiles(path) {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [path];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = `${path}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

// Normalize CRLF→LF so digests are identical across Windows (autocrlf) and CI
// checkouts — otherwise the same commit hashes differently per platform.
function normalizedRead(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function digestOf(paths) {
  const files = paths.flatMap(listFiles).sort();
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.split(sep).join('/'));
    h.update(normalizedRead(join(ROOT, f)));
  }
  return { digest: h.digest('hex'), fileCount: files.length };
}

// ── 1. spec ↔ code digests ─────────────────────────────────────────────────
const specMap = JSON.parse(readFileSync(SPEC_MAP, 'utf8'));
const computed = {};
for (const [spec, watched] of Object.entries(specMap)) {
  if (spec.startsWith('$')) continue;
  if (!existsSync(join(ROOT, spec))) {
    errors.push(`spec-map.json references a missing spec file: ${spec}`);
    continue;
  }
  const { digest, fileCount } = digestOf(watched);
  // The spec's own content is part of the digest: editing ONLY the code or
  // ONLY the spec both invalidate the recorded pair.
  const h = createHash('sha256');
  h.update(digest);
  h.update(normalizedRead(join(ROOT, spec)));
  computed[spec] = { digest: h.digest('hex'), watchedFiles: fileCount };
}

if (update) {
  writeFileSync(HASHES, JSON.stringify(computed, null, 2) + '\n');
  console.log(`spec-drift-check: wrote ${HASHES.split(sep).join('/')}`);
} else {
  if (!existsSync(HASHES)) {
    errors.push('Missing docs/architecture/spec/.spec-hashes.json — run `pnpm spec:sync`.');
  } else {
    const recorded = JSON.parse(readFileSync(HASHES, 'utf8'));
    for (const [spec, { digest }] of Object.entries(computed)) {
      if (!recorded[spec]) {
        errors.push(`No recorded digest for ${spec} — review the spec, then run \`pnpm spec:sync\`.`);
      } else if (recorded[spec].digest !== digest) {
        errors.push(
          `DRIFT: source watched by ${spec} changed (or the spec changed) without re-sync.\n` +
            `       → Re-read that spec, update it if the change touches documented behavior,\n` +
            `         then run \`pnpm spec:sync\` and commit .spec-hashes.json with your change.`,
        );
      }
    }
    for (const spec of Object.keys(recorded)) {
      if (!computed[spec]) errors.push(`Recorded digest for unknown spec ${spec} — re-run \`pnpm spec:sync\`.`);
    }
  }
}

// ── 2. registry ↔ guard files ──────────────────────────────────────────────
const registry = readFileSync(REGISTRY, 'utf8');
for (const ref of registry.match(/guards\/[\w.-]+\.guard\.test\.ts/g) ?? []) {
  if (!existsSync(join(ROOT, 'apps/api/src/__tests__', ref))) {
    errors.push(`INVARIANTS.md references missing guard file: ${ref}`);
  }
}
if (existsSync(GUARD_DIR)) {
  for (const f of readdirSync(GUARD_DIR).filter((f) => f.endsWith('.test.ts'))) {
    const content = readFileSync(join(GUARD_DIR, f), 'utf8');
    for (const inv of new Set(content.match(/INV-\d+/g) ?? [])) {
      if (!registry.includes(inv)) {
        errors.push(`${f} claims to guard ${inv}, but INVARIANTS.md has no such row.`);
      }
    }
    if (!registry.includes(`guards/${f}`)) {
      errors.push(`Guard file ${f} is not referenced by INVARIANTS.md — add it to the registry.`);
    }
  }
}

// ── 3. layering law (CI-F1): lib/services never import modules ─────────────
for (const dir of ['apps/api/src/lib', 'apps/api/src/services']) {
  for (const f of listFiles(dir)) {
    if (!f.endsWith('.ts')) continue;
    const content = readFileSync(join(ROOT, f), 'utf8');
    const hit = content.match(/from\s+['"][^'"]*modules\/[^'"]*['"]/);
    if (hit) {
      errors.push(
        `LAYERING (CI-F1): ${f} imports from modules/ (${hit[0]}) — lib/services must never ` +
          `import modules (docs/architecture/spec/platform.md §2).`,
      );
    }
  }
}

if (errors.length) {
  console.error('\nspec-drift-check FAILED:\n');
  for (const e of errors) console.error(' • ' + e + '\n');
  process.exit(1);
}
if (!update) console.log('spec-drift-check: OK (specs in sync, registry consistent, layering clean)');
