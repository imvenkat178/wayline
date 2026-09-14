// Imported payments are traveler-reported history, not supplier-confirmed refunds or credit.
const amount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function ticketFunding(tickets, journeyId, currency = "USD") {
  const linked = tickets.filter(ticket => ticket.journeyId === journeyId);
  let knownPaidCents = 0;
  let complete = linked.length > 0;
  const groups = new Map();
  for (const [index,ticket] of linked.entries()) {
    const key = ticket.paymentScope === "group" && ticket.paymentGroupId ? "group:"+ticket.paymentGroupId : "ticket:"+(ticket.id??index);
    const prior=groups.get(key);
    if(prior) { if(prior.paidCents!==ticket.paidCents || (prior.currency??"USD")!==(ticket.currency??"USD")) complete=false; continue; }
    groups.set(key,ticket);
    if ((ticket.currency ?? "USD") !== currency || amount(ticket.paidCents) === null) complete = false;
    else knownPaidCents += ticket.paidCents;
  }
  if (!Number.isSafeInteger(knownPaidCents)) throw new RangeError("Payment total is too large");
  return { originalPaidCents: complete ? knownPaidCents : null, knownPaidCents,
    currency, paymentEvidence: "traveler-reported", ticketCount: linked.length };
}

// Supplier adjustments must come from trusted reconciliation, never from imported ticket fields.
// An unchanged leg alone does not establish ticket validity, reuse, or a refund entitlement.
export function recoveryEconomics(journey, alternative, funding = null, confirmed = {}) {
  const currency = alternative.price.currency ?? "USD";
  const paid = typeof funding === "number" ? funding : funding?.originalPaidCents;
  const originalPaidCents = funding?.currency && funding.currency !== currency ? null : amount(paid);
  const replacementCents = amount(alternative.price.totalCents);
  const credit = amount(confirmed.applicableCreditCents) ?? 0;
  const refunded = amount(confirmed.refundsReceivedCents) ?? 0;
  const pending = amount(confirmed.confirmedPendingRefundCents) ?? 0;
  const fees = amount(confirmed.exchangeFeesCents) ?? 0;
  const usedCreditCents = replacementCents === null ? 0 : Math.min(credit, replacementCents + fees);
  const cashRequiredNowCents = replacementCents === null ? null : replacementCents + fees - usedCreditCents;
  const totalSpentCents = originalPaidCents === null || cashRequiredNowCents === null
    ? null : originalPaidCents + cashRequiredNowCents - refunded;
  const originalPrice = amount(journey.price.totalCents);
  return {
    version: 2, currency, cashRequiredNowCents, originalPaidCents,
    knownPaidCents: funding?.knownPaidCents ?? originalPaidCents,
    totalSpentCents, projectedSpendAfterRefundCents: totalSpentCents === null ? null : totalSpentCents - pending,
    confirmedPendingRefundCents: pending, refundsReceivedCents: refunded, usedCreditCents,
    exchangeFeesCents: fees, paymentEvidence: funding?.paymentEvidence ?? "traveler-reported",
    planPriceDifferenceCents: originalPrice !== null && replacementCents !== null &&
      (journey.price.currency ?? "USD") === currency ? replacementCents - originalPrice : null,
    // Compatibility alias now means cash required, never a subtraction of sunk spending.
    incrementalCents: cashRequiredNowCents, basis: replacementCents === null ? "unknown" : "replacement-estimate",
    retainedLegCents: 0, nonrefundableCents: null,
  };
}
