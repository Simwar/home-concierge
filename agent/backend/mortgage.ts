/**
 * Mortgage and rent-vs-buy ESTIMATES. Pure arithmetic over labelled
 * assumptions; no lender data, no eligibility decision, not financial advice.
 */

export interface MortgageQuery {
  price_aed: number;
  down_payment_pct?: number;
  years?: number;
  annual_rate_pct?: number;
  buyer_status?: 'expat' | 'uae_national';
  /** Annual rent of a comparable home, for the rent-vs-buy comparison. */
  comparable_annual_rent_aed?: number;
  size_sqft?: number;
  /** Rent-vs-buy horizon in years (default 5). */
  horizon_years?: number;
}

const DEFAULTS = {
  annual_rate_pct: 4.5,
  years: 25,
  service_charge_aed_per_sqft: 18,
  rent_growth_pct: 3,
};

/** Simplified UAE Central Bank LTV caps for a first, ready, owner-occupied home. */
function minDownPaymentPct(price: number, status: 'expat' | 'uae_national'): number {
  if (status === 'uae_national') return price <= 5_000_000 ? 15 : 25;
  return price <= 5_000_000 ? 20 : 30;
}

function monthlyPayment(principal: number, annualRatePct: number, years: number): number {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/** Remaining balance after k monthly payments. */
function balanceAfter(principal: number, annualRatePct: number, years: number, k: number): number {
  const r = annualRatePct / 100 / 12;
  const pmt = monthlyPayment(principal, annualRatePct, years);
  if (r === 0) return principal - pmt * k;
  return principal * Math.pow(1 + r, k) - (pmt * (Math.pow(1 + r, k) - 1)) / r;
}

const round = (n: number) => Math.round(n);

export function estimateMortgage(q: MortgageQuery) {
  const status = q.buyer_status ?? 'expat';
  const minDown = minDownPaymentPct(q.price_aed, status);
  const downPct = q.down_payment_pct ?? Math.max(minDown, 20);
  const years = Math.min(q.years ?? DEFAULTS.years, 25);
  const rate = q.annual_rate_pct ?? DEFAULTS.annual_rate_pct;

  const warnings: string[] = [];
  if (downPct < minDown) {
    warnings.push(
      `A ${downPct}% down payment is below the typical minimum of ${minDown}% for ${status === 'expat' ? 'expat' : 'UAE national'} first-home buyers at this price; banks would normally decline this loan size.`,
    );
  }
  if ((q.years ?? DEFAULTS.years) > 25) warnings.push('UAE mortgage terms are typically capped at 25 years; the estimate uses 25.');

  const down = q.price_aed * (downPct / 100);
  const loan = q.price_aed - down;
  const pmt = monthlyPayment(loan, rate, years);

  // Typical Dubai purchase costs (rounded, simplified).
  const upfront = {
    dld_transfer_fee_4pct: round(q.price_aed * 0.04 + 580),
    mortgage_registration_0_25pct: round(loan * 0.0025 + 290),
    agency_fee_2pct_plus_vat: round(q.price_aed * 0.02 * 1.05),
    bank_arrangement_fee_up_to_1pct: round(Math.min(loan * 0.01, 25_000)),
    valuation_fee: 3_000,
  };
  const upfrontTotal = Object.values(upfront).reduce((s, v) => s + v, 0);
  const serviceCharges = q.size_sqft ? round(q.size_sqft * DEFAULTS.service_charge_aed_per_sqft) : null;

  let rentVsBuy = null;
  if (q.comparable_annual_rent_aed) {
    const h = Math.min(Math.max(q.horizon_years ?? 5, 1), 25);
    let rentTotal = 0;
    for (let y = 0; y < h; y++) rentTotal += q.comparable_annual_rent_aed * Math.pow(1 + DEFAULTS.rent_growth_pct / 100, y);
    const months = Math.min(h * 12, years * 12);
    const balance = balanceAfter(loan, rate, years, months);
    const principalRepaid = loan - balance;
    const interestPaid = pmt * months - principalRepaid;
    const owningCost = interestPaid + upfrontTotal + (serviceCharges ?? q.price_aed * 0.005) * h;
    rentVsBuy = {
      horizon_years: h,
      comparable_monthly_rent_aed: round(q.comparable_annual_rent_aed / 12),
      renting_total_cost_aed: round(rentTotal),
      owning_unrecoverable_cost_aed: round(owningCost),
      owning_cost_breakdown: {
        interest_paid: round(interestPaid),
        upfront_purchase_costs: upfrontTotal,
        service_charges_or_maintenance: round((serviceCharges ?? q.price_aed * 0.005) * h),
      },
      equity_built_from_repayments_aed: round(principalRepaid),
      cheaper_option_on_these_assumptions: rentTotal < owningCost ? 'renting' : 'buying',
      difference_aed: round(Math.abs(rentTotal - owningCost)),
      note: 'Compares money you would not get back (rent vs interest, fees and service charges). Ignores price changes, opportunity cost of the down payment, and selling costs.',
    };
  }

  return {
    label: 'ESTIMATE ONLY: not financial advice and not a mortgage offer. Eligibility, rates and fees are set by lenders.',
    inputs: { price_aed: q.price_aed, buyer_status: status, down_payment_pct: downPct, years, annual_rate_pct: rate },
    assumptions: [
      `Interest rate ${rate}% p.a. fixed for the whole term (illustrative; real rates vary and usually reset after a fixed period).`,
      `Minimum down payment for this buyer and price: ${minDown}% (simplified UAE Central Bank caps for a first, ready, owner-occupied home; off-plan and second homes need more).`,
      'Upfront costs use typical Dubai rates: DLD 4% + AED 580, mortgage registration 0.25% + AED 290, agency 2% + VAT, bank fee up to 1%, valuation ~AED 3,000.',
      `Service charges assumed at AED ${DEFAULTS.service_charge_aed_per_sqft}/sqft/year when size is known, else 0.5% of price per year.`,
      `Rent assumed to rise ${DEFAULTS.rent_growth_pct}% a year in the rent-vs-buy comparison.`,
    ],
    down_payment_aed: round(down),
    loan_amount_aed: round(loan),
    monthly_payment_aed: round(pmt),
    annual_payment_aed: round(pmt * 12),
    total_interest_over_term_aed: round(pmt * years * 12 - loan),
    upfront_costs_aed: { ...upfront, total: upfrontTotal },
    cash_needed_at_purchase_aed: round(down + upfrontTotal),
    annual_service_charges_aed: serviceCharges,
    rent_vs_buy: rentVsBuy,
    warnings,
  };
}
