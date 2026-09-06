import { SystemCapabilities } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createHierarchyMiddleware } from './hierarchy';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn() },
}));

function makeReqRes(user?: { id: string; role: string }, params: Record<string, string> = {}) {
  const req = { user, params } as unknown as ServerRequest;
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
      getDescendantRoleNames: jest.fn(),
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
      getDescendantRoleNames: jest.fn(),
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
      getDescendantRoleNames: jest.fn(),
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
      getDescendantRoleNames: jest.fn(),
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
      getDescendantRoleNames: jest.fn(),
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
      getDescendantRoleNames: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes(undefined, { userId: 'u1' });

    await requireSubordinateAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});

describe('attachHierarchyScope', () => {
  it('sets a null scope for ADMIN', async () => {
    const getDescendantRoleNames = jest.fn();
    const { attachHierarchyScope } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.ACCESS_ADMIN)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleNames,
    });
    const { req, res, next } = makeReqRes({ id: 'admin-1', role: 'ADMIN' });

    await attachHierarchyScope(req, res, next);

    expect(req.hierarchyScope).toBeNull();
    expect(getDescendantRoleNames).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets viewableRoleNames for a VIEW_SUBORDINATES holder', async () => {
    const { attachHierarchyScope } = createHierarchyMiddleware({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.VIEW_SUBORDINATES)),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleNames: jest.fn().mockResolvedValue(['SALES_EMPLOYEE']),
    });
    const { req, res, next } = makeReqRes({ id: 'mgr-1', role: 'SALES_MANAGER' });

    await attachHierarchyScope(req, res, next);

    expect(req.hierarchyScope).toEqual({ viewableRoleNames: ['SALES_EMPLOYEE'] });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('403s a caller with no qualifying capability', async () => {
    const { attachHierarchyScope } = createHierarchyMiddleware({
      hasCapability: jest.fn().mockResolvedValue(false),
      findUsers: jest.fn(),
      canViewRole: jest.fn(),
      getDescendantRoleNames: jest.fn(),
    });
    const { req, res, next, status } = makeReqRes({ id: 'u-1', role: 'USER' });

    await attachHierarchyScope(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
