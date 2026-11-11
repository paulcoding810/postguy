import * as React from 'react';
import type { Suggestion } from './TemplateContext';

/** Response-path suggestions; populated once Smart Response Memory is available. */
export function useResponseSuggestions(_collectionId: string | null): (query: string) => Suggestion[] {
  return React.useCallback(() => [], []);
}
