import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActivityLog, ActivityLogSchema } from './schemas/activity-log.schema';
import { LoggingService } from './logging.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ActivityLog.name, schema: ActivityLogSchema },
    ]),
  ],
  providers: [LoggingService],
  exports: [LoggingService],
})
export class LoggingModule {}
