import {
  SystemCapabilities,
  isValidCapability,
  expandImplications,
  hasImpliedCapability,
  CAPABILITY_CATEGORIES,
} from './capabilities';

describe('isValidCapability', () => {
  it.each(Object.values(SystemCapabilities))('accepts base capability: %s', (cap) => {
    expect(isValidCapability(cap)).toBe(true);
  });

  it.each(['manage:configs:endpoints', 'read:configs:registration', 'manage:configs:speech'])(
    'accepts section-level capability: %s',
    (cap) => {
      expect(isValidCapability(cap)).toBe(true);
    },
  );

  it.each(['assign:configs:user', 'assign:configs:group', 'assign:configs:role'])(
    'accepts assignment capability: %s',
    (cap) => {
      expect(isValidCapability(cap)).toBe(true);
    },
  );

  it.each([
    '',
    'fake',
    'god:mode',
    'manage:configs:',
    'manage:configs: spaces',
    'manage:configs:a:b',
    'delete:configs:endpoints',
    'assign:configs:admin',
    'assign:configs:',
    'MANAGE:USERS',
    'manage:users:extra',
    'read:configs:end points',
  ])('rejects invalid capability: "%s"', (cap) => {
    expect(isValidCapability(cap)).toBe(false);
  });
});

describe('VIEW_SUBORDINATES capability', () => {
  it('is a valid base capability with the expected string', () => {
    expect(SystemCapabilities.VIEW_SUBORDINATES).toBe('read:subordinates');
    expect(isValidCapability(SystemCapabilities.VIEW_SUBORDINATES)).toBe(true);
  });

  it('neither implies nor is implied by access:admin or read:users', () => {
    expect(expandImplications([SystemCapabilities.VIEW_SUBORDINATES])).toEqual([
      SystemCapabilities.VIEW_SUBORDINATES,
    ]);
    expect(
      hasImpliedCapability(
        [SystemCapabilities.ACCESS_ADMIN, SystemCapabilities.READ_USERS],
        SystemCapabilities.VIEW_SUBORDINATES,
      ),
    ).toBe(false);
    expect(
      hasImpliedCapability([SystemCapabilities.VIEW_SUBORDINATES], SystemCapabilities.READ_USERS),
    ).toBe(false);
  });

  it('is listed under the roles capability category', () => {
    const rolesCategory = CAPABILITY_CATEGORIES.find((category) => category.key === 'roles');
    expect(rolesCategory?.capabilities).toContain(SystemCapabilities.VIEW_SUBORDINATES);
  });
});
