import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, Popover as PopoverPrimitive, Switch as SwitchPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <TooltipPrimitive.Root open={!!content && open} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      {content && (
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={4}
            className="z-50 max-w-sm rounded-md bg-foreground px-2 py-1 text-xs break-words text-background shadow-md animate-in fade-in-0"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      )}
    </TooltipPrimitive.Root>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({ className, align = 'start', sideOffset = 4, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none animate-in fade-in-0', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors outline-none data-[state=checked]:bg-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-3.5 shrink-0 rounded-[4px] border border-input shadow-xs outline-none data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <CheckIcon className="size-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn('inline-flex h-5 items-center rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground', className)}
      {...props}
    />
  );
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      {icon}
      <div className="text-sm font-medium text-foreground/80">{title}</div>
      {children && <div className="max-w-xs text-xs">{children}</div>}
    </div>
  );
}
