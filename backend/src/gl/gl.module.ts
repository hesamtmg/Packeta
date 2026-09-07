import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlAccount } from './entities/gl-account.entity';
import { GlJournalEntry } from './entities/gl-journal-entry.entity';
import { GlPosting } from './entities/gl-posting.entity';
import { LedgerService } from './ledger.service';

@Module({
  imports: [TypeOrmModule.forFeature([GlAccount, GlJournalEntry, GlPosting])],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class GlModule {}
