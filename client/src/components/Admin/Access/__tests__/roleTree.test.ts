import type { TAdminRole } from 'librechat-data-provider';
import { orderRolesByTree } from '../roleTree';

/** Fixtures use the name as the roleKey so `parentRole` references stay readable. */
const r = (name: string, parentRole: string | null = null): TAdminRole => ({
  roleKey: name,
  name,
  parentRole,
});

describe('orderRolesByTree', () => {
  it('orders each subtree directly under its parent, siblings by name', () => {
    // Server returns these alphabetically; the tree order should regroup them.
    const roles = [
      r('ADMIN'),
      r('HP_1', 'HR_OPS'),
      r('HR_MANAGER'),
      r('HR_OPS', 'HR_MANAGER'),
      r('MANAGER OPS- SALES', 'SALES_MANAGER'),
      r('SALES-1', 'MANAGER OPS- SALES'),
      r('SALES_MANAGER'),
      r('USER'),
    ];

    expect(
      orderRolesByTree(roles).map(({ role, depth }) => `${'  '.repeat(depth)}${role.name}`),
    ).toEqual([
      'ADMIN',
      'HR_MANAGER',
      '  HR_OPS',
      '    HP_1',
      'SALES_MANAGER',
      '  MANAGER OPS- SALES',
      '    SALES-1',
      'USER',
    ]);
  });

  it('computes depth from the visible tree, not the stored depth field', () => {
    const roles: TAdminRole[] = [
      { roleKey: 'A', name: 'A', parentRole: null, depth: 0 },
      { roleKey: 'B', name: 'B', parentRole: 'A', depth: 5 },
    ];
    expect(orderRolesByTree(roles).map((o) => o.depth)).toEqual([0, 1]);
  });

  it('treats a role whose parent is filtered out as a root', () => {
    const roles = [r('SALES-1', 'MANAGER OPS- SALES')];
    expect(orderRolesByTree(roles)).toEqual([{ role: roles[0], depth: 0 }]);
  });

  it('does not loop on a malformed cycle and still lists every role', () => {
    const roles = [r('X', 'Y'), r('Y', 'X')];
    const out = orderRolesByTree(roles);
    expect(out.map((o) => o.role.name).sort()).toEqual(['X', 'Y']);
  });

  it('returns an empty array for no roles', () => {
    expect(orderRolesByTree([])).toEqual([]);
  });
});
