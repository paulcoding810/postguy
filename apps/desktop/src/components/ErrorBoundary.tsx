import { TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: React.ReactNode;
  /** What failed, e.g. "This tab". */
  label: string;
  onReset?: () => void;
  resetLabel?: string;
}

/** Keeps a rendering error in one area from blanking the whole app. */
export class ErrorBoundary extends React.Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlertIcon className="size-6 text-destructive" />
        <div className="text-sm font-medium">{this.props.label} hit an error</div>
        <pre className="max-w-xl overflow-auto rounded-md bg-muted p-3 text-left text-xs whitespace-pre-wrap select-text">{error.message}</pre>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          {this.props.onReset && (
            <Button
              size="sm"
              onClick={() => {
                this.props.onReset!();
                this.setState({ error: null });
              }}
            >
              {this.props.resetLabel ?? 'Reset'}
            </Button>
          )}
        </div>
      </div>
    );
  }
}
