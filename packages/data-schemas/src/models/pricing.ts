import { Model } from 'mongoose';
import type { IPricingRate } from '~/schema/pricing';
import pricingSchema from '~/schema/pricing';

export function createPricingModel(mongoose: typeof import('mongoose')): Model<IPricingRate> {
  return mongoose.models.PricingRate || mongoose.model<IPricingRate>('PricingRate', pricingSchema);
}
