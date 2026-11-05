// The real-money payment gateways (PSPs) Packeta can route deposits,
// installment repayments, collections and support top-ups through. Stored
// on each Transaction (ipgProvider) so a payment is always verified with
// the gateway that created it, even if a super-admin switches the active
// gateway while it's still pending.
export enum PaymentGatewayProvider {
  ZARINPAL = 'ZARINPAL',
  SADAD = 'SADAD',
}
