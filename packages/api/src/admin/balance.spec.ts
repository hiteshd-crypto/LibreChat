import { Types } from 'mongoose';
import type { IUser } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminBalanceDeps } from './balance';
import { createAdminBalanceHandlers } from './balance';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const userId = new Types.ObjectId().toString();

function createDeps(overrides: Partial<AdminBalanceDeps> = {}): AdminBalanceDeps {
  return {
    getUserById: jest.fn().mockResolvedValue({ _id: userId } as unknown as IUser),
    findBalanceByUser: jest.fn().mockResolvedValue({ tokenCredits: 5000 }),
    upsertBalanceFields: jest.fn().mockResolvedValue({ tokenCredits: 7500 }),
    setBalanceIfUnchanged: jest
      .fn()
      .mockResolvedValue({ status: 'updated', balance: { tokenCredits: 7500 } }),
    ...overrides,
  };
}

function createReqRes(
  overrides: { params?: Record<string, string>; body?: Record<string, unknown> } = {},
) {
  const req = {
    params: overrides.params ?? { userId },
    body: overrides.body ?? {},
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

describe('createAdminBalanceHandlers', () => {
  describe('getBalance', () => {
    it('returns the stored balance', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes();
      await createAdminBalanceHandlers(deps).getBalance(req, res);
      expect(deps.findBalanceByUser).toHaveBeenCalledWith(userId);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ userId, tokenCredits: 5000, hasRecord: true });
    });

    it('reports 0 with hasRecord=false when the user has no balance document', async () => {
      const deps = createDeps({ findBalanceByUser: jest.fn().mockResolvedValue(null) });
      const { req, res, json } = createReqRes();
      await createAdminBalanceHandlers(deps).getBalance(req, res);
      expect(json).toHaveBeenCalledWith({ userId, tokenCredits: 0, hasRecord: false });
    });

    it('rejects a malformed user id with 400', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ params: { userId: 'not-an-id' } });
      await createAdminBalanceHandlers(deps).getBalance(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.getUserById).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown user', async () => {
      const deps = createDeps({ getUserById: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes();
      await createAdminBalanceHandlers(deps).getBalance(req, res);
      expect(status).toHaveBeenCalledWith(404);
      expect(deps.findBalanceByUser).not.toHaveBeenCalled();
    });

    it('returns 500 when the read fails', async () => {
      const deps = createDeps({ findBalanceByUser: jest.fn().mockRejectedValue(new Error('x')) });
      const { req, res, status } = createReqRes();
      await createAdminBalanceHandlers(deps).getBalance(req, res);
      expect(status).toHaveBeenCalledWith(500);
    });
  });

  describe('setBalance', () => {
    it('overwrites tokenCredits and returns the saved value', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({ body: { tokenCredits: 7500 } });
      await createAdminBalanceHandlers(deps).setBalance(req, res);
      expect(deps.upsertBalanceFields).toHaveBeenCalledWith(userId, { tokenCredits: 7500 });
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ userId, tokenCredits: 7500, hasRecord: true });
    });

    it('allows setting the balance to zero', async () => {
      const deps = createDeps({
        upsertBalanceFields: jest.fn().mockResolvedValue({ tokenCredits: 0 }),
      });
      const { req, res, status } = createReqRes({ body: { tokenCredits: 0 } });
      await createAdminBalanceHandlers(deps).setBalance(req, res);
      expect(deps.upsertBalanceFields).toHaveBeenCalledWith(userId, { tokenCredits: 0 });
      expect(status).toHaveBeenCalledWith(200);
    });

    it.each([
      ['a missing value', {}],
      ['a negative value', { tokenCredits: -1 }],
      ['a string', { tokenCredits: '100' }],
      ['NaN', { tokenCredits: Number.NaN }],
      ['Infinity', { tokenCredits: Number.POSITIVE_INFINITY }],
      ['an unsafe integer', { tokenCredits: Number.MAX_SAFE_INTEGER + 2 }],
    ])('rejects %s with 400 and writes nothing', async (_label, body) => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ body });
      await createAdminBalanceHandlers(deps).setBalance(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('rejects a malformed user id with 400', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        params: { userId: '123' },
        body: { tokenCredits: 1 },
      });
      await createAdminBalanceHandlers(deps).setBalance(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('returns 404 and does not create a balance for an unknown user', async () => {
      const deps = createDeps({ getUserById: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({ body: { tokenCredits: 10 } });
      await createAdminBalanceHandlers(deps).setBalance(req, res);
      expect(status).toHaveBeenCalledWith(404);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    describe('with expectedTokenCredits', () => {
      it('saves through the guarded path only, passing the value the admin saw', async () => {
        const deps = createDeps();
        const { req, res, status, json } = createReqRes({
          body: { tokenCredits: 7500, expectedTokenCredits: 5000 },
        });
        await createAdminBalanceHandlers(deps).setBalance(req, res);
        expect(deps.setBalanceIfUnchanged).toHaveBeenCalledWith(userId, 5000, 7500);
        expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ userId, tokenCredits: 7500, hasRecord: true });
      });

      it('accepts null for "no balance record was seen"', async () => {
        const deps = createDeps();
        const { req, res, status } = createReqRes({
          body: { tokenCredits: 100, expectedTokenCredits: null },
        });
        await createAdminBalanceHandlers(deps).setBalance(req, res);
        expect(deps.setBalanceIfUnchanged).toHaveBeenCalledWith(userId, null, 100);
        expect(status).toHaveBeenCalledWith(200);
      });

      it('returns 409 with the current balance when the value changed', async () => {
        const deps = createDeps({
          setBalanceIfUnchanged: jest
            .fn()
            .mockResolvedValue({ status: 'conflict', current: { tokenCredits: 3000 } }),
        });
        const { req, res, status, json } = createReqRes({
          body: { tokenCredits: 7500, expectedTokenCredits: 5000 },
        });
        await createAdminBalanceHandlers(deps).setBalance(req, res);
        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith({
          error: expect.any(String),
          balance: { userId, tokenCredits: 3000, hasRecord: true },
        });
      });

      it('reports hasRecord=false in the 409 when the record does not exist', async () => {
        const deps = createDeps({
          setBalanceIfUnchanged: jest.fn().mockResolvedValue({ status: 'conflict', current: null }),
        });
        const { req, res, json } = createReqRes({
          body: { tokenCredits: 1, expectedTokenCredits: 5000 },
        });
        await createAdminBalanceHandlers(deps).setBalance(req, res);
        expect(json).toHaveBeenCalledWith({
          error: expect.any(String),
          balance: { userId, tokenCredits: 0, hasRecord: false },
        });
      });

      it.each([
        ['negative', -1],
        ['a string', '5'],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
      ])('rejects an expectedTokenCredits that is %s with 400', async (_label, expected) => {
        const deps = createDeps();
        const { req, res, status } = createReqRes({
          body: { tokenCredits: 10, expectedTokenCredits: expected },
        });
        await createAdminBalanceHandlers(deps).setBalance(req, res);
        expect(status).toHaveBeenCalledWith(400);
        expect(deps.setBalanceIfUnchanged).not.toHaveBeenCalled();
        expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
      });

      it('returns 500 when the guarded write fails', async () => {
        const deps = createDeps({
          setBalanceIfUnchanged: jest.fn().mockRejectedValue(new Error('x')),
        });
        const { req, res, status } = createReqRes({
          body: { tokenCredits: 10, expectedTokenCredits: 0 },
        });
        await createAdminBalanceHandlers(deps).setBalance(req, res);
        expect(status).toHaveBeenCalledWith(500);
      });
    });

    it('returns 500 when the write fails', async () => {
      const deps = createDeps({ upsertBalanceFields: jest.fn().mockRejectedValue(new Error('x')) });
      const { req, res, status } = createReqRes({ body: { tokenCredits: 10 } });
      await createAdminBalanceHandlers(deps).setBalance(req, res);
      expect(status).toHaveBeenCalledWith(500);
    });
  });
});
