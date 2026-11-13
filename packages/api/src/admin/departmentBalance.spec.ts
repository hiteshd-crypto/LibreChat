import { Types } from 'mongoose';
import type { IDepartment, IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminDepartmentBalanceDeps } from './departmentBalance';
import type { ServerRequest } from '~/types/http';
import { createAdminDepartmentBalanceHandlers } from './departmentBalance';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const headUserId = new Types.ObjectId().toString();
const memberAId = new Types.ObjectId().toString();
const memberBId = new Types.ObjectId().toString();

function mockDepartment(overrides: Partial<IDepartment> = {}): IDepartment {
  return {
    _id: 'dept-1',
    name: 'Accounting',
    rootRoleKey: 'ACCT_MGR',
    ...overrides,
  } as IDepartment;
}

function mockOtherDepartment(overrides: Partial<IDepartment> = {}): IDepartment {
  return {
    _id: 'dept-2',
    name: 'Other',
    rootRoleKey: 'OTHER_HEAD',
    ...overrides,
  } as IDepartment;
}

function mockMember(userId: string, name: string): IUser {
  return {
    _id: new Types.ObjectId(userId),
    name,
    email: `${name.toLowerCase()}@example.com`,
    role: 'ACCT_MGR',
  } as IUser;
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
    user:
      overrides.user === null
        ? undefined
        : (overrides.user ?? { id: headUserId, role: 'ACCT_MGR' }),
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(
  overrides: Partial<AdminDepartmentBalanceDeps> = {},
): AdminDepartmentBalanceDeps {
  return {
    hasCapability: jest.fn().mockResolvedValue(false),
    getDepartmentById: jest.fn().mockResolvedValue(mockDepartment()),
    getDepartmentForRoleKey: jest.fn().mockResolvedValue(mockDepartment()),
    getDescendantRoleKeys: jest.fn().mockResolvedValue([]),
    findUsers: jest
      .fn()
      .mockResolvedValue([
        mockMember(headUserId, 'Head'),
        mockMember(memberAId, 'MemberA'),
        mockMember(memberBId, 'MemberB'),
      ]),
    getBalancesByUserIds: jest.fn().mockResolvedValue(
      new Map([
        [headUserId, 0],
        [memberAId, 10],
        [memberBId, 20],
      ]),
    ),
    getDepartmentBalance: jest.fn().mockResolvedValue(1000),
    incrementDepartmentBalance: jest.fn().mockResolvedValue(1100),
    checkUserOwnThreshold: jest.fn().mockResolvedValue(undefined),
    commitDisbursementTransaction: jest.fn().mockResolvedValue({
      status: 'committed',
      poolBalance: 900,
      balances: { [memberAId]: 60, [memberBId]: 70 },
    }),
    commitGrantTransaction: jest.fn().mockResolvedValue({
      status: 'committed',
      balances: { [memberAId]: 0, [memberBId]: 30 },
    }),
    recordAuditEntry: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createAdminDepartmentBalanceHandlers', () => {
  describe('getBalance (RBAC)', () => {
    it('allows an ACCESS_ADMIN caller to read any department', async () => {
      const deps = createDeps({ hasCapability: jest.fn().mockResolvedValue(true) });
      const { req, res, status } = createReqRes({ params: { departmentId: 'dept-1' } });
      await createAdminDepartmentBalanceHandlers(deps).getBalance(req, res);
      expect(status).toHaveBeenCalledWith(200);
    });

    it("403s a DEPARTMENT_HEAD-only caller reading someone else's department", async () => {
      const deps = createDeps({
        hasCapability: jest.fn().mockResolvedValue(false),
        getDepartmentForRoleKey: jest.fn().mockResolvedValue(mockOtherDepartment()),
      });
      const { req, res, status } = createReqRes({ params: { departmentId: 'dept-1' } });
      await createAdminDepartmentBalanceHandlers(deps).getBalance(req, res);
      expect(status).toHaveBeenCalledWith(403);
    });

    it('allows a DEPARTMENT_HEAD-only caller reading their own department', async () => {
      const deps = createDeps({ hasCapability: jest.fn().mockResolvedValue(false) });
      const { req, res, status, json } = createReqRes({ params: { departmentId: 'dept-1' } });
      await createAdminDepartmentBalanceHandlers(deps).getBalance(req, res);
      expect(status).toHaveBeenCalledWith(200);
      // poolBalance 1000 + members (0 + 10 + 20) = 1030
      expect(json).toHaveBeenCalledWith({ poolBalance: 1000, totalBalance: 1030 });
    });
  });

  describe('grant', () => {
    it('rejects a non-positive amount', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        params: { departmentId: 'dept-1' },
        body: { amount: 0 },
      });
      await createAdminDepartmentBalanceHandlers(deps).grant(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.incrementDepartmentBalance).not.toHaveBeenCalled();
    });

    it('increments the pool for a valid amount', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({
        params: { departmentId: 'dept-1' },
        body: { amount: 100 },
      });
      await createAdminDepartmentBalanceHandlers(deps).grant(req, res);
      expect(deps.incrementDepartmentBalance).toHaveBeenCalledWith('dept-1', 100, undefined);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ poolBalance: 1100 });
    });
  });

  describe('previewDisburse', () => {
    it('rejects a recipient who is not a current member', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { recipientUserIds: [new Types.ObjectId().toString()], totalAmount: 10 },
      });
      await createAdminDepartmentBalanceHandlers(deps).previewDisburse(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('rejects when totalAmount exceeds the pool balance', async () => {
      const deps = createDeps({ getDepartmentBalance: jest.fn().mockResolvedValue(5) });
      const { req, res, status } = createReqRes({
        body: { recipientUserIds: [memberAId], totalAmount: 10 },
      });
      await createAdminDepartmentBalanceHandlers(deps).previewDisburse(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('previews an even split across valid recipients', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({
        body: { recipientUserIds: [memberAId, memberBId], totalAmount: 100 },
      });
      await createAdminDepartmentBalanceHandlers(deps).previewDisburse(req, res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ poolBalance: 1000, perRecipientAmount: 50 }),
      );
    });
  });

  describe('confirmDisburse', () => {
    const baseBody = {
      recipientUserIds: [memberAId, memberBId],
      totalAmount: 100,
      expectedPoolBalance: 1000,
      expectedBalances: { [memberAId]: 10, [memberBId]: 20 },
    };

    it('maps committed to 200 and checks each recipient own threshold', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ body: baseBody });
      await createAdminDepartmentBalanceHandlers(deps).confirmDisburse(req, res);
      expect(status).toHaveBeenCalledWith(200);
      expect(deps.checkUserOwnThreshold).toHaveBeenCalledWith(memberAId);
      expect(deps.checkUserOwnThreshold).toHaveBeenCalledWith(memberBId);
    });

    it('maps pool_stale to 409', async () => {
      const deps = createDeps({
        commitDisbursementTransaction: jest.fn().mockResolvedValue({
          status: 'pool_stale',
          expectedPoolBalance: 1000,
          currentPoolBalance: 500,
        }),
      });
      const { req, res, status } = createReqRes({ body: baseBody });
      await createAdminDepartmentBalanceHandlers(deps).confirmDisburse(req, res);
      expect(status).toHaveBeenCalledWith(409);
    });

    it('maps pool_insufficient to 409', async () => {
      const deps = createDeps({
        commitDisbursementTransaction: jest
          .fn()
          .mockResolvedValue({ status: 'pool_insufficient', poolBalance: 10, requested: 100 }),
      });
      const { req, res, status } = createReqRes({ body: baseBody });
      await createAdminDepartmentBalanceHandlers(deps).confirmDisburse(req, res);
      expect(status).toHaveBeenCalledWith(409);
    });

    it('maps stale to 409', async () => {
      const deps = createDeps({
        commitDisbursementTransaction: jest.fn().mockResolvedValue({
          status: 'stale',
          stale: [{ userId: memberAId, expected: 10, current: 999 }],
        }),
      });
      const { req, res, status } = createReqRes({ body: baseBody });
      await createAdminDepartmentBalanceHandlers(deps).confirmDisburse(req, res);
      expect(status).toHaveBeenCalledWith(409);
    });

    it('maps unsupported to 409', async () => {
      const deps = createDeps({
        commitDisbursementTransaction: jest.fn().mockResolvedValue({ status: 'unsupported' }),
      });
      const { req, res, status } = createReqRes({ body: baseBody });
      await createAdminDepartmentBalanceHandlers(deps).confirmDisburse(req, res);
      expect(status).toHaveBeenCalledWith(409);
    });
  });

  describe('previewTransfer', () => {
    it('rejects fromUserId === toUserId', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { fromUserId: memberAId, toUserId: memberAId, amount: 5 },
      });
      await createAdminDepartmentBalanceHandlers(deps).previewTransfer(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('rejects an amount exceeding the source balance', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { fromUserId: memberAId, toUserId: memberBId, amount: 999 },
      });
      await createAdminDepartmentBalanceHandlers(deps).previewTransfer(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('previews a valid transfer', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({
        body: { fromUserId: memberAId, toUserId: memberBId, amount: 5 },
      });
      await createAdminDepartmentBalanceHandlers(deps).previewTransfer(req, res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.objectContaining({ userId: memberAId, newBalance: 5 }),
          to: expect.objectContaining({ userId: memberBId, newBalance: 25 }),
        }),
      );
    });
  });

  describe('confirmTransfer', () => {
    it('calls commitGrantTransaction with exactly the 2-participant shape', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: {
          fromUserId: memberAId,
          toUserId: memberBId,
          amount: 5,
          expectedFromBalance: 10,
          expectedToBalance: 20,
        },
      });
      await createAdminDepartmentBalanceHandlers(deps).confirmTransfer(req, res);
      expect(deps.commitGrantTransaction).toHaveBeenCalledWith([
        { userId: memberAId, expectedBalance: 10, newBalance: 5 },
        { userId: memberBId, expectedBalance: 20, newBalance: 25 },
      ]);
      expect(status).toHaveBeenCalledWith(200);
      expect(deps.checkUserOwnThreshold).toHaveBeenCalledWith(memberAId);
      expect(deps.checkUserOwnThreshold).toHaveBeenCalledWith(memberBId);
    });
  });
});
