import type { IPricingRate } from '~/schema/pricing';
import { tokenValues, cacheTokenValues, premiumTokenValues } from './tx';

function replaceContents<T>(target: Record<string, T>, source: Record<string, T>) {
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  Object.assign(target, source);
}

/**
 * Reloads pricing data from MongoDB into the in-memory tables used by
 * createTxMethods(). Call this once at startup, and again whenever an
 * admin edits pricing, to make the change take effect immediately.
 */
export async function loadPricingCache(mongoose: typeof import('mongoose')): Promise<void> {
  const { PricingRate, PricingSetting } = mongoose.models;
  if (!PricingRate || !PricingSetting) {
    return;
  }

  const rates = await PricingRate.find({}).lean<IPricingRate[]>();

  const standard: Record<string, { prompt: number; completion: number }> = {};
  const cache: Record<string, { write: number; read: number }> = {};
  const premium: Record<string, { threshold: number; prompt: number; completion: number }> = {};

  for (const r of rates) {
    if (r.category === 'standard') {
      standard[r.modelKey] = { prompt: r.prompt ?? 0, completion: r.completion ?? 0 };
    } else if (r.category === 'cache') {
      cache[r.modelKey] = { write: r.write ?? 0, read: r.read ?? 0 };
    } else if (r.category === 'premium') {
      premium[r.modelKey] = {
        threshold: r.threshold ?? 0,
        prompt: r.prompt ?? 0,
        completion: r.completion ?? 0,
      };
    }
  }

  replaceContents(tokenValues, standard);
  replaceContents(cacheTokenValues, cache);
  replaceContents(premiumTokenValues, premium);
}
