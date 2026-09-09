import type { TAdminRole } from 'librechat-data-provider';
import { buildRoleLabels } from '../roleLabels';

const r = (roleKey: string, name: string, parentRole: string | null = null): TAdminRole => ({
  roleKey,
  name,
  parentRole,
});

describe('buildRoleLabels', () => {
  it('uses the bare name when unique', () => {
    const labels = buildRoleLabels([r('k1', 'SALES_MANAGER'), r('k2', 'HR_MANAGER')]);
    expect(labels.get('k1')).toBe('SALES_MANAGER');
    expect(labels.get('k2')).toBe('HR_MANAGER');
  });

  it('appends the parent name when two roles share a name', () => {
    const roles = [
      r('p1', 'OPS_SALES'),
      r('p2', 'OPS_HR'),
      r('c1', 'LEAD', 'p1'),
      r('c2', 'LEAD', 'p2'),
    ];
    const labels = buildRoleLabels(roles);
    expect(labels.get('c1')).toBe('LEAD — OPS_SALES');
    expect(labels.get('c2')).toBe('LEAD — OPS_HR');
    expect(labels.get('p1')).toBe('OPS_SALES');
  });

  it('walks further up when the parent names also collide', () => {
    const roles = [
      r('g1', 'SALES'),
      r('g2', 'HR'),
      r('p1', 'OPS', 'g1'),
      r('p2', 'OPS', 'g2'),
      r('c1', 'LEAD', 'p1'),
      r('c2', 'LEAD', 'p2'),
    ];
    const labels = buildRoleLabels(roles);
    expect(labels.get('c1')).toBe('LEAD — OPS — SALES');
    expect(labels.get('c2')).toBe('LEAD — OPS — HR');
  });

  it('does not loop on a malformed cycle', () => {
    const roles = [r('x', 'DUP', 'y'), r('y', 'DUP', 'x')];
    const labels = buildRoleLabels(roles);
    expect(labels.get('x')).toBeDefined();
    expect(labels.get('y')).toBeDefined();
  });

  it('returns an empty map for no roles', () => {
    expect(buildRoleLabels([]).size).toBe(0);
  });
});
