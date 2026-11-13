import type { Document, Types } from 'mongoose';

/** A persistent, dismissible in-app alert for a single recipient (e.g. a department
 * head being warned their department crossed a spend threshold). */
export interface INotification extends Document {
  user: Types.ObjectId;
  type: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  metadata?: Record<string, unknown>;
  read: boolean;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}
