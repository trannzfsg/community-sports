export type OnlinePaymentFeeBreakdown = {
  organiserAmountCents: number;
  platformFeeCents: number;
  stripeFeeRecoveryCents: number;
  playerTotalCents: number;
};

export const DEFAULT_PLATFORM_FEE_BPS = 200;
export const DEFAULT_STRIPE_PROCESSING_FEE_BPS = 170;
export const DEFAULT_STRIPE_PROCESSING_FEE_FIXED_CENTS = 30;

export function dollarsToCents(amount: number) {
  return Math.round(amount * 100);
}

export function centsToDollars(cents: number) {
  return cents / 100;
}

export function formatAud(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(centsToDollars(cents));
}

export function calculateOnlinePaymentFeeBreakdown(input: {
  organiserAmountCents: number;
  platformFeeBps?: number;
  stripeFeeBps?: number;
  stripeFixedFeeCents?: number;
}): OnlinePaymentFeeBreakdown {
  const organiserAmountCents = Math.max(0, Math.round(input.organiserAmountCents));
  const platformFeeBps = input.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS;
  const stripeFeeBps = input.stripeFeeBps ?? DEFAULT_STRIPE_PROCESSING_FEE_BPS;
  const stripeFixedFeeCents = input.stripeFixedFeeCents ?? DEFAULT_STRIPE_PROCESSING_FEE_FIXED_CENTS;
  const platformFeeCents = Math.ceil((organiserAmountCents * platformFeeBps) / 10_000);
  const subtotalCents = organiserAmountCents + platformFeeCents;
  const playerTotalCents = Math.ceil((subtotalCents + stripeFixedFeeCents) / (1 - stripeFeeBps / 10_000));
  const stripeFeeRecoveryCents = Math.max(0, playerTotalCents - subtotalCents);

  return {
    organiserAmountCents,
    platformFeeCents,
    stripeFeeRecoveryCents,
    playerTotalCents,
  };
}
