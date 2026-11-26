import { describe, expect, it } from 'vitest';
import { notesFor } from './release-notes.mjs';

describe('release notes', () => {
  it('takes the section for a version, with or without v or brackets', () => {
    const log = '# Changelog\n\n## Unreleased\n\n## [1.2.0] – 2026-12-01\n\n- New\n\n## 1.1.0\n\n- Old';
    expect(notesFor(log, 'v1.2.0')).toBe('- New');
    expect(notesFor(log, '1.1.0')).toBe('- Old');
    expect(notesFor(log, '1.3.0')).toBeNull();
  });

  it("doesn't end a section at a ## line inside a code block", () => {
    const log = '## 1.2.0\n\n```yaml\n## Proxy\nproxy: file\n```\n\n- Fixed a crash\n\n## 1.1.0\n\n- Old';
    expect(notesFor(log, '1.2.0')).toBe('```yaml\n## Proxy\nproxy: file\n```\n\n- Fixed a crash');
  });
});
