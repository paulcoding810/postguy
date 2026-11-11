import { EmptyState } from '@/components/ui/misc';

export function DocsTab({ requestId }: { requestId: string | null }) {
  return (
    <EmptyState title="No documentation">
      {requestId ? 'Import an OpenAPI specification to see operation docs here.' : 'Save the request first.'}
    </EmptyState>
  );
}
