import { SystemCapabilities } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createHierarchyMiddleware } from './hierarchy';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn() },
}));

function makeReqRes(
  user?: { id: string; role: string },
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  method = 'GET',
) {
  const req = { user, params, body, method } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = jest.fn();
  return { req, res, status, json, next };
}

const capabilityHeld = (cap: string) => (_user: unknown, requested: string) =>
  Promise.resolve(requested === cap);

describe('requireSubordinateAccess', () => {
  it('allows an ADMIN unconditionally', async () => {
    const findUsers = jest.fn();
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn().mockResolvedValue(true),
      findUsers,
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
    });
    const { req, res, next } = makeReqRes({ id: 'admin-1', role: 'ADMIN' }, { userId: 'u1' });

    await requireSubordinateAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(findUsers).not.toHaveBeenCalled();
  });

  it('allows a VIEW_SUBORDINATES holder targeting a descendant', async () => {
    const canViewRole = jest.fn().mockResolvedValue(true);
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.VIEW_SUBORDINATES)),
      findUsers: jest.fn().mockResolvedValue([{ role: 'SALES_EMPLOYEE' }]),
      canViewRole,
      getDescendantRoleKeys: jest.fn(),
    });
    const { req, res, next } = makeReqRes({ id: 'mgr-1', role: 'SALES_MANAGER' }, { userId: 'u1' });

    await requireSubordinateAccess(req, res, next);

    expect(canViewRole).toHaveBeenCalledWith('SALES_MANAGER', 'SALES_EMPLOYEE');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('denies a VIEW_SUBORDINATES holder targeting a non-descendant', async () => {
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.VIEW_SUBORDINATES)),
      findUsers: jest.fn().mockResolvedValue([{ role: 'SUPPORT_EMPLOYEE' }]),
      canViewRole: jest.fn().mockResolvedValue(false),
      getDescendantRoleKeys: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes(
      { id: 'mgr-1', role: 'SALES_MANAGER' },
      { userId: 'u1' },
    );

    await requireSubordinateAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('404s when the target user does not exist', async () => {
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.VIEW_SUBORDINATES)),
      findUsers: jest.fn().mockResolvedValue([]),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes(
      { id: 'mgr-1', role: 'SALES_MANAGER' },
      { userId: 'ghost' },
    );

    await requireSubordinateAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(404);
  });

  it('denies a caller with none of the qualifying capabilities', async () => {
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn().mockResolvedValue(false),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes({ id: 'u-1', role: 'USER' }, { userId: 'u2' });

    await requireSubordinateAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('401s when unauthenticated', async () => {
    const { requireSubordinateAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes(undefined, { userId: 'u1' });

    await requireSubordinateAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});

describe('attachHierarchyScope', () => {
  it('sets a null scope for ADMIN', async () => {
    const getDescendantRoleKeys = jest.fn();
    const { attachHierarchyScope } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.ACCESS_ADMIN)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys,
    });
    const { req, res, next } = makeReqRes({ id: 'admin-1', role: 'ADMIN' });

    await attachHierarchyScope(req, res, next);

    expect(req.hierarchyScope).toBeNull();
    expect(getDescendantRoleKeys).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets viewableRoleKeys for a VIEW_SUBORDINATES holder', async () => {
    const { attachHierarchyScope } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.VIEW_SUBORDINATES)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn().mockResolvedValue(['SALES_EMPLOYEE']),
    });
    const { req, res, next } = makeReqRes({ id: 'mgr-1', role: 'SALES_MANAGER' });

    await attachHierarchyScope(req, res, next);

    expect(req.hierarchyScope).toEqual({ viewableRoleKeys: ['SALES_EMPLOYEE'] });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('403s a caller with no qualifying capability', async () => {
    const { attachHierarchyScope } = createHierarchyMiddleware({
      hasCapability: jest.fn().mockResolvedValue(false),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes({ id: 'u-1', role: 'USER' });

    await attachHierarchyScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});

describe('attachDepartmentScope', () => {
  it('sets a null scope for ACCESS_ADMIN', async () => {
    const getDescendantRoleKeys = jest.fn();
    const { attachDepartmentScope } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.ACCESS_ADMIN)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys,
    });
    const { req, res, next } = makeReqRes({ id: 'admin-1', role: 'ADMIN' });

    await attachDepartmentScope(req, res, next);

    expect(req.departmentScope).toBeNull();
    expect(getDescendantRoleKeys).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets a null scope for MANAGE_ROLES and READ_ROLES holders', async () => {
    for (const cap of [SystemCapabilities.MANAGE_ROLES, SystemCapabilities.READ_ROLES]) {
      const { attachDepartmentScope } = createHierarchyMiddleware({
        hasCapability: jest.fn(capabilityHeld(cap)),
        findUsers: jest.fn(),
        canViewRole: jest.fn(),
        getDescendantRoleKeys: jest.fn(),
      });
      const { req, res, next } = makeReqRes({ id: 'u-1', role: 'SOME_ROLE' });

      await attachDepartmentScope(req, res, next);

      expect(req.departmentScope).toBeNull();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('scopes a DEPARTMENT_HEAD holder to its own branch root plus descendants, root inclusive', async () => {
    const { attachDepartmentScope } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.DEPARTMENT_HEAD)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn().mockResolvedValue(['ACCT_CHILD']),
    });
    const { req, res, next } = makeReqRes({ id: 'head-1', role: 'ACCT_ROOT' });

    await attachDepartmentScope(req, res, next);

    expect(req.departmentScope).toEqual({ roleKeys: ['ACCT_ROOT', 'ACCT_CHILD'] });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('403s a caller with no qualifying capability', async () => {
    const { attachDepartmentScope } = createHierarchyMiddleware({
      hasCapability: jest.fn().mockResolvedValue(false),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes({ id: 'u-1', role: 'USER' });

    await attachDepartmentScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});

describe('requireDepartmentRoleAccess', () => {
  it('allows an ACCESS_ADMIN caller unconditionally, without consulting isDescendantOf', async () => {
    const isDescendantOf = jest.fn();
    const { requireDepartmentRoleAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.ACCESS_ADMIN)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
      isDescendantOf,
    });
    const { req, res, next } = makeReqRes(
      { id: 'admin-1', role: 'ADMIN' },
      { roleKey: 'OTHER_DEPT_ROLE' },
    );

    await requireDepartmentRoleAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(isDescendantOf).not.toHaveBeenCalled();
  });

  it('allows a DEPARTMENT_HEAD holder targeting their own branch root', async () => {
    const { requireDepartmentRoleAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.DEPARTMENT_HEAD)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
      isDescendantOf: jest.fn().mockResolvedValue(false),
    });
    const { req, res, next } = makeReqRes(
      { id: 'head-1', role: 'ACCT_ROOT' },
      { roleKey: 'ACCT_ROOT' },
    );

    await requireDepartmentRoleAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows a DEPARTMENT_HEAD holder targeting a descendant of their own branch', async () => {
    const isDescendantOf = jest.fn().mockResolvedValue(true);
    const { requireDepartmentRoleAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.DEPARTMENT_HEAD)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
      isDescendantOf,
    });
    const { req, res, next } = makeReqRes(
      { id: 'head-1', role: 'ACCT_ROOT' },
      { roleKey: 'ACCT_CHILD' },
    );

    await requireDepartmentRoleAccess(req, res, next);

    expect(isDescendantOf).toHaveBeenCalledWith('ACCT_CHILD', 'ACCT_ROOT');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("403s Department Head A targeting a role in Department B's branch", async () => {
    const isDescendantOf = jest.fn().mockResolvedValue(false);
    const { requireDepartmentRoleAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.DEPARTMENT_HEAD)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
      isDescendantOf,
    });
    const { req, res, next, status } = makeReqRes(
      { id: 'head-a', role: 'DEPT_A_ROOT' },
      { roleKey: 'DEPT_B_CHILD' },
    );

    await requireDepartmentRoleAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('rejects a DEPARTMENT_HEAD holder creating a top-level role (no parentRole)', async () => {
    const { requireDepartmentRoleAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.DEPARTMENT_HEAD)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
      isDescendantOf: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes(
      { id: 'head-1', role: 'ACCT_ROOT' },
      {},
      { name: 'New Branch' },
      'POST',
    );

    await requireDepartmentRoleAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('allows a DEPARTMENT_HEAD holder creating a role under their own branch', async () => {
    const { requireDepartmentRoleAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.DEPARTMENT_HEAD)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
      isDescendantOf: jest.fn().mockResolvedValue(true),
    });
    const { req, res, next } = makeReqRes(
      { id: 'head-1', role: 'ACCT_ROOT' },
      {},
      { name: 'New Child', parentRole: 'ACCT_CHILD' },
      'POST',
    );

    await requireDepartmentRoleAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('403s a caller with no qualifying capability', async () => {
    const { requireDepartmentRoleAccess } = createHierarchyMiddleware({
      hasCapability: jest.fn().mockResolvedValue(false),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
      isDescendantOf: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes({ id: 'u-1', role: 'USER' }, { roleKey: 'X' });

    await requireDepartmentRoleAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
