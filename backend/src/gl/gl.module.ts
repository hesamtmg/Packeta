import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlAccount } from './entities/gl-account.entity';
import { GlJournalEntry } from './entities/gl-journal-entry.entity';
import { GlPosting } from './entities/gl-posting.entity';
import { LedgerService } from './ledger.service';
import { GlReportingService } from './gl-reporting.service';

@Module({
  imports: [TypeOrmModule.forFeature([GlAccount, GlJournalEntry, GlPosting])],
  providers: [LedgerService, GlReportingService],
  exports: [LedgerService, GlReportingService],
})
export class GlModule {}
