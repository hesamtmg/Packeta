import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ActivityLog,
  ActivityLogDocument,
} from './schemas/activity-log.schema';

interface LogEntry {
  category: 'AUTH' | 'TRANSACTION';
  action: string;
  success: boolean;
  userId?: string;
  metadata?: Record<string, unknown>;
}

// Audit trail only — never authoritative for financial state. A Mongo write
// failure here must not roll back or block a Postgres transaction that has
// already committed, so failures are caught and logged locally instead of
// thrown.
@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);

  constructor(
    @InjectModel(ActivityLog.name)
    private readonly activityLogModel: Model<ActivityLogDocument>,
  ) {}

  async log(entry: LogEntry): Promise<void> {
    try {
      await this.activityLogModel.create(entry);
    } catch (error) {
      this.logger.error(`Failed to write activity log: ${error}`);
    }
  }
}
