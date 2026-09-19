import type { Model } from 'mongoose';
import type { IPricingRate } from '~/schema/pricing';

const DUPLICATE_KEY_CODE = 11000;
const STANDARD = 'standard';

export class PricingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingConflictError';
  }
}

export interface StandardRate {
  modelKey: string;
  prompt: number;
  completion: number;
  updatedAt?: Date;
}

export interface StandardRateUpdate {
  prompt?: number;
  completion?: number;
}

export interface PricingMethods {
  listStandardPricingRates: () => Promise<StandardRate[]>;
  createStandardPricingRate: (rate: StandardRate) => Promise<StandardRate>;
  updateStandardPricingRate: (
    modelKey: string,
    update: StandardRateUpdate,
  ) => Promise<StandardRate | null>;
  deleteStandardPricingRate: (modelKey: string) => Promise<boolean>;
}

const PROJECTION = 'modelKey prompt completion updatedAt';

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === DUPLICATE_KEY_CODE;
}

/** CRUD over the `standard` category of `PricingRate`; cache/premium rows are never touched. */
export function createPricingMethods(mongoose: typeof import('mongoose')): PricingMethods {
  const getModel = (): Model<IPricingRate> => mongoose.models.PricingRate as Model<IPricingRate>;

  async function listStandardPricingRates(): Promise<StandardRate[]> {
    return getModel()
      .find({ category: STANDARD }, PROJECTION)
      .sort({ modelKey: 1 })
      .lean<StandardRate[]>();
  }

  async function createStandardPricingRate(rate: StandardRate): Promise<StandardRate> {
    try {
      await getModel().create({
        modelKey: rate.modelKey,
        category: STANDARD,
        prompt: rate.prompt,
        completion: rate.completion,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new PricingConflictError(`A pricing entry for "${rate.modelKey}" already exists`);
      }
      throw error;
    }
    const created = await getModel()
      .findOne({ modelKey: rate.modelKey, category: STANDARD }, PROJECTION)
      .lean<StandardRate>();
    return created ?? rate;
  }

  async function updateStandardPricingRate(
    modelKey: string,
    update: StandardRateUpdate,
  ): Promise<StandardRate | null> {
    return getModel()
      .findOneAndUpdate({ modelKey, category: STANDARD }, { $set: update }, { new: true })
      .select(PROJECTION)
      .lean<StandardRate>();
  }

  async function deleteStandardPricingRate(modelKey: string): Promise<boolean> {
    const result = await getModel().deleteOne({ modelKey, category: STANDARD });
    return result.deletedCount > 0;
  }

  return {
    listStandardPricingRates,
    createStandardPricingRate,
    updateStandardPricingRate,
    deleteStandardPricingRate,
  };
}
