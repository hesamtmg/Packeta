import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

// The customer's wallets, in the order they want them listed.
export class ReorderWalletsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  walletIds: string[];
}
