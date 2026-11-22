import { describe, expect, it } from 'vitest';
import { notesSummary } from './updates';

describe('notesSummary', () => {
  it('keeps the first points as plain lines', () => {
    const body = '### Added\n- **Examples** on requests\n- `{{var}}` editing\n\n### Fixed\n- Tabs\n- Tree';
    expect(notesSummary(body)).toBe('• Examples on requests\n• {{var}} editing\n• Tabs\nand 1 more…');
    expect(notesSummary(undefined)).toBe('');
  });
});
