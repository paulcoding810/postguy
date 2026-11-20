import { toast } from 'sonner';

/** Shows an import's warnings as one toast with a short list, instead of a stack of toasts. */
export function showImportNotes(warnings: string[]) {
  if (!warnings.length) return;
  if (warnings.length === 1) {
    toast.warning(warnings[0]);
    return;
  }
  toast.warning(`${warnings.length} notes on this import`, {
    duration: 12_000,
    description: (
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    ),
  });
}
