import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { notesFor } from '../../../scripts/release-notes.mjs';

const log = `# Changelog

## Unreleased

## 0.2.0 – 2026-12-01

### Added
- Thing

## 0.1.10 – 2026-11-01

- Older
`;

describe('release notes', () => {
  it('takes the section for a version, with or without the v', () => {
    expect(notesFor(log, 'v0.2.0')).toBe('### Added\n- Thing');
    expect(notesFor(log, '0.1.10')).toBe('- Older');
  });

  it('returns nothing for a missing or empty section', () => {
    expect(notesFor(log, 'v0.1.1')).toBeNull();
    expect(notesFor(log, 'Unreleased')).toBeNull();
  });

  it('has notes for the version the app is at', () => {
    const version = JSON.parse(readFileSync(new URL('../../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8')).version;
    expect(notesFor(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8'), version)).toBeTruthy();
  });
});
