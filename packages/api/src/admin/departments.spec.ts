import { Types } from 'mongoose';
import { PrincipalType } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas';
import type { IDepartment, IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminDepartmentsDeps } from './departments';
import type { ServerRequest } from '~/types/http';
import { createAdminDepartmentsHandlers } from './departments';

const { DepartmentConflictError } = jest.requireActual('@librechat/data-schemas');

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const headUserId = new Types.ObjectId().toString();

function mockDepartment(overrides: Partial<IDepartment> = {}): IDepartment {
  return {
    _id: 'dept-1',
    name: 'Accounting',
    rootRoleKey: 'ACCT_MGR',
    ...overrides,
  } as IDepartment;
}

function mockHeadUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new Types.ObjectId(headUserId),
    name: 'Head User',
    email: 'head@example.com',
    role: 'ACCT_MGR',
    ...overrides,
  } as IUser;
}

function mockRole(
  overrides: Partial<{ name: string; roleKey: string; parentRole: string | null }> = {},
) {
  return {
    _id: 'role-1',
    name: 'Marketing Manager',
    roleKey: 'MKT_MGR',
    parentRole: null,
    ...overrides,
  };
}

function createReqRes(
  overrides: {
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    user?: { id?: string; _id?: Types.ObjectId; role?: string; tenantId?: string } | null;
  } = {},
) {
  const req = {
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    headers: {},
    user: overrides.user === null ? undefined : (overrides.user ?? { role: 'ACCT_MGR' }),
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminDepartmentsDeps> = {}): AdminDepartmentsDeps {
  return {
    listDepartments: jest.fn().mockResolvedValue([mockDepartment()]),
    createDepartment: jest.fn().mockResolvedValue(mockDepartment()),
    getDepartmentById: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: null })),
    getDepartmentForRoleKey: jest.fn().mockResolvedValue(mockDepartment()),
    renameDepartment: jest.fn().mockResolvedValue(mockDepartment({ name: 'Renamed' })),
    deleteDepartment: jest.fn().mockResolvedValue(mockDepartment()),
    getDescendantRoleKeys: jest.fn().mockResolvedValue([]),
    getRoleByName: jest.fn().mockResolvedValue(mockRole()),
    setDepartmentRootRole: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: 'MKT_MGR' })),
    grantCapability: jest.fn().mockResolvedValue({ grant: null, created: true }),
    revokeCapability: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    findUsers: jest.fn().mockResolvedValue([mockHeadUser()]),
    recordAuditEntry: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createAdminDepartmentsHandlers', () => {
  describe('createDepartment', () => {
    it('wraps an existing top-level role and auto-grants DEPARTMENT_HEAD', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({
        body: { name: 'Accounting', rootRoleKey: 'ACCT_MGR' },
      });
      await createAdminDepartmentsHandlers(deps).createDepartment(req, res);

      expect(deps.createDepartment).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Accounting', rootRoleKey: 'ACCT_MGR' }),
      );
      expect(deps.grantCapability).toHaveBeenCalledWith(
        expect.objectContaining({
          principalType: PrincipalType.ROLE,
          principalId: 'ACCT_MGR',
          capability: 'manage:department',
        }),
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith({ department: mockDepartment() });
    });

    it('creates a completely empty department when rootRoleKey is omitted', async () => {
      const deps = createDeps({
        createDepartment: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: null })),
      });
      const { req, res, status, json } = createReqRes({ body: { name: 'New Dept' } });
      await createAdminDepartmentsHandlers(deps).createDepartment(req, res);

      expect(deps.createDepartment).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Dept', rootRoleKey: undefined }),
      );
      // No role exists yet, so nothing is granted and no audit entry is emitted.
      expect(deps.grantCapability).not.toHaveBeenCalled();
      expect(deps.recordAuditEntry).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith({
        department: expect.objectContaining({ rootRoleKey: null }),
      });
    });

    it('rejects a missing name with 400', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ body: { rootRoleKey: 'ACCT_MGR' } });
      await createAdminDepartmentsHandlers(deps).createDepartment(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('maps a DepartmentConflictError to 409', async () => {
      const deps = createDeps({
        createDepartment: jest.fn().mockRejectedValue(new DepartmentConflictError('conflict')),
      });
      const { req, res, status } = createReqRes({
        body: { name: 'Accounting', rootRoleKey: 'ACCT_MGR' },
      });
      await createAdminDepartmentsHandlers(deps).createDepartment(req, res);
      expect(status).toHaveBeenCalledWith(409);
    });
  });

  describe('listDepartments', () => {
    it('returns every department for an ADMIN-only listing, with a member count', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({});
      await createAdminDepartmentsHandlers(deps).listDepartments(req, res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        departments: [{ ...mockDepartment(), memberCount: 1 }],
      });
    });

    it('counts members across the root role and its descendants', async () => {
      const deps = createDeps({
        getDescendantRoleKeys: jest.fn().mockResolvedValue(['CHILD_ROLE']),
        findUsers: jest.fn().mockResolvedValue([mockHeadUser(), mockHeadUser()]),
      });
      const { req, res, json } = createReqRes({});
      await createAdminDepartmentsHandlers(deps).listDepartments(req, res);
      expect(deps.findUsers).toHaveBeenCalledWith(
        { role: { $in: ['ACCT_MGR', 'CHILD_ROLE'] } },
        '_id',
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ departments: [expect.objectContaining({ memberCount: 2 })] }),
      );
    });
  });

  describe('getMyDepartment', () => {
    it("resolves the caller's own Department", async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({ user: { role: 'ACCT_MGR' } });
      await createAdminDepartmentsHandlers(deps).getMyDepartment(req, res);
      expect(deps.getDepartmentForRoleKey).toHaveBeenCalledWith('ACCT_MGR', undefined);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ department: mockDepartment() });
    });

    it("404s when the caller's role isn't inside any department", async () => {
      const deps = createDeps({ getDepartmentForRoleKey: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({ user: { role: 'LONE_ROLE' } });
      await createAdminDepartmentsHandlers(deps).getMyDepartment(req, res);
      expect(status).toHaveBeenCalledWith(404);
    });

    it('401s when unauthenticated', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ user: null });
      await createAdminDepartmentsHandlers(deps).getMyDepartment(req, res);
      expect(status).toHaveBeenCalledWith(401);
    });
  });

  describe('setDepartmentHead', () => {
    it('wraps an existing unclaimed top-level role and grants DEPARTMENT_HEAD', async () => {
      const deps = createDeps({
        getDepartmentById: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: null })),
        getRoleByName: jest.fn().mockResolvedValue(mockRole()),
        getDepartmentForRoleKey: jest.fn().mockResolvedValue(null),
      });
      const { req, res, status, json } = createReqRes({
        params: { departmentId: 'dept-1' },
        body: { roleKey: 'MKT_MGR' },
      });
      await createAdminDepartmentsHandlers(deps).setDepartmentHead(req, res);

      expect(deps.setDepartmentRootRole).toHaveBeenCalledWith('dept-1', 'MKT_MGR', undefined);
      expect(deps.grantCapability).toHaveBeenCalledWith(
        expect.objectContaining({
          principalType: PrincipalType.ROLE,
          principalId: 'MKT_MGR',
          capability: SystemCapabilities.DEPARTMENT_HEAD,
        }),
      );
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          department: expect.objectContaining({ rootRoleKey: 'MKT_MGR' }),
        }),
      );
    });

    it('400s for a roleKey that is not top-level', async () => {
      const deps = createDeps({
        getDepartmentById: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: null })),
        getRoleByName: jest.fn().mockResolvedValue(mockRole({ parentRole: 'SOME_PARENT' })),
      });
      const { req, res, status } = createReqRes({
        params: { departmentId: 'dept-1' },
        body: { roleKey: 'MKT_MGR' },
      });
      await createAdminDepartmentsHandlers(deps).setDepartmentHead(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.setDepartmentRootRole).not.toHaveBeenCalled();
    });

    it('400s for a system role', async () => {
      const deps = createDeps({
        getDepartmentById: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: null })),
        getRoleByName: jest.fn().mockResolvedValue(mockRole({ name: 'ADMIN', roleKey: 'ADMIN' })),
      });
      const { req, res, status } = createReqRes({
        params: { departmentId: 'dept-1' },
        body: { roleKey: 'ADMIN' },
      });
      await createAdminDepartmentsHandlers(deps).setDepartmentHead(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.setDepartmentRootRole).not.toHaveBeenCalled();
    });

    it('409s when the department already has a head', async () => {
      const deps = createDeps({
        getDepartmentById: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: 'EXISTING' })),
      });
      const { req, res, status } = createReqRes({
        params: { departmentId: 'dept-1' },
        body: { roleKey: 'MKT_MGR' },
      });
      await createAdminDepartmentsHandlers(deps).setDepartmentHead(req, res);
      expect(status).toHaveBeenCalledWith(409);
      expect(deps.getRoleByName).not.toHaveBeenCalled();
    });

    it('409s when the role already heads another department', async () => {
      const deps = createDeps({
        getDepartmentById: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: null })),
        getRoleByName: jest.fn().mockResolvedValue(mockRole()),
        getDepartmentForRoleKey: jest.fn().mockResolvedValue(mockDepartment({ name: 'Sales' })),
      });
      const { req, res, status } = createReqRes({
        params: { departmentId: 'dept-1' },
        body: { roleKey: 'MKT_MGR' },
      });
      await createAdminDepartmentsHandlers(deps).setDepartmentHead(req, res);
      expect(status).toHaveBeenCalledWith(409);
      expect(deps.setDepartmentRootRole).not.toHaveBeenCalled();
    });

    it('404s for an unknown department', async () => {
      const deps = createDeps({ getDepartmentById: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({
        params: { departmentId: 'ghost' },
        body: { roleKey: 'MKT_MGR' },
      });
      await createAdminDepartmentsHandlers(deps).setDepartmentHead(req, res);
      expect(status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteDepartment', () => {
    it('deletes the Department label and revokes DEPARTMENT_HEAD from its root role', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({ params: { departmentId: 'dept-1' } });
      await createAdminDepartmentsHandlers(deps).deleteDepartment(req, res);
      expect(deps.revokeCapability).toHaveBeenCalledWith(
        expect.objectContaining({
          principalType: PrincipalType.ROLE,
          principalId: 'ACCT_MGR',
          capability: 'manage:department',
        }),
      );
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true });
    });

    it('404s when the department does not exist', async () => {
      const deps = createDeps({ deleteDepartment: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({ params: { departmentId: 'ghost' } });
      await createAdminDepartmentsHandlers(deps).deleteDepartment(req, res);
      expect(status).toHaveBeenCalledWith(404);
      expect(deps.revokeCapability).not.toHaveBeenCalled();
    });

    it('still succeeds if revokeCapability throws (logged, not fatal)', async () => {
      const deps = createDeps({
        revokeCapability: jest.fn().mockRejectedValue(new Error('grant lookup failed')),
      });
      const { req, res, status } = createReqRes({ params: { departmentId: 'dept-1' } });
      await createAdminDepartmentsHandlers(deps).deleteDepartment(req, res);
      expect(status).toHaveBeenCalledWith(200);
    });

    it('skips revokeCapability for a department with no root role', async () => {
      const deps = createDeps({
        deleteDepartment: jest.fn().mockResolvedValue(mockDepartment({ rootRoleKey: null })),
      });
      const { req, res, status } = createReqRes({ params: { departmentId: 'dept-1' } });
      await createAdminDepartmentsHandlers(deps).deleteDepartment(req, res);
      expect(deps.revokeCapability).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });
  });
});
