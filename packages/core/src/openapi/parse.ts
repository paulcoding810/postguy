import SwaggerParser from '@apidevtools/swagger-parser';
import { parse as parseYaml } from 'yaml';

export class SpecError extends Error {}

/** Parses JSON or YAML text into a plain object. */
export function parseSpecText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new SpecError('The specification is empty');
  let doc: unknown;
  try {
    doc = trimmed.startsWith('{') ? JSON.parse(trimmed) : parseYaml(trimmed, { maxAliasCount: 1000 });
  } catch (e) {
    throw new SpecError(`Could not parse specification: ${(e as Error).message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new SpecError('The specification must be an object');
  const d = doc as Record<string, unknown>;
  if (!d.openapi && !d.swagger) throw new SpecError('Missing "openapi" or "swagger" version field');
  return d;
}

export function specVersionOf(doc: Record<string, unknown>): string {
  return String(doc.openapi ?? doc.swagger ?? '');
}

export interface LoadedSpec {
  document: Record<string, unknown>;
  dereferenced: Record<string, unknown>;
  specVersion: string;
  warnings: string[];
}

const OPTIONS = {
  resolve: { external: false },
  dereference: { circular: 'ignore' as const },
};

/**
 * Validates (warnings only) and dereferences a spec. External `$ref`s are not followed,
 * so a spec can never read local files or reach the network.
 */
export async function loadSpec(text: string): Promise<LoadedSpec> {
  const document = parseSpecText(text);
  const specVersion = specVersionOf(document);
  if (!/^(2\.0|3\.[01]\.\d+)/.test(specVersion)) throw new SpecError(`Unsupported specification version "${specVersion}"`);
  const warnings: string[] = [];
  try {
    await SwaggerParser.validate(structuredClone(document) as never, OPTIONS as never);
  } catch (e) {
    warnings.push(`Validation: ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`);
  }
  let dereferenced: Record<string, unknown>;
  try {
    dereferenced = (await SwaggerParser.dereference(structuredClone(document) as never, OPTIONS as never)) as unknown as Record<string, unknown>;
  } catch (e) {
    throw new SpecError(`Could not resolve references: ${(e as Error).message}`);
  }
  return { document, dereferenced, specVersion, warnings };
}
