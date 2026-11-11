import { BrainIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/misc';

export function SmartPanel() {
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-10 items-center border-b px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Smart data</div>
      <EmptyState icon={<BrainIcon className="size-6" />} title="Response memory">
        Previous responses and their JSON paths will appear here.
      </EmptyState>
    </div>
  );
}
