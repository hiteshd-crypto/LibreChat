import { Schema } from 'mongoose';
import type { INotification } from '~/types';

const notificationSchema: Schema<INotification> = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    severity: {
      type: String,
      enum: ['info', 'success', 'warning', 'error'],
      default: 'info',
    },
    metadata: { type: Schema.Types.Mixed },
    read: { type: Boolean, default: false },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

export default notificationSchema;
