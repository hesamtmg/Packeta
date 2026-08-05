// The label to show for a wallet everywhere one appears (cards, transaction
// from/to, transaction detail): the customer's own custom name if they set
// one, else the wallet type's name — same shape works for both the admin's
// AdminWallet and the customer's own Wallet since both nest a walletType.
export function walletDisplayName(wallet: {
  name: string | null;
  walletType: { name: string };
}): string {
  return wallet.name?.trim() ? wallet.name.trim() : wallet.walletType.name;
}
