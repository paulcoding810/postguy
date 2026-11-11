import { FileCode2Icon } from 'lucide-react';
import { EmptyState } from '@/components/ui/misc';

export function ApiSpecList() {
  return (
    <EmptyState icon={<FileCode2Icon className="size-6" />} title="OpenAPI import">
      Coming in the next phase.
    </EmptyState>
  );
}
