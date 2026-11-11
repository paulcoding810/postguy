import type { CollectionTreeNode } from '@postguy/shared';

export interface FlatFolder {
  id: string;
  name: string;
  depth: number;
  path: string;
  kind: CollectionTreeNode['kind'];
}

export function flattenFolders(tree: CollectionTreeNode[] | undefined): FlatFolder[] {
  const out: FlatFolder[] = [];
  const walk = (nodes: CollectionTreeNode[], depth: number, prefix: string) => {
    for (const n of nodes) {
      const path = prefix ? `${prefix} / ${n.name}` : n.name;
      out.push({ id: n.id, name: n.name, depth, path, kind: n.kind });
      walk(n.children, depth + 1, path);
    }
  };
  walk(tree ?? [], 0, '');
  return out;
}

/** Collection chain from root to the node. */
export function chainTo(tree: CollectionTreeNode[] | undefined, id: string | null): CollectionTreeNode[] {
  if (!id || !tree) return [];
  const search = (nodes: CollectionTreeNode[], trail: CollectionTreeNode[]): CollectionTreeNode[] | null => {
    for (const n of nodes) {
      const next = [...trail, n];
      if (n.id === id) return next;
      const found = search(n.children, next);
      if (found) return found;
    }
    return null;
  };
  return search(tree, []) ?? [];
}

export function inheritedAuthSource(tree: CollectionTreeNode[] | undefined, collectionId: string | null): string | null {
  const chain = chainTo(tree, collectionId).reverse();
  const src = chain.find((c) => c.auth.type !== 'inherit');
  return src ? `${src.name} (${src.auth.type})` : null;
}

export function findNode(tree: CollectionTreeNode[] | undefined, id: string): CollectionTreeNode | null {
  return chainTo(tree, id).at(-1) ?? null;
}

export function allRequests(tree: CollectionTreeNode[] | undefined) {
  const out: (CollectionTreeNode['requests'][number] & { path: string })[] = [];
  for (const f of flattenFolders(tree)) {
    const node = findNode(tree, f.id);
    for (const r of node?.requests ?? []) out.push({ ...r, path: f.path });
  }
  return out;
}
