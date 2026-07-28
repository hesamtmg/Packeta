import { Wallet } from './entities/wallet.entity';

export function serializeWallet(wallet: Wallet) {
  return {
    id: wallet.id,
    balance: wallet.balance,
    walletType: {
      code: wallet.walletType.code,
      name: wallet.walletType.name,
      allowNegativeBalance: wallet.walletType.allowNegativeBalance,
      creditLimit: wallet.walletType.creditLimit,
      allowWithdraw: wallet.walletType.allowWithdraw,
      allowP2pOut: wallet.walletType.allowP2pOut,
      allowP2pIn: wallet.walletType.allowP2pIn,
    },
    createdAt: wallet.createdAt,
  };
}
