import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import * as React from 'react';
import { cn } from '@/lib/utils';

function loadLayout(id: string): Layout | undefined {
  try {
    const raw = localStorage.getItem(`postguy.layout.${id}`);
    return raw ? (JSON.parse(raw) as Layout) : undefined;
  } catch {
    return undefined;
  }
}

export function ResizableGroup({
  id,
  className,
  orientation = 'horizontal',
  children,
}: {
  id: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  children: React.ReactNode;
}) {
  const [defaultLayout] = React.useState(() => loadLayout(id));
  return (
    <Group
      id={id}
      orientation={orientation}
      defaultLayout={defaultLayout}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return;
        try {
          localStorage.setItem(`postguy.layout.${id}`, JSON.stringify(layout));
        } catch {
          /* storage unavailable */
        }
      }}
      className={cn('h-full w-full', className)}
    >
      {children}
    </Group>
  );
}

export const ResizablePanel = Panel;

export function ResizableHandle({ className, orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }) {
  return (
    <Separator
      className={cn(
        'relative shrink-0 bg-border transition-colors hover:bg-primary/50 data-[separator=active]:bg-primary',
        orientation === 'horizontal' ? 'w-px' : 'h-px',
        className,
      )}
    />
  );
}
