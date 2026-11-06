import { BadRequestException } from '@nestjs/common';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';
import { isRailEnabled } from '../wallet-types/withdrawal-methods';
import { SettlementRailType } from '../rail-settlements/entities/rail-settlement.entity';
import { UpdateWalletDto } from './dto/update-wallet.dto';

// Shared "is this field applicable to this wallet type?" checks — used by
// the customer's own create/update (WalletsController) and by the admin
// panel's wallet edit (AdminController.updateWallet), so both reject the
// same fields for the same wallet types.

// A wallet type the super admin configured payout methods for (see
// WalletType.withdrawalMethods) only lets its wallets pick the rails it
// enabled.
export function assertRailEnabled(
  railType: SettlementRailType | undefined,
  walletType: Pick<WalletType, 'withdrawalMethods'>,
): void {
  if (railType && !isRailEnabled(walletType.withdrawalMethods, railType)) {
    throw new BadRequestException(
      `The ${railType} withdrawal method is not enabled for this wallet type`,
    );
  }
}

export function assertAutoWithdrawCapable(
  value: unknown,
  walletType: { supportsAutoWithdraw: boolean },
  label = 'auto-withdraw scheduling',
): void {
  if (value !== undefined && !walletType.supportsAutoWithdraw) {
    throw new BadRequestException(
      label === 'settlement accounts'
        ? 'This wallet type does not support auto-withdraw scheduling, so settlement accounts are not applicable'
        : 'This wallet type does not support auto-withdraw scheduling',
    );
  }
}

export function assertPurchaseInCapable(
  value: unknown,
  walletType: { allowPurchaseIn: boolean },
  label = 'a verification timeout',
): void {
  if (value !== undefined && !walletType.allowPurchaseIn) {
    throw new BadRequestException(
      `This wallet type does not accept purchases, so ${label} is not applicable`,
    );
  }
}

export function assertVirtualBalanceCapable(
  value: unknown,
  walletType: { hasVirtualBalance: boolean },
): void {
  if (value !== undefined && !walletType.hasVirtualBalance) {
    throw new BadRequestException(
      'This wallet type does not support a virtual balance',
    );
  }
}

// Every field of an UpdateWalletDto checked against the wallet's type.
export function assertUpdateApplicable(
  dto: UpdateWalletDto,
  walletType: WalletType,
): void {
  assertPurchaseInCapable(dto.purchaseTimeoutSeconds, walletType);
  assertAutoWithdrawCapable(
    dto.settlementAccounts,
    walletType,
    'settlement accounts',
  );
  assertAutoWithdrawCapable(dto.railType, walletType, 'a withdrawal rail');
  assertAutoWithdrawCapable(
    dto.railScheduleTimes,
    walletType,
    'a withdrawal rail schedule',
  );
  assertRailEnabled(dto.railType, walletType);
  assertPurchaseInCapable(dto.terminalId, walletType, 'a terminal id');
  assertPurchaseInCapable(dto.acceptorCode, walletType, 'an acceptor code');
  assertPurchaseInCapable(dto.storeName, walletType, 'a store name');
  assertPurchaseInCapable(dto.storeSite, walletType, 'a store site');
  assertPurchaseInCapable(dto.allowedIps, walletType, 'an IP allowlist');
  assertPurchaseInCapable(dto.callbackUrl, walletType, 'a callback URL');
  assertPurchaseInCapable(dto.category, walletType, 'a category');
  assertPurchaseInCapable(dto.subCategory, walletType, 'a sub-category');
  assertVirtualBalanceCapable(dto.virtualAmount, walletType);
}

// The UpdateWalletDto fields as WalletsService.updateForUser takes them.
export function toUpdateOptions(dto: UpdateWalletDto) {
  return {
    name: dto.name,
    purchaseTimeoutSeconds: dto.purchaseTimeoutSeconds,
    settlementAccounts: dto.settlementAccounts,
    restrictedCounterparties: dto.restrictedCounterparties,
    terminalId: dto.terminalId,
    acceptorCode: dto.acceptorCode,
    minTransactionAmount: dto.minTransactionAmount,
    maxTransactionAmount: dto.maxTransactionAmount,
    storeName: dto.storeName,
    storeSite: dto.storeSite,
    allowedIps: dto.allowedIps,
    callbackUrl: dto.callbackUrl,
    category: dto.category,
    subCategory: dto.subCategory,
    virtualAmount: dto.virtualAmount,
    nationalCode: dto.nationalCode,
    railType: dto.railType,
    railScheduleTimes: dto.railScheduleTimes,
  };
}
