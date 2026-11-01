# Payments options report (26 Oct 2026)

Research only. Nothing was integrated. The founder decides.

## The short answer
- **Local rail (people in Trinidad and Tobago):** keep cash plus monthly business invoicing now. Plan for the UPI-style instant payment system once it launches. Don't build on any one card provider yet.
- **Visitor rail (US-dollar cards for airport and hotel guests):** the realistic path is a Caribbean card processor that local banks already use. Stripe isn't open to Trinidad and Tobago businesses. Get quotes from two providers before choosing.

## What I checked, and what it says

### 1. WiPay
- **The news:** Trinidad Guardian, Dareece Polo, published 1 Aug 2026 (interview 30 Jul).
  - Social media claimed WiPay mishandled government money from the Ministry of Transport's U-Turn fixed-penalty payments.
  - WiPay's CEO, Aldwyn Wayne, denied it. He said WiPay only provides software (CourtPay) and that payments go straight into government bank accounts. He also said the system did not crash.
  - The ministers did not respond before publication.
- **Earlier report:** Guardian, 3 Aug 2026. First Citizens Bank raised questions about WiPay and NPICTT, the national payments company, being added to U-Turn.
- **What we can't say:** there is no official finding of wrongdoing in anything I read. Treat it as reputation risk, not a verdict.
- **Correction:** I earlier called this "this week's news". The article is from late July and early August; a news feed showed a misleading date.
- **WiPay in our system:** the code is already built (`create_wipay_payment`, `wipay_webhook`, `wipay_disburse`). It returns "coming soon" because no WiPay keys are set. A WiPay sandbox costs nothing to try.

### 2. Stripe
- Stripe's global availability page (stripe.com/global, checked 26 Oct 2026) does not list Trinidad and Tobago, Jamaica or Barbados.
- So a Trinidad-registered company can't open a Stripe account directly.
- The usual workaround is a US company (for example, through Stripe Atlas). That brings US tax filings and isn't a quick switch.
- Our code is built for Stripe (payment intents, webhooks, wallet top-up). The rider app has a test publishable key, so some Stripe account exists. **Founder to confirm whose it is and which country it's registered in.**

### 3. The UPI-style system
- Trinidad and Tobago is building an instant payment system modelled on India's UPI, with NPCI International Payments (Fintech Times, 3 Sep 2026; Open Magazine and ANI, 29 Sep 2026).
- It is meant for government-to-person, person-to-person and person-to-merchant payments, settled instantly around the clock.
- **No public launch date** in anything I found.
- Banking habits today (2023 National Financial Inclusion Survey, quoted by Fintech Times):
  - 75% of people have a bank account, and 88% of those have a debit card;
  - only 24% have a banking app linked to their account;
  - cash still dominates everyday spending.

### 4. Other local options worth a quote (not researched in depth)
- **First Atlantic Commerce / PowerTranz.** This regional card processor joined the Fintech Association of Trinidad and Tobago in 2022 and provides solutions for a Trinidad payments portal (Royal Gazette, 2024). It's a candidate for the visitor US-dollar rail.
- **Bank merchant acquiring:** Republic, First Citizens, RBC and Scotiabank. Slow to set up, but the most trusted.
- **PayWise:** a Central Bank-registered e-money issuer (Fintech Times).

## Recommendation
1. **Now (Phase 1–2):** cash rides, plus monthly invoicing for businesses. Both are already built, and monthly invoicing needs no card system at all. Don't put any partner pitch on a single card provider.
2. **Visitor US-dollar rail (Phase 3, airport):**
   - Get written quotes and onboarding timelines from **First Atlantic Commerce / PowerTranz** and **one bank acquirer**.
   - Use the WiPay sandbox in parallel, because the code exists, and decide on its reputation separately.
   - Stripe is only worth it if you're prepared to run a US company.
3. **Local rail (later):** design rider top-ups so they can add the UPI system as a funding source when it launches. Don't build for it before it exists.

## What only you can do
- Confirm who owns the existing Stripe test account, and in which country it's registered.
- Pick which providers to approach for quotes. The approach itself is outreach, so it's yours to send.
