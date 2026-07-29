import { IsString, IsUUID } from 'class-validator';

export class AttachWalletDto {
  @IsString()
  authority: string;

  @IsString()
  sessionToken: string;

  @IsUUID()
  walletId: string;
}
