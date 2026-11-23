import { describe, expect, it } from 'vitest';
import { formatGraphql } from './formatGraphql';

describe('formatGraphql', () => {
  it('formats a one-line query', async () => {
    expect(await formatGraphql('query GetUser($id: ID!) { user(id: $id) { name orders { id total } } }')).toBe(
      'query GetUser($id: ID!) {\n  user(id: $id) {\n    name\n    orders {\n      id\n      total\n    }\n  }\n}',
    );
  });

  it('keeps {{refs}} in values, strings and field names', async () => {
    expect(await formatGraphql('{ user(id: {{userId}}, tag: "{{tag}}") { {{field}} } }')).toBe('{\n  user(id: {{userId}}, tag: "{{tag}}") {\n    {{field}}\n  }\n}');
  });

  it('rejects a query that is not valid GraphQL', async () => {
    await expect(formatGraphql('query { user(')).rejects.toThrow();
  });
});
