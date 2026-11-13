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
  it('returns full access for ADMIN without calling getDescendantRoleKeys', async () => {
    const getDescendantRoleKeys = jest.fn();
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn().mockResolvedValue(true),
      getDescendantRoleKeys,
      getDepartmentForRoleKey: jest.fn(),
    });
    const { req, res, json } = createReqRes({ id: 'admin-1', role: SystemRoles.ADMIN });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: true,
      canViewSubordinates: true,
      viewableRoleKeys: [],
      manageableRoleKeys: [],
      canReadAuditLog: true,
    });
    expect(getDescendantRoleKeys).not.toHaveBeenCalled();
  });

  it('reflects READ_AUDIT_LOG=false for an ADMIN lacking that capability', async () => {
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.ACCESS_ADMIN)),
      getDescendantRoleKeys: jest.fn(),
      getDepartmentForRoleKey: jest.fn(),
    });
    const { req, res, json } = createReqRes({ id: 'admin-2', role: SystemRoles.ADMIN });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ canReadAuditLog: false }));
  });

  it('returns descendant role names for a VIEW_SUBORDINATES holder', async () => {
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.VIEW_SUBORDINATES)),
      getDescendantRoleKeys: jest.fn().mockResolvedValue(['SALES_EMPLOYEE']),
      getDepartmentForRoleKey: jest.fn(),
    });
    const { req, res, json } = createReqRes({ id: 'mgr-1', role: 'SALES_MANAGER' });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: false,
      canViewSubordinates: true,
      viewableRoleKeys: ['SALES_EMPLOYEE'],
      manageableRoleKeys: ['SALES_EMPLOYEE'],
      departmentHead: undefined,
      canReadAuditLog: false,
    });
  });

  it('reflects READ_AUDIT_LOG=true for a non-admin holder of that capability', async () => {
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.READ_AUDIT_LOG)),
      getDescendantRoleKeys: jest.fn().mockResolvedValue([]),
      getDepartmentForRoleKey: jest.fn(),
    });
    const { req, res, json } = createReqRes({ id: 'auditor-1', role: 'AUDITOR' });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ canReadAuditLog: true }));
  });

  it('returns empty access for a plain USER', async () => {
    const getDescendantRoleKeys = jest.fn();
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn().mockResolvedValue(false),
      getDescendantRoleKeys,
      getDepartmentForRoleKey: jest.fn(),
    });
    const { req, res, json } = createReqRes({ id: 'u-1', role: SystemRoles.USER });

    await handlers.getMyHierarchy(req, res);

    expect(json).toHaveBeenCalledWith({
      isAdmin: false,
      canViewSubordinates: false,
      viewableRoleKeys: [],
      manageableRoleKeys: [],
      departmentHead: undefined,
      canReadAuditLog: false,
    });
    expect(getDescendantRoleKeys).not.toHaveBeenCalled();
  });

  it('populates departmentHead for a DEPARTMENT_HEAD holder whose branch is wrapped', async () => {
    const getDepartmentForRoleKey = jest.fn().mockResolvedValue({
      _id: 'dept-1',
      name: 'Accounting',
      rootRoleKey: 'ACCT_MGR',
    });
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn(capabilityHeld(SystemCapabilities.DEPARTMENT_HEAD)),
      getDescendantRoleKeys: jest.fn().mockResolvedValue([]),
      getDepartmentForRoleKey,
    });
    const { req, res, json } = createReqRes({ id: 'head-1', role: 'ACCT_MGR' });

    await handlers.getMyHierarchy(req, res);

    expect(getDepartmentForRoleKey).toHaveBeenCalledWith('ACCT_MGR', undefined);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        isAdmin: false,
        departmentHead: {
          departmentId: 'dept-1',
          departmentName: 'Accounting',
          rootRoleKey: 'ACCT_MGR',
        },
      }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    const handlers = createAdminHierarchyHandlers({
      hasCapability: jest.fn(),
      getDescendantRoleKeys: jest.fn(),
      getDepartmentForRoleKey: jest.fn(),
    });
    const { req, res, status } = createReqRes(undefined);

    await handlers.getMyHierarchy(req, res);

    expect(status).toHaveBeenCalledWith(401);
  });
});
