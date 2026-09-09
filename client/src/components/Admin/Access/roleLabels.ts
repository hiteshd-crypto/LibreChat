import type { TAdminRole } from 'librechat-data-provider';

/**
 * Builds a display label per `roleKey`. When a `name` is unique among the given
 * roles the label is just the name; when ≥2 roles share it, those get
 * `` `${name} — ${parentName}` ``, walking further up the ancestor chain until
 * every colliding label is distinct. Sibling uniqueness (enforced server-side)
 * guarantees this terminates.
 */
export function buildRoleLabels(roles: TAdminRole[]): Map<string, string> {
  const byKey = new Map(roles.map((r) => [r.roleKey, r]));
  const nameCount = new Map<string, number>();
  for (const role of roles) {
    nameCount.set(role.name, (nameCount.get(role.name) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  const ambiguous: TAdminRole[] = [];
  for (const role of roles) {
    if ((nameCount.get(role.name) ?? 0) < 2) {
      labels.set(role.roleKey, role.name);
    } else {
      ambiguous.push(role);
    }
  }

  for (const role of ambiguous) {
    let depth = 2;
    let label = chain(role, byKey, depth);
    while (
      ambiguous.some(
        (other) => other.roleKey !== role.roleKey && chain(other, byKey, depth) === label,
      )
    ) {
      depth += 1;
      const next = chain(role, byKey, depth);
      if (next === label) {
        break;
      }
      label = next;
    }
    labels.set(role.roleKey, label);
  }
  return labels;
}

/** The role's name joined with up to `depth - 1` ancestor names, e.g. `LEAD — OPS — SALES`. */
function chain(role: TAdminRole, byKey: Map<string, TAdminRole>, depth: number): string {
  const parts = [role.name];
  let current = role.parentRole ? byKey.get(role.parentRole) : undefined;
  const seen = new Set<string>([role.roleKey]);
  while (current && parts.length < depth && !seen.has(current.roleKey)) {
    parts.push(current.name);
    seen.add(current.roleKey);
    current = current.parentRole ? byKey.get(current.parentRole) : undefined;
  }
  return parts.join(' — ');
}
