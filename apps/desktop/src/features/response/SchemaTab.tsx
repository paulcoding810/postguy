import type { SendResult } from '@postguy/shared';
import { EmptyState } from '@/components/ui/misc';

export function SchemaTab({ requestId }: { requestId: string | null; response: SendResult }) {
  return (
    <EmptyState title="Schema inference">
      {requestId ? 'Schemas appear here once response memory is enabled.' : 'Save the request to remember its response schema.'}
    </EmptyState>
  );
}
