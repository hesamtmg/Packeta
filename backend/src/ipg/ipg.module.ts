import { Module } from '@nestjs/common';
import { IpgClientService } from './ipg-client.service';

@Module({
  providers: [IpgClientService],
  exports: [IpgClientService],
})
export class IpgModule {}
