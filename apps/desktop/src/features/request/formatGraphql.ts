/** Formats a GraphQL query, keeping {{refs}} as written (they aren't valid GraphQL on their own). */
export async function formatGraphql(query: string): Promise<string> {
  const refs: string[] = [];
  const masked = query.replace(/\{\{[^{}]+\}\}/g, (m) => {
    refs.push(m);
    return `__PGREF${refs.length - 1}__`;
  });
  const [prettier, graphql] = await Promise.all([import('prettier/standalone'), import('prettier/plugins/graphql')]);
  const pretty = await prettier.format(masked, { parser: 'graphql', plugins: [graphql], printWidth: 80 });
  return pretty.replace(/__PGREF(\d+)__/g, (_, i: string) => refs[Number(i)]!).trimEnd();
}
