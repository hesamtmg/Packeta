import { Module } from '@nestjs/common';
import { IpgClientService } from './ipg-client.service';
import { ZarinpalClientService } from './zarinpal-client.service';

@Module({
  providers: [IpgClientService, ZarinpalClientService],
  exports: [IpgClientService, ZarinpalClientService],
})
export class IpgModule {}
