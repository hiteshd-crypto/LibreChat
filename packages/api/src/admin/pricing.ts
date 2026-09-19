import { logger, PricingConflictError } from '@librechat/data-schemas';
import type {
  TAdminPricingRate,
  TAdminPricingCreateBody,
  TAdminPricingUpdateBody,
} from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const MAX_MODEL_KEY_LENGTH = 200;

interface ModelKeyParams {
  modelKey?: string;
}

interface StoredRate {
  modelKey: string;
  prompt: number;
  completion: number;
  updatedAt?: Date;
}

export interface AdminPricingDeps {
  listStandardPricingRates: () => Promise<StoredRate[]>;
  createStandardPricingRate: (rate: StoredRate) => Promise<StoredRate>;
  updateStandardPricingRate: (
    modelKey: string,
    update: TAdminPricingUpdateBody,
  ) => Promise<StoredRate | null>;
  deleteStandardPricingRate: (modelKey: string) => Promise<boolean>;
  /** Reloads the in-memory pricing tables from MongoDB so a change applies without a restart. */
  reloadPricingCache: () => Promise<void>;
}

function isRateValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function toRow(rate: StoredRate): TAdminPricingRate {
  return {
    modelKey: rate.modelKey,
    prompt: rate.prompt,
    completion: rate.completion,
    updatedAt: rate.updatedAt?.toISOString(),
  };
}

function validateModelKey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_MODEL_KEY_LENGTH ? trimmed : null;
}

type PricingHandler = (req: ServerRequest, res: Response) => Promise<Response>;

export interface AdminPricingHandlers {
  listRates: PricingHandler;
  createRate: PricingHandler;
  updateRate: PricingHandler;
  deleteRate: PricingHandler;
}

export function createAdminPricingHandlers(deps: AdminPricingDeps): AdminPricingHandlers {
  const {
    listStandardPricingRates,
    createStandardPricingRate,
    updateStandardPricingRate,
    deleteStandardPricingRate,
    reloadPricingCache,
  } = deps;

  /** The row is already saved when this runs, so a failed reload is reported, not thrown. */
  async function reloadSafely(): Promise<boolean> {
    try {
      await reloadPricingCache();
      return true;
    } catch (error) {
      logger.error('[adminPricing] pricing cache reload failed:', error);
      return false;
    }
  }

  async function listRates(_req: ServerRequest, res: Response) {
    try {
      const rates = await listStandardPricingRates();
      return res.status(200).json({ rates: rates.map(toRow) });
    } catch (error) {
      logger.error('[adminPricing] listRates error:', error);
      return res.status(500).json({ error: 'Failed to list pricing rates' });
    }
  }

  async function createRate(req: ServerRequest, res: Response) {
    try {
      const body = (req.body ?? {}) as Partial<TAdminPricingCreateBody>;
      const modelKey = validateModelKey(body.modelKey);
      if (!modelKey) {
        return res.status(400).json({ error: 'modelKey is required' });
      }
      if (!isRateValue(body.prompt) || !isRateValue(body.completion)) {
        return res
          .status(400)
          .json({ error: 'prompt and completion must be non-negative numbers' });
      }
      const rate = await createStandardPricingRate({
        modelKey,
        prompt: body.prompt,
        completion: body.completion,
      });
      const cacheReloaded = await reloadSafely();
      return res.status(201).json({ rate: toRow(rate), cacheReloaded });
    } catch (error) {
      if (error instanceof PricingConflictError) {
        return res.status(409).json({ error: error.message });
      }
      logger.error('[adminPricing] createRate error:', error);
      return res.status(500).json({ error: 'Failed to create pricing rate' });
    }
  }

  async function updateRate(req: ServerRequest, res: Response) {
    try {
      const modelKey = validateModelKey((req.params as ModelKeyParams).modelKey);
      if (!modelKey) {
        return res.status(400).json({ error: 'modelKey is required' });
      }
      const body = (req.body ?? {}) as TAdminPricingUpdateBody;
      const update: TAdminPricingUpdateBody = {};
      if (body.prompt !== undefined) {
        if (!isRateValue(body.prompt)) {
          return res.status(400).json({ error: 'prompt must be a non-negative number' });
        }
        update.prompt = body.prompt;
      }
      if (body.completion !== undefined) {
        if (!isRateValue(body.completion)) {
          return res.status(400).json({ error: 'completion must be a non-negative number' });
        }
        update.completion = body.completion;
      }
      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' });
      }
      const rate = await updateStandardPricingRate(modelKey, update);
      if (!rate) {
        return res.status(404).json({ error: 'Pricing rate not found' });
      }
      const cacheReloaded = await reloadSafely();
      return res.status(200).json({ rate: toRow(rate), cacheReloaded });
    } catch (error) {
      logger.error('[adminPricing] updateRate error:', error);
      return res.status(500).json({ error: 'Failed to update pricing rate' });
    }
  }

  async function deleteRate(req: ServerRequest, res: Response) {
    try {
      const modelKey = validateModelKey((req.params as ModelKeyParams).modelKey);
      if (!modelKey) {
        return res.status(400).json({ error: 'modelKey is required' });
      }
      const deleted = await deleteStandardPricingRate(modelKey);
      if (!deleted) {
        return res.status(404).json({ error: 'Pricing rate not found' });
      }
      const cacheReloaded = await reloadSafely();
      return res.status(200).json({ success: true, cacheReloaded });
    } catch (error) {
      logger.error('[adminPricing] deleteRate error:', error);
      return res.status(500).json({ error: 'Failed to delete pricing rate' });
    }
  }

  return { listRates, createRate, updateRate, deleteRate };
}
