import { Wallet } from './entities/wallet.entity';
import { SettlementSplit } from '../settlement/entities/settlement-split.entity';

function serializeSettlementAccount(row: SettlementSplit) {
  return {
    id: row.id,
    iban: row.iban,
    label: row.label,
    percent: row.percentValue,
  };
}

export function serializeWallet(
  wallet: Wallet,
  settlementAccounts?: SettlementSplit[],
) {
  return {
    id: wallet.id,
    balance: wallet.balance,
    autoWithdrawTimes: wallet.autoWithdrawTimes,
    purchaseTimeoutSeconds: wallet.purchaseTimeoutSeconds,
    settlementAccounts: settlementAccounts?.map(serializeSettlementAccount),
    walletType: {
      id: wallet.walletType.id,
      code: wallet.walletType.code,
      name: wallet.walletType.name,
      allowNegativeBalance: wallet.walletType.allowNegativeBalance,
      creditLimit: wallet.walletType.creditLimit,
      allowWithdraw: wallet.walletType.allowWithdraw,
      allowP2pOut: wallet.walletType.allowP2pOut,
      allowP2pIn: wallet.walletType.allowP2pIn,
      supportsAutoWithdraw: wallet.walletType.supportsAutoWithdraw,
      allowPurchaseOut: wallet.walletType.allowPurchaseOut,
      allowPurchaseIn: wallet.walletType.allowPurchaseIn,
      currency: {
        code: wallet.walletType.currency.code,
        symbol: wallet.walletType.currency.symbol,
        symbolPosition: wallet.walletType.currency.symbolPosition,
        decimalPlaces: wallet.walletType.currency.decimalPlaces,
      },
    },
    createdAt: wallet.createdAt,
  };
}
