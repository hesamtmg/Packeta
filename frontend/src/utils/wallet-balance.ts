// What a wallet's owner sees as its balance: the real (ledger) balance plus
// any virtual balance on top — e.g. a credit wallet's granted virtual
// credit. A repository's virtualAmount is excluded: that is the unallocated
// pool it grants out to personnel, not money its owner can spend.
// Amounts are minor-unit integer strings, summed as BigInt to stay exact.
interface BalanceWallet {
  balance: string;
  virtualAmount: string | null;
  walletType: { code: string };
}

function toBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return BigInt(Math.round(Number(value)));
  }
}

export function hasVirtualPart(w: BalanceWallet): boolean {
  return w.virtualAmount !== null && w.walletType.code !== 'REPOSITORY';
}

export function displayBalance(w: BalanceWallet): string {
  if (!hasVirtualPart(w)) return w.balance;
  return (toBigInt(w.balance) + toBigInt(w.virtualAmount!)).toString();
}
