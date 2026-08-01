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
    purchaseTimeoutSeconds: wallet.purchaseTimeoutSeconds,
    restrictedCounterparties: wallet.restrictedCounterparties,
    closedAt: wallet.closedAt,
    blockedAt: wallet.blockedAt,
    terminalId: wallet.terminalId,
    acceptorCode: wallet.acceptorCode,
    minTransactionAmount: wallet.minTransactionAmount,
    maxTransactionAmount: wallet.maxTransactionAmount,
    storeName: wallet.storeName,
    storeSite: wallet.storeSite,
    allowedIps: wallet.allowedIps,
    callbackUrl: wallet.callbackUrl,
    category: wallet.category,
    subCategory: wallet.subCategory,
    virtualAmount: wallet.virtualAmount,
    nationalCode: wallet.nationalCode,
    repositoryWalletId: wallet.repositoryWalletId,
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
      autoWithdrawTimes: wallet.walletType.autoWithdrawTimes,
      allowPurchaseOut: wallet.walletType.allowPurchaseOut,
      allowPurchaseIn: wallet.walletType.allowPurchaseIn,
      depositable: wallet.walletType.depositable,
      installmentDate: wallet.walletType.installmentDate,
      paymentDeadlineDate: wallet.walletType.paymentDeadlineDate,
      fee: wallet.walletType.fee,
      penalty: wallet.walletType.penalty,
      unblockFee: wallet.walletType.unblockFee,
      installmentCount: wallet.walletType.installmentCount,
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
