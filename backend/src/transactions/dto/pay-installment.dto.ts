import { IsUUID } from 'class-validator';

export class PayInstallmentDto {
  @IsUUID()
  fromWalletId: string;
}
