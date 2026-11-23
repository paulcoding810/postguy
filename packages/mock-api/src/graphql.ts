import { buildSchema, graphql } from 'graphql';
import { orders, users } from './data.ts';

/** A small GraphQL view of the shop, for trying the GraphQL body mode and schema completion. */
const schema = buildSchema(`
  "A shop customer or admin"
  type User {
    id: ID!
    name: String!
    email: String!
    role: Role!
    orders: [Order!]!
  }
  enum Role { admin customer }
  type Order {
    id: ID!
    status: String!
    total: Float!
    currency: String!
  }
  type Query {
    "One user by id"
    user(id: ID!): User
    users(role: Role): [User!]!
    order(id: ID!): Order
  }
  type Mutation {
    "Renames a user (not kept)"
    renameUser(id: ID!, name: String!): User
  }
`);

const userView = (u: (typeof users)[number]) => ({ ...u, orders: () => orders.filter((o) => o.userId === u.id) });

const root = {
  user: ({ id }: { id: string }) => {
    const u = users.find((x) => String(x.id) === id);
    return u ? userView(u) : null;
  },
  users: ({ role }: { role?: string }) => users.filter((u) => !role || u.role === role).map(userView),
  order: ({ id }: { id: string }) => orders.find((o) => String(o.id) === id) ?? null,
  renameUser: ({ id, name }: { id: string; name: string }) => {
    const u = users.find((x) => String(x.id) === id);
    return u ? { ...userView(u), name } : null;
  },
};

export function runGraphql(body: { query?: unknown; variables?: unknown; operationName?: unknown }) {
  return graphql({
    schema,
    source: typeof body.query === 'string' ? body.query : '',
    rootValue: root,
    variableValues: body.variables && typeof body.variables === 'object' ? (body.variables as Record<string, unknown>) : undefined,
    operationName: typeof body.operationName === 'string' ? body.operationName : undefined,
  });
}
