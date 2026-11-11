import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/misc';
import { DialogHost } from '@/components/dialogs';
import { AppShell } from '@/components/layout/AppShell';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { queryClient } from '@/hooks/queries';
import { useApplyTheme, useResolvedTheme } from '@/hooks/useTheme';
import { CollectionSettings } from '@/features/collections/CollectionSettings';
import { EnvironmentManager } from '@/features/environments/EnvironmentManager';
import { SaveDialog } from '@/features/request/SaveDialog';
import { OpenApiImportDialog } from '@/features/openapi/ImportDialog';

export function App() {
  useApplyTheme();
  const theme = useResolvedTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <AppShell />
        <EnvironmentManager />
        <CollectionSettings />
        <SaveDialog />
        <OpenApiImportDialog />
        <CommandPalette />
        <DialogHost />
        <Toaster theme={theme} position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
