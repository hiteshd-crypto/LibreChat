import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminPricingDeps } from './pricing';
import { createAdminPricingHandlers } from './pricing';

const { PricingConflictError } = jest.requireActual('@librechat/data-schemas');

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const updatedAt = new Date('2026-09-19T00:00:00.000Z');
const storedRate = { modelKey: 'gpt-4o', prompt: 2.5, completion: 10, updatedAt };

function createDeps(overrides: Partial<AdminPricingDeps> = {}): AdminPricingDeps {
  return {
    listStandardPricingRates: jest.fn().mockResolvedValue([storedRate]),
    createStandardPricingRate: jest.fn().mockResolvedValue(storedRate),
    updateStandardPricingRate: jest.fn().mockResolvedValue(storedRate),
    deleteStandardPricingRate: jest.fn().mockResolvedValue(true),
    reloadPricingCache: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createReqRes(
  overrides: { params?: Record<string, string>; body?: Record<string, unknown> } = {},
) {
  const req = {
    params: overrides.params ?? {},
    body: overrides.body ?? {},
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

describe('createAdminPricingHandlers', () => {
  describe('listRates', () => {
    it('returns the standard rates serialized for the client', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes();
      await createAdminPricingHandlers(deps).listRates(req, res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({
        rates: [
          { modelKey: 'gpt-4o', prompt: 2.5, completion: 10, updatedAt: updatedAt.toISOString() },
        ],
      });
    });

    it('returns 500 when the read fails', async () => {
      const deps = createDeps({
        listStandardPricingRates: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const { req, res, status } = createReqRes();
      await createAdminPricingHandlers(deps).listRates(req, res);
      expect(status).toHaveBeenCalledWith(500);
    });
  });

  describe('createRate', () => {
    const body = { modelKey: ' gpt-4o ', prompt: 2.5, completion: 10 };

    it('creates a trimmed row, reloads the cache, and returns 201', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({ body });
      await createAdminPricingHandlers(deps).createRate(req, res);
      expect(deps.createStandardPricingRate).toHaveBeenCalledWith({
        modelKey: 'gpt-4o',
        prompt: 2.5,
        completion: 10,
      });
      expect(deps.reloadPricingCache).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ cacheReloaded: true }));
    });

    it.each([
      ['a missing modelKey', { prompt: 1, completion: 1 }],
      ['a blank modelKey', { modelKey: '   ', prompt: 1, completion: 1 }],
      ['a negative prompt', { modelKey: 'm', prompt: -1, completion: 1 }],
      ['a non-numeric completion', { modelKey: 'm', prompt: 1, completion: '2' }],
      ['a NaN prompt', { modelKey: 'm', prompt: Number.NaN, completion: 1 }],
    ])('rejects %s with 400 and writes nothing', async (_label, badBody) => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({ body: badBody });
      await createAdminPricingHandlers(deps).createRate(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.createStandardPricingRate).not.toHaveBeenCalled();
      expect(deps.reloadPricingCache).not.toHaveBeenCalled();
    });

    it('returns 409 when the model already has an entry', async () => {
      const deps = createDeps({
        createStandardPricingRate: jest
          .fn()
          .mockRejectedValue(new PricingConflictError('A pricing entry already exists')),
      });
      const { req, res, status, json } = createReqRes({ body });
      await createAdminPricingHandlers(deps).createRate(req, res);
      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith({ error: 'A pricing entry already exists' });
      expect(deps.reloadPricingCache).not.toHaveBeenCalled();
    });

    it('still returns 201 with cacheReloaded=false when the reload fails', async () => {
      const deps = createDeps({
        reloadPricingCache: jest.fn().mockRejectedValue(new Error('reload failed')),
      });
      const { req, res, status, json } = createReqRes({ body });
      await createAdminPricingHandlers(deps).createRate(req, res);
      expect(status).toHaveBeenCalledWith(201);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ cacheReloaded: false }));
    });
  });

  describe('updateRate', () => {
    it('updates only the provided fields and reloads the cache', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        params: { modelKey: 'gpt-4o' },
        body: { prompt: 3 },
      });
      await createAdminPricingHandlers(deps).updateRate(req, res);
      expect(deps.updateStandardPricingRate).toHaveBeenCalledWith('gpt-4o', { prompt: 3 });
      expect(deps.reloadPricingCache).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(200);
    });

    it('allows a rate of zero', async () => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        params: { modelKey: 'gpt-4o' },
        body: { completion: 0 },
      });
      await createAdminPricingHandlers(deps).updateRate(req, res);
      expect(status).toHaveBeenCalledWith(200);
    });

    it.each([
      ['a negative value', { prompt: -2 }],
      ['a non-numeric value', { completion: 'x' }],
      ['an empty body', {}],
    ])('rejects %s with 400', async (_label, badBody) => {
      const deps = createDeps();
      const { req, res, status } = createReqRes({
        params: { modelKey: 'gpt-4o' },
        body: badBody,
      });
      await createAdminPricingHandlers(deps).updateRate(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(deps.updateStandardPricingRate).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown model without reloading', async () => {
      const deps = createDeps({ updateStandardPricingRate: jest.fn().mockResolvedValue(null) });
      const { req, res, status } = createReqRes({
        params: { modelKey: 'nope' },
        body: { prompt: 1 },
      });
      await createAdminPricingHandlers(deps).updateRate(req, res);
      expect(status).toHaveBeenCalledWith(404);
      expect(deps.reloadPricingCache).not.toHaveBeenCalled();
    });
  });

  describe('deleteRate', () => {
    it('deletes the row and reloads the cache', async () => {
      const deps = createDeps();
      const { req, res, status, json } = createReqRes({ params: { modelKey: 'gpt-4o' } });
      await createAdminPricingHandlers(deps).deleteRate(req, res);
      expect(deps.deleteStandardPricingRate).toHaveBeenCalledWith('gpt-4o');
      expect(deps.reloadPricingCache).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ success: true, cacheReloaded: true });
    });

    it('returns 404 when nothing was deleted', async () => {
      const deps = createDeps({ deleteStandardPricingRate: jest.fn().mockResolvedValue(false) });
      const { req, res, status } = createReqRes({ params: { modelKey: 'nope' } });
      await createAdminPricingHandlers(deps).deleteRate(req, res);
      expect(status).toHaveBeenCalledWith(404);
      expect(deps.reloadPricingCache).not.toHaveBeenCalled();
    });
  });
});
