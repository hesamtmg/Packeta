import { IsString } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  walletTypeCode: string;
}
