import { Module } from '@nestjs/common';
import { IpgClientService } from './ipg-client.service';
import { ZarinpalClientService } from './zarinpal-client.service';
import { SadadClientService } from './sadad-client.service';

@Module({
  providers: [IpgClientService, ZarinpalClientService, SadadClientService],
  exports: [IpgClientService, ZarinpalClientService, SadadClientService],
})
export class IpgModule {}
