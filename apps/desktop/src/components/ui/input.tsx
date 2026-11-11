import * as React from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-[13px] shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 dark:bg-input/30';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" spellCheck={false} className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea spellCheck={false} className={cn(inputClass, 'h-auto min-h-16 py-2', className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-xs font-medium text-muted-foreground', className)} {...props} />;
}
