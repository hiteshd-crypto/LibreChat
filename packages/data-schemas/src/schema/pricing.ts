import { Schema } from 'mongoose';

export interface IPricingRate {
  modelKey: string;
  category: 'standard' | 'cache' | 'premium' | 'premiumCache';
  prompt?: number;
  completion?: number;
  write?: number;
  read?: number;
  threshold?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const pricingSchema: Schema<IPricingRate> = new Schema(
  {
    modelKey: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['standard', 'cache', 'premium', 'premiumCache'],
      required: true,
      index: true,
    },
    prompt: { type: Number },
    completion: { type: Number },
    write: { type: Number },
    read: { type: Number },
    threshold: { type: Number },
  },
  { timestamps: true },
);

// Prevents duplicate rows for the same model+category pair
pricingSchema.index({ modelKey: 1, category: 1 }, { unique: true });

export default pricingSchema;
