const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]), textarea, [contenteditable]';

/** Turns off autocorrect, auto-capitalisation, suggestions and spell checking in each text field as it gets focus. */
export function disableAutocorrect(root: Document = document) {
  root.addEventListener(
    'focusin',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(TEXT_FIELD)) return;
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('autocomplete', 'off');
      el.spellcheck = false;
    },
    true,
  );
}
