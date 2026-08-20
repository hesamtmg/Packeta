export interface RailProviderSubmitRequest {
  railSettlementId: string;
  walletId: string;
  amount: string;
  destinationIban: string | null;
  label: string | null;
}

export interface RailProviderSubmitResult {
  success: boolean;
  providerReference: string;
  raw: Record<string, unknown>;
}

// One client per rail (Pol Pay / Paya / Satna / bank transfer) so each can
// be swapped independently for its real HTTP integration later — every real
// rail has a different endpoint, auth scheme, and response shape, so a
// single shared client would just have to branch internally anyway. Mirrors
// the existing IpgClientService/ZarinpalClientService pattern for external
// gateways.
export interface RailProviderClient {
  submit(request: RailProviderSubmitRequest): Promise<RailProviderSubmitResult>;
}
