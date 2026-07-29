import { Wallet } from './entities/wallet.entity';

export function serializeWallet(wallet: Wallet) {
  return {
    id: wallet.id,
    balance: wallet.balance,
    autoWithdrawTimes: wallet.autoWithdrawTimes,
    purchaseTimeoutSeconds: wallet.purchaseTimeoutSeconds,
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
