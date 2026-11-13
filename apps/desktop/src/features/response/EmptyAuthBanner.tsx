import { KeyRoundIcon } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import type { EmptyAuthWarning } from '@postguy/shared';
import { Button } from '@/components/ui/button';
import { useInvalidateVariables } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { scopeLabel } from '@/features/template/scopeNote';

/** Explains a credential that went out empty and offers to fill it from a remembered response. */
export function EmptyAuthBanner({ warning, onResend }: { warning: EmptyAuthWarning; onResend?: () => void }) {
  const invalidate = useInvalidateVariables();
  const [busy, setBusy] = React.useState(false);
  const { variable, suggestion } = warning;
  const canFix = !!(variable?.scope && variable.ownerId && suggestion);

  const apply = async () => {
    if (!variable?.scope || !variable.ownerId || !suggestion) return;
    setBusy(true);
    try {
      await api('PUT /variables/:scope/:ownerId/:key', {
        params: { scope: variable.scope, ownerId: variable.ownerId, key: variable.name },
        body: { value: `{{${suggestion.ref}}}` },
      });
      invalidate();
      toast.success(`${variable.name} now reads {{${suggestion.ref}}}`, {
        description: onResend ? 'Sending again.' : 'Send the request again.',
      });
      onResend?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-warning/10 px-3 py-1.5 text-xs text-warning">
      <KeyRoundIcon className="size-3.5 shrink-0" />
      <span>
        {warning.field} is empty, so it was not sent
        {variable ? (
          <>
            : <code className="font-mono">{`{{${variable.name}}}`}</code>
            {variable.scope ? ` (${scopeLabel(variable.scope)})` : ' is not defined'} has no value.
          </>
        ) : (
          '.'
        )}
      </span>
      {canFix && (
        <Button size="xs" variant="outline" className="ml-auto" disabled={busy} onClick={apply}>
          Use {`{{${suggestion!.ref}}}`}
        </Button>
      )}
    </div>
  );
}
