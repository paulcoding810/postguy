import { describe, expect, it } from 'vitest';
import { disableAutocorrect } from './noAutocorrect';

describe('disableAutocorrect', () => {
  it('turns autocorrect and spell checking off in text fields as they get focus, and leaves checkboxes alone', () => {
    disableAutocorrect();
    document.body.innerHTML = '<input id="url"><textarea id="body"></textarea><input id="box" type="checkbox">';
    for (const id of ['url', 'body', 'box']) document.getElementById(id)!.focus();
    for (const id of ['url', 'body']) {
      const el = document.getElementById(id)!;
      expect([el.getAttribute('autocorrect'), el.getAttribute('autocapitalize'), el.getAttribute('autocomplete'), el.spellcheck], id).toEqual(['off', 'off', 'off', false]);
    }
    expect(document.getElementById('box')!.hasAttribute('autocorrect')).toBe(false);
  });
});
