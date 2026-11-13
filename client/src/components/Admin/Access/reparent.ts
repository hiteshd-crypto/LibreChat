import type { TAdminRole } from 'librechat-data-provider';

export type ReparentBlock = 'cross-branch' | 'cycle' | 'no-op' | null;

interface RoleMaps {
  byKey: Map<string, TAdminRole>;
  /** roleKey → the roleKey of its top-level branch root. */
  rootKeyByKey: Map<string, string>;
  childrenByParent: Map<string, string[]>;
}

export function buildRoleMaps(roles: TAdminRole[]): RoleMaps {
  const byKey = new Map(roles.map((r) => [r.roleKey, r]));
  const childrenByParent = new Map<string, string[]>();
  for (const role of roles) {
    const parentKey = role.parentRole ?? '';
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

  return { byKey, rootKeyByKey, childrenByParent };
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
  const { byKey, rootKeyByKey } = buildRoleMaps(roles);
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
  return null;
}
