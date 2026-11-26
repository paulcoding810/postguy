#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version (e.g. v0.2.0), for the release body and the in-app update notes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The text under `## <version>` up to the next `## ` heading outside a code block, or null when there is none or it's empty. */
export function notesFor(changelog, version) {
  const v = version.replace(/^v/, '').replace(/[.+]/g, (c) => `\\${c}`);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+\\[?v?${v}\\]?(\\s|$)`).test(l));
  if (start === -1) return null;
  let fenced = false;
  const end = lines.findIndex((l, i) => {
    if (i <= start) return false;
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    return !fenced && /^##\s/.test(l);
  });
  const body = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
  return body || null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
  if (!version) {
    console.error('Usage: release-notes.mjs <version> [CHANGELOG.md]');
    process.exit(2);
  }
  const notes = notesFor(readFileSync(file, 'utf8'), version);
  if (!notes) {
    console.error(`${file} has no notes for ${version}. Add a "## ${version.replace(/^v/, '')}" section.`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
