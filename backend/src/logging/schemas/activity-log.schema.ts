import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ActivityLogDocument = ActivityLog & Document;

@Schema({ timestamps: true })
export class ActivityLog {
  @Prop({ required: true })
  category: 'AUTH' | 'TRANSACTION' | 'SCHEDULER';

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  success: boolean;

  @Prop()
  userId?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);
