import { Types } from 'mongoose';
import type { IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminTokenDistributionDeps } from './tokenDistribution';
import type { ServerRequest } from '~/types/http';
import { createAdminTokenDistributionHandlers } from './tokenDistribution';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const rootId = new Types.ObjectId().toString();
const subA = new Types.ObjectId().toString();
const subB = new Types.ObjectId().toString();
const unrelated = new Types.ObjectId().toString();

function user(id: string, overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new Types.ObjectId(id),
    id,
    name: `User ${id.slice(-4)}`,
    email: `${id.slice(-4)}@example.com`,
    role: 'ROOT_ROLE',
    ...overrides,
  } as unknown as IUser;
}

function createDeps(
  overrides: Partial<AdminTokenDistributionDeps> = {},
): AdminTokenDistributionDeps {
  const usersById = new Map<string, IUser>([
    [rootId, user(rootId, { role: 'ROOT_ROLE' })],
    [subA, user(subA, { role: 'CHILD_ROLE' })],
    [subB, user(subB, { role: 'GRANDCHILD_ROLE' })],
  ]);
  return {
    /** Defaults to a non-ACCESS_ADMIN caller — safe because every fixture above
     * already uses `rootId` as both the request actor and the grant root, so
     * the self-only guard passes trivially unless a test explicitly overrides
     * `reqUser` to simulate a different caller. */
    hasCapability: jest.fn().mockResolvedValue(false),
    getUserById: jest
      .fn()
      .mockImplementation((id: string) => Promise.resolve(usersById.get(id) ?? null)),
    getDescendantRoleKeys: jest.fn().mockResolvedValue(['CHILD_ROLE', 'GRANDCHILD_ROLE']),
    listUsersByRoles: jest
      .fn()
      .mockResolvedValue([usersById.get(subA), usersById.get(subB)].filter(Boolean)),
    getBalancesByUserIds: jest.fn().mockImplementation((ids: string[]) => {
      const map = new Map<string, number>();
      for (const id of ids) map.set(id, 0);
      return Promise.resolve(map);
    }),
    commitGrantTransaction: jest.fn().mockImplementation((participants) =>
      Promise.resolve({
        status: 'committed',
        balances: Object.fromEntries(
          participants.map((p: { userId: string; newBalance: number }) => [p.userId, p.newBalance]),
        ),
      }),
    ),
    checkUserOwnThreshold: jest.fn().mockResolvedValue(undefined),
    recordAuditEntry: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as AdminTokenDistributionDeps;
}

function createReqRes(
  overrides: {
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    reqUser?: Partial<IUser> | null;
  } = {},
) {
  const req = {
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    user: overrides.reqUser === null ? undefined : (overrides.reqUser ?? user(rootId)),
    headers: {},
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

describe('createAdminTokenDistributionHandlers', () => {
  describe('getDescendants', () => {
    it('returns descendant users of the root', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({ params: { rootUserId: rootId } });
      await createAdminTokenDistributionHandlers(deps).getDescendants(req, res);
      expect(deps.getDescendantRoleKeys).toHaveBeenCalledWith('ROOT_ROLE');
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        descendants: [
          { userId: subA, name: expect.any(String), email: expect.any(String) },
          { userId: subB, name: expect.any(String), email: expect.any(String) },
        ],
      });
    });

    it('returns an empty list when the root has no role', async () => {
      const deps = createDeps({
        getUserById: jest.fn().mockResolvedValue(user(rootId, { role: undefined })),
      });
      const { req, res, json } = createReqRes({ params: { rootUserId: rootId } });
      await createAdminTokenDistributionHandlers(deps).getDescendants(req, res);
      expect(json).toHaveBeenCalledWith({ descendants: [] });
      expect(deps.getDescendantRoleKeys).not.toHaveBeenCalled();
    });

    it('rejects a malformed root id with 400', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ params: { rootUserId: 'not-an-id' } });
      await createAdminTokenDistributionHandlers(deps).getDescendants(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('returns 404 for an unknown root user', async () => {
      const deps = createDeps({ getUserById: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({ params: { rootUserId: rootId } });
      await createAdminTokenDistributionHandlers(deps).getDescendants(req, res);
      expect(status).toHaveBeenCalledWith(404);
    });
  });

  describe('previewGrant', () => {
    it('splits evenly across root + recipients with no remainder (integer case)', async () => {
      const deps = createDeps({
        getBalancesByUserIds: jest.fn().mockResolvedValue(
          new Map([
            [rootId, 5],
            [subA, 10],
            [subB, 2],
          ]),
        ),
      });
      const { req, res, status, json } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [subA, subB], totalAmount: 75 },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        perParticipantAmount: 25,
        rows: [
          { userId: rootId, name: expect.any(String), currentBalance: 5, newBalance: 30 },
          { userId: subA, name: expect.any(String), currentBalance: 10, newBalance: 35 },
          { userId: subB, name: expect.any(String), currentBalance: 2, newBalance: 27 },
        ],
      });
    });

    it('rounds a fractional allocation to 6 decimals, applied identically with no remainder', async () => {
      const deps = createDeps({
        getBalancesByUserIds: jest.fn().mockResolvedValue(
          new Map([
            [rootId, 0],
            [subA, 0],
            [subB, 0],
          ]),
        ),
      });
      const { req, res, json } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [subA, subB], totalAmount: 101 },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(json).toHaveBeenCalledWith({
        perParticipantAmount: 33.666667,
        rows: [
          { userId: rootId, name: expect.any(String), currentBalance: 0, newBalance: 33.666667 },
          { userId: subA, name: expect.any(String), currentBalance: 0, newBalance: 33.666667 },
          { userId: subB, name: expect.any(String), currentBalance: 0, newBalance: 33.666667 },
        ],
      });
    });

    it('resolves descendants at arbitrary depth via getDescendantRoleKeys', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [subB], totalAmount: 10 },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(deps.getDescendantRoleKeys).toHaveBeenCalledWith('ROOT_ROLE');
      expect(deps.listUsersByRoles).toHaveBeenCalledWith(['CHILD_ROLE', 'GRANDCHILD_ROLE']);
      expect(status).toHaveBeenCalledWith(200);
    });

    it("rejects a recipient outside the root's hierarchy with 400, server-side", async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [unrelated], totalAmount: 10 },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ invalidRecipients: [unrelated] }),
      );
    });

    it('rejects a duplicated recipient with 400', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [subA, subA], totalAmount: 10 },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('rejects the root user appearing as its own recipient with 400', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [rootId], totalAmount: 10 },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['NaN', Number.NaN],
    ])('rejects a totalAmount that is %s with 400', async (_label, totalAmount) => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [subA], totalAmount },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when the root user does not exist', async () => {
      const deps = createDeps({ getUserById: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [], totalAmount: 10 },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(status).toHaveBeenCalledWith(404);
    });

    it('never calls commitGrantTransaction — preview must not mutate balances', async () => {
      const commitGrantTransaction = jest.fn();
      const deps = createDeps({ commitGrantTransaction });
      const { req, res } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [subA, subB], totalAmount: 100 },
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(commitGrantTransaction).not.toHaveBeenCalled();
    });
  });

  describe('confirmGrant', () => {
    const baseBody = {
      rootUserId: rootId,
      recipientUserIds: [subA, subB],
      totalAmount: 75,
      expectedBalances: { [rootId]: 5, [subA]: 10, [subB]: 2 },
    };

    it('commits the recomputed allocation and returns the new balances', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({ body: baseBody });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(deps.commitGrantTransaction).toHaveBeenCalledWith([
        { userId: rootId, expectedBalance: 5, newBalance: 30 },
        { userId: subA, expectedBalance: 10, newBalance: 35 },
        { userId: subB, expectedBalance: 2, newBalance: 27 },
      ]);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          rows: [
            { userId: rootId, name: expect.any(String), previousBalance: 5, newBalance: 30 },
            { userId: subA, name: expect.any(String), previousBalance: 10, newBalance: 35 },
            { userId: subB, name: expect.any(String), previousBalance: 2, newBalance: 27 },
          ],
        }),
      );
      expect(deps.checkUserOwnThreshold).toHaveBeenCalledWith(rootId);
      expect(deps.checkUserOwnThreshold).toHaveBeenCalledWith(subA);
      expect(deps.checkUserOwnThreshold).toHaveBeenCalledWith(subB);
    });

    it('records a balance.self_grant audit entry when the actor is the root', async () => {
      const deps = createDeps();
      const { req, res } = createReqRes({ body: baseBody });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(deps.recordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'balance.self_grant',
          outcome: 'success',
          target: expect.objectContaining({ type: 'user', id: rootId }),
          metadata: expect.objectContaining({
            kind: 'self_grant',
            recipientCount: 2,
            totalAmount: 75,
            perParticipantAmount: 25,
          }),
        }),
      );
    });

    it('records a balance.departmental_distribution audit entry when an admin grants to a different root', async () => {
      const deps = createDeps({ hasCapability: jest.fn().mockResolvedValue(true) });
      const { req, res } = createReqRes({ body: baseBody, reqUser: user(unrelated) });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(deps.recordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'balance.departmental_distribution',
          outcome: 'success',
          actor: expect.objectContaining({ id: unrelated }),
          target: expect.objectContaining({ type: 'user', id: rootId }),
          metadata: expect.objectContaining({
            kind: 'hierarchical_grant',
            recipientCount: 2,
            totalAmount: 75,
            perParticipantAmount: 25,
          }),
        }),
      );
    });

    it('rejects and credits nothing when a participant balance is stale', async () => {
      const commitGrantTransaction = jest.fn().mockResolvedValue({
        status: 'stale',
        stale: [{ userId: subA, expected: 10, current: 999 }],
      });
      const deps = createDeps({ commitGrantTransaction });
      const { req, res, status, json } = createReqRes({ body: baseBody });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ stale: [{ userId: subA, expected: 10, current: 999 }] }),
      );
      expect(deps.recordAuditEntry).not.toHaveBeenCalled();
    });

    it('rejects with 409 and writes nothing when the deployment has no transaction support', async () => {
      const commitGrantTransaction = jest.fn().mockResolvedValue({ status: 'unsupported' });
      const deps = createDeps({ commitGrantTransaction });
      const { req, res, status } = createReqRes({ body: baseBody });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(409);
      expect(deps.recordAuditEntry).not.toHaveBeenCalled();
    });

    it('rejects a recipient outside the hierarchy with 400, server-side, before committing', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { ...baseBody, recipientUserIds: [unrelated] },
      });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.commitGrantTransaction).not.toHaveBeenCalled();
    });

    it('rejects a duplicated recipient with 400 before committing', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { ...baseBody, recipientUserIds: [subA, subA] },
      });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.commitGrantTransaction).not.toHaveBeenCalled();
    });

    it('rejects the root as its own recipient with 400 before committing', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { ...baseBody, recipientUserIds: [rootId] },
      });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.commitGrantTransaction).not.toHaveBeenCalled();
    });

    it('rejects a missing expectedBalances entry with 400 before committing', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { ...baseBody, expectedBalances: { [rootId]: 5, [subA]: 10 } },
      });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.commitGrantTransaction).not.toHaveBeenCalled();
    });

    it('returns 404 when the root user no longer exists', async () => {
      const deps = createDeps({ getUserById: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({ body: baseBody });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(404);
    });

    it('returns 401 when there is no authenticated actor', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ body: baseBody, reqUser: null });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(401);
      expect(deps.commitGrantTransaction).not.toHaveBeenCalled();
    });
  });

  describe('DEPARTMENT_HEAD self-only guard', () => {
    it('403s a non-ACCESS_ADMIN caller whose rootUserId is not themself (previewGrant)', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [], totalAmount: 10 },
        reqUser: user(subA),
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(status).toHaveBeenCalledWith(403);
      expect(deps.getUserById).not.toHaveBeenCalled();
    });

    it('403s a non-ACCESS_ADMIN caller whose rootUserId is not themself (confirmGrant)', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        body: {
          rootUserId: rootId,
          recipientUserIds: [],
          totalAmount: 10,
          expectedBalances: { [rootId]: 0 },
        },
        reqUser: user(subA),
      });
      await createAdminTokenDistributionHandlers(deps).confirmGrant(req, res);
      expect(status).toHaveBeenCalledWith(403);
      expect(deps.commitGrantTransaction).not.toHaveBeenCalled();
    });

    it('403s a non-ACCESS_ADMIN caller whose rootUserId is not themself (getDescendants)', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        params: { rootUserId: rootId },
        reqUser: user(subA),
      });
      await createAdminTokenDistributionHandlers(deps).getDescendants(req, res);
      expect(status).toHaveBeenCalledWith(403);
      expect(deps.getDescendantRoleKeys).not.toHaveBeenCalled();
    });

    it('allows a non-ACCESS_ADMIN caller acting as root-of-self, distributing to their own descendants', async () => {
      const deps = createDeps({
        getBalancesByUserIds: jest.fn().mockResolvedValue(
          new Map([
            [rootId, 0],
            [subA, 0],
            [subB, 0],
          ]),
        ),
      });
      const { req, res, status, json } = createReqRes({
        body: { rootUserId: rootId, recipientUserIds: [subA, subB], totalAmount: 30 },
        reqUser: user(rootId),
      });
      await createAdminTokenDistributionHandlers(deps).previewGrant(req, res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          perParticipantAmount: 10,
        }),
      );
    });

    it('allows an ACCESS_ADMIN caller to target any rootUserId', async () => {
      const deps = createDeps({ hasCapability: jest.fn().mockResolvedValue(true) });
      const { req, res, status } = createReqRes({
        params: { rootUserId: rootId },
        reqUser: user(subA),
      });
      await createAdminTokenDistributionHandlers(deps).getDescendants(req, res);
      expect(status).toHaveBeenCalledWith(200);
    });
  });
});
