import * as React from 'react';

/** Opens a popup while the pointer rests on a trigger and keeps it open while the popup is hovered or focused. */
export function useHoverPopup(enabled: boolean, openDelay = 400, closeDelay = 250) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const content = React.useRef<HTMLElement | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => clear, []);
  const close = React.useCallback(() => {
    clear();
    setOpen(false);
  }, []);
  const scheduleClose = () => {
    clear();
    timer.current = setTimeout(() => {
      if (!content.current?.contains(document.activeElement)) setOpen(false);
    }, closeDelay);
  };
  const openNow = React.useCallback(() => {
    clear();
    setOpen(true);
  }, []);
  return {
    open: enabled && open,
    close,
    openNow,
    triggerProps: {
      onMouseEnter: () => {
        clear();
        if (enabled && !open) timer.current = setTimeout(() => setOpen(true), openDelay);
      },
      onMouseLeave: scheduleClose,
    },
    contentProps: {
      ref: (el: HTMLElement | null) => {
        content.current = el;
      },
      onMouseEnter: clear,
      onMouseLeave: scheduleClose,
    },
  };
}
