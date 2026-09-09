import type { TAdminRole } from 'librechat-data-provider';
import { reparentBlock, descendantKeys, buildRoleMaps } from '../reparent';

const r = (roleKey: string, name: string, parentRole: string | null = null): TAdminRole => ({
  roleKey,
  name,
  parentRole,
});

/**
 *   SUP
 *    └ MGR
 *        └ EMP
 *   SUPPORT
 *    └ S_EMP
 */
const tree = [
  r('sup', 'SUP'),
  r('mgr', 'MGR', 'sup'),
  r('emp', 'EMP', 'mgr'),
  r('support', 'SUPPORT'),
  r('s_emp', 'S_EMP', 'support'),
];

describe('reparentBlock', () => {
  it('allows a same-branch move that is not a cycle, no-op, or name clash', () => {
    expect(reparentBlock(tree, 'emp', 'sup')).toBeNull();
  });

  it('blocks a cross-branch move', () => {
    expect(reparentBlock(tree, 'mgr', 'support')).toBe('cross-branch');
    expect(reparentBlock(tree, 'emp', 's_emp')).toBe('cross-branch');
  });

  it('blocks moving a role under its own descendant (cycle)', () => {
    expect(reparentBlock(tree, 'sup', 'emp')).toBe('cycle');
  });

  it('treats a move onto the current parent as a no-op', () => {
    expect(reparentBlock(tree, 'emp', 'mgr')).toBe('no-op');
    expect(reparentBlock(tree, 'emp', 'emp')).toBe('no-op');
  });

  it('blocks a move that would duplicate a sibling name', () => {
    const withDupe = [...tree, r('mgr2', 'MGR', 'mgr')];
    expect(reparentBlock(withDupe, 'mgr2', 'sup')).toBe('name-clash');
  });
});

describe('descendantKeys / buildRoleMaps', () => {
  it('collects the whole subtree', () => {
    expect(descendantKeys(tree, 'sup')).toEqual(new Set(['mgr', 'emp']));
    expect(descendantKeys(tree, 'emp').size).toBe(0);
  });

  it('resolves each role to its branch root', () => {
    const { rootKeyByKey } = buildRoleMaps(tree);
    expect(rootKeyByKey.get('emp')).toBe('sup');
    expect(rootKeyByKey.get('s_emp')).toBe('support');
    expect(rootKeyByKey.get('sup')).toBe('sup');
  });
});
