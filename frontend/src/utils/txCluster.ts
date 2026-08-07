// A single customer-facing action can post more than one ledger row to get
// the job done — a credit wallet purchase alone can write a PURCHASE plus a
// TRANSFER funding it from its repository/support wallet plus a VIRTUAL row
// drawing down its ceiling (see TransactionsService.settleCreditFundedPurchase),
// and reversing one adds the mirror-image legs on top of that. Only some of
// those legs carry an explicit link back to the purchase they belong to
// (relatedPurchaseId/relatedTransactionId/completesPurchaseId); the rest only
// carry it in their idempotencyKey prefix, so both are checked here. Shared
// between the customer dashboard and the admin transactions grid so both
// group the same way.
export interface ClusterableTransaction {
  id: string;
  createdAt: string;
  idempotencyKey?: string | null;
  relatedTransactionId?: string | null;
  relatedPurchaseId?: string | null;
  completesPurchaseId?: string | null;
}

export interface TransactionCluster<T> {
  root: string;
  items: T[];
  primary: T;
}

const SUB_LEG_KEY_PATTERN =
  /^(?:credit-fund|credit-draw|support-fund|credit-fund-reverse|credit-draw-reverse):([0-9a-f-]{36})/i;

export function clusterRootId(tx: ClusterableTransaction): string {
  if (tx.relatedPurchaseId) return tx.relatedPurchaseId;
  if (tx.relatedTransactionId) return tx.relatedTransactionId;
  if (tx.completesPurchaseId) return tx.completesPurchaseId;
  const match = tx.idempotencyKey?.match(SUB_LEG_KEY_PATTERN);
  if (match) return match[1];
  return tx.id;
}

// Groups a list of transactions into clusters by clusterRootId. Whatever's
// left over — the ordinary case — is already its own single-item cluster.
// Callers own sorting the result (and, in a viewer whose own transactions
// don't include the true root leg, `primary` falls back to whichever leg
// they do have).
export function groupTransactionClusters<T extends ClusterableTransaction>(
  items: T[],
): TransactionCluster<T>[] {
  const byRoot = new Map<string, T[]>();
  for (const tx of items) {
    const root = clusterRootId(tx);
    const list = byRoot.get(root);
    if (list) list.push(tx);
    else byRoot.set(root, [tx]);
  }
  return [...byRoot.entries()].map(([root, clusterItems]) => {
    const primary = clusterItems.find((tx) => tx.id === root) ?? clusterItems[0];
    return { root, items: clusterItems, primary };
  });
}
