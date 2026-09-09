import type { TAdminRole } from 'librechat-data-provider';

export type ReparentBlock = 'cross-branch' | 'name-clash' | 'cycle' | 'no-op' | null;

interface RoleMaps {
  byKey: Map<string, TAdminRole>;
  /** roleKey → the roleKey of its top-level branch root. */
  rootKeyByKey: Map<string, string>;
  /** parent roleKey (or '' for top-level) → set of child names. */
  childNamesByParent: Map<string, Set<string>>;
  childrenByParent: Map<string, string[]>;
}

export function buildRoleMaps(roles: TAdminRole[]): RoleMaps {
  const byKey = new Map(roles.map((r) => [r.roleKey, r]));
  const childNamesByParent = new Map<string, Set<string>>();
  const childrenByParent = new Map<string, string[]>();
  for (const role of roles) {
    const parentKey = role.parentRole ?? '';
    const names = childNamesByParent.get(parentKey) ?? new Set<string>();
    names.add(role.name);
    childNamesByParent.set(parentKey, names);
    const kids = childrenByParent.get(parentKey) ?? [];
    kids.push(role.roleKey);
    childrenByParent.set(parentKey, kids);
  }

  const rootKeyByKey = new Map<string, string>();
  const rootOf = (key: string): string => {
    const seen = new Set<string>([key]);
    let current = key;
    let parent = byKey.get(current)?.parentRole ?? null;
    while (parent && byKey.has(parent) && !seen.has(parent)) {
      current = parent;
      seen.add(current);
      parent = byKey.get(current)?.parentRole ?? null;
    }
    return current;
  };
  for (const role of roles) {
    rootKeyByKey.set(role.roleKey, rootOf(role.roleKey));
  }

  return { byKey, rootKeyByKey, childNamesByParent, childrenByParent };
}

export function descendantKeys(roles: TAdminRole[], roleKey: string): Set<string> {
  const { childrenByParent } = buildRoleMaps(roles);
  const out = new Set<string>();
  const queue = [...(childrenByParent.get(roleKey) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (out.has(next)) {
      continue;
    }
    out.add(next);
    queue.push(...(childrenByParent.get(next) ?? []));
  }
  return out;
}

/**
 * Why a drag of `sourceKey` onto `targetKey` (making the target the new parent)
 * is not allowed, or `null` if it is. Mirrors the server's `setRoleParent` guards.
 */
export function reparentBlock(
  roles: TAdminRole[],
  sourceKey: string,
  targetKey: string,
): ReparentBlock {
  if (sourceKey === targetKey) {
    return 'no-op';
  }
  const { byKey, rootKeyByKey, childNamesByParent } = buildRoleMaps(roles);
  const source = byKey.get(sourceKey);
  if (!source) {
    return 'no-op';
  }
  if (rootKeyByKey.get(sourceKey) !== rootKeyByKey.get(targetKey)) {
    return 'cross-branch';
  }
  if (descendantKeys(roles, sourceKey).has(targetKey)) {
    return 'cycle';
  }
  if ((source.parentRole ?? '') === targetKey) {
    return 'no-op';
  }
  if (childNamesByParent.get(targetKey)?.has(source.name)) {
    return 'name-clash';
  }
  return null;
}
