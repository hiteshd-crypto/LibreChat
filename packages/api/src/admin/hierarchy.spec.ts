import { SystemRoles } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createAdminHierarchyHandlers } from './hierarchy';

function createReqRes(user?: { id?: string; role?: string }) {
  const req = { user } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

const capabilityHeld = (cap: string) => (_user: unknown, requested: string) =>
  Promise.resolve(requested === cap);

describe('createAdminHierarchyHandlers', () => {
  it('returns full access for ADMIN without calling getDescendantRoleNames', async () => {
    const getDescendantRoleNames = jest.fn();
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn().mockResolvedValue(true),
      getDescendantRoleNames,
    });
    const { req, res, json } = createReqRes({ id: 'admin-1', role: SystemRoles.ADMIN });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: true,
      canViewSubordinates: true,
      viewableRoleNames: [],
      manageableRoleNames: [],
    });
    expect(getDescendantRoleNames).not.toHaveBeenCalled();
  });

  it('returns descendant role names for a VIEW_SUBORDINATES holder', async () => {
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.VIEW_SUBORDINATES)),
      getDescendantRoleNames: jest.fn().mockResolvedValue(['SALES_EMPLOYEE']),
    });
    const { req, res, json } = createReqRes({ id: 'mgr-1', role: 'SALES_MANAGER' });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: false,
      canViewSubordinates: true,
      viewableRoleNames: ['SALES_EMPLOYEE'],
      manageableRoleNames: ['SALES_EMPLOYEE'],
    });
  });

  it('returns empty access for a plain USER', async () => {
    const getDescendantRoleNames = jest.fn();
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn().mockResolvedValue(false),
      getDescendantRoleNames,
    });
    const { req, res, json } = createReqRes({ id: 'u-1', role: SystemRoles.USER });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: false,
      canViewSubordinates: false,
      viewableRoleNames: [],
      manageableRoleNames: [],
    });
    expect(getDescendantRoleNames).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn(),
      getDescendantRoleNames: jest.fn(),
    });
    const { req, res, status } = createReqRes(undefined);

    await handlers.getMyHierarchy(req, res);

    expect(status).toHaveBeenCalledWith(401);
  });
});
