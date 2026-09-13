# Phase 0 — Legal & business-registration facts (2026-08-14)

Real answers, sourced. Lawyer-needed flags are explicit, not implied.

## 1. TTBizLink company registration status

**Unresolved — needs your input, not a search result.** I confirmed the
real *process* (name search → name reservation → incorporation via
TTBizLink, administered by the Companies Registry under the Ministry of
Legal Affairs; typical timeline 3–6 weeks; setup cost averaging ~$505)
[[How to register a company in Trinidad and Tobago in 2026](https://www.usemultiplier.com/trinidad-and-tobago/company-registration)],
but **whether a specific company's registration is done, in progress, or
not started is private filing status** — not publicly searchable without
the exact registered business name, and I don't have that recorded
anywhere in this session's memory. Tell me the registered (or intended)
company name and I can check TTBizLink's public name-search/status
lookup directly; otherwise this stays open.

## 2. T&T Data Protection Act, 2011 — proclamation status

**Confirmed: still only partially in force, as of the most recent
reporting found (February 2025, no update since).** Part I and Sections
7–18, 22, 23, 25(1), 26, and 28 came into operation 6 January 2012 — this
is the "General Privacy Principles" chapter. The sections that would let
an individual actually *enforce* their rights (complaints to an
Information Commissioner, etc.) have never been proclaimed
[[The Data Protection Act 2011, Securing Privacy In Trinidad](https://caseguard.com/articles/the-data-protection-act-2011-securing-privacy-in-trinidad/)] [[DPA General Privacy Principles](https://ttcsirt.gov.tt/data-protection/)] [[The Data Protection Act, 2011 – Parliament](https://www.ttparliament.org/publication/the-data-protection-act-2011/)].

**What this means for a real privacy policy:** the collection/use/
retention/security principles in Part I + ss.7–18 are nominally binding
law today — a privacy policy should be written against *those specific
sections*, not a generic GDPR template. But there is currently no
statutory complaints mechanism or Information Commissioner enforcement
path in force, which materially changes what "your rights under T&T law"
can honestly say in a consumer-facing document. **Flag for a lawyer:**
whether a consent/privacy policy should reference GDPR-style rights
voluntarily (as a business commitment) versus only what's legally
compelled — that's a drafting judgment call, not a fact search can settle.

## 3. Ride-hail dispatch licensing in T&T

**Partially confirmed, partially open.** Individual driver/vehicle
licensing is real, mandatory, and well-documented: a Taxi Driver's Badge
and Licence (21+, Class 3 permit held 1+ year, written exam, driving
test), and separately, converting a private ("P") plate vehicle to a hire
("H") plate requires a letter to the Transport Commissioner
[[Taxi Driver's Badge & Licence – ttconnect](https://ttconnect.gov.tt/taxi-drivers-badge-licence/)] [[H Taxi – ttconnect](https://ttconnect.gov.tt/h-taxi/)].
This directly confirms the gap CLAUDE.md already flags: G-Taxi does not
track H-plate status anywhere, and operating without it is a real legal
exposure per that existing note, not a hypothetical.

**Open:** I found no documented platform-level/dispatch-company license
distinct from the individual driver/vehicle requirements above — no
MVACC or Transport Commissioner framework specifically for ride-hailing
*apps* as intermediaries turned up in search, and other local apps
(Ridelink, TT RideShare) don't appear to publicize one either. Absence of
a search result is not confirmation that no such requirement exists.
**Flag for direct confirmation** with the Ministry of Works and
Transport / Transport Commissioner's office — do not read this as "no
license needed."

## 4. Money-services / e-money license for the wallet system (G Pay)

**Confirmed: a real, specific regulatory framework exists and is
active.** The Central Bank of Trinidad and Tobago's E-Money Issuer Order,
2020 (amended December 2023) creates a registration category — Payment
Service Provider (PSP) and/or E-Money Issuer (EMI), both under the
Central Bank Act — for anyone issuing electronic stored monetary value
usable for payments, including via mobile devices, with or without a
bank account attached. Applications go through the Central Bank's
GoAnywhere Portal; a company must be T&T-incorporated (or incorporate
before approval) and show audited financials, adequate capital, and
liquidity [[Fintech Licensing, Registration & Application Process in Trinidad & Tobago](https://www.central-bank.org.tt/fintech-and-payments/fintech-licensing-application-process-in-trinidad-tobago/)] [[Licensing of Fintech Companies in Trinidad and Tobago](https://www.central-bank.org.tt/licensing-fintech-companies-trinidad-and-tobago/)].

**This is the real regulatory question the wallet system needs answered,
and search cannot answer it — it's a characterization question:** does
G-Taxi's wallet (real balances tracked in `wallet_transactions`, funded
via Stripe/WiPay) constitute *the platform itself* issuing e-money, or
does routing every top-up/payout through a licensed processor
(Stripe/WiPay) as processor-of-record keep G-Taxi outside the EMI
definition because it never has independent custody of the float? Both
outcomes are plausible readings and this is exactly the kind of thing a
real T&T fintech/regulatory lawyer needs to sign off on before real money
moves through the wallet at scale — **flagged as a hard prerequisite, not
an engineering task.**

## 5. Vehicle financing (G-Garage) — Hire Purchase Act cap, re-confirmed

**Confirmed, consistent with the earlier session finding.** The Hire
Purchase Act (Chapter 82:33) applies only to agreements where the hire
purchase price does not exceed $15,000 — legislation aimed at protecting
buyers of modest means. Agreements above that threshold fall outside the
Act's consumer-protection scope entirely
[[Trinidad and Tobago | Lex Mundi](https://www.lexmundi.com/guides/latam-consumer-guide-2024/jurisdiction/caribbean/trinidad-and-tobago/)].

**What this means:** a real vehicle-financing deal (a BYD lease/purchase
structure) will almost certainly exceed $15,000 TTD, meaning it sits
**outside** Hire Purchase Act protections — which does not mean it's
unregulated, it means a *different* legal framework applies (general
contract law, possibly the Consumer Protection framework, and separately
whatever the Central Bank/FIU require if G-Taxi itself is extending
credit rather than a licensed lender). **Flag as a hard prerequisite,
already stated in the original directive and reconfirmed here:** no
vehicle-financing feature ships before a real T&T commercial/consumer
lawyer reviews the deal structure. This document does not attempt to
resolve that — it only re-confirms the fact that put the question on the
table in the first place.

## Summary table

| # | Question | Status | Needs a lawyer? |
|---|---|---|---|
| 1 | TTBizLink registration status | **Open — needs company name from you** | No — needs your input first |
| 2 | DPA 2011 proclamation | Confirmed: partially in force (Part I, ss.7-18,22,23,25(1),26,28) | Yes — for how the privacy policy should characterize unenforceable rights |
| 3 | Ride-hail dispatch license | Driver/vehicle licensing confirmed real; platform-level license **unconfirmed either way** | Yes — direct confirmation with Transport Commissioner needed |
| 4 | Money-services/e-money license for wallet | Real framework exists (EMI Order 2020/2023); applicability to G-Taxi's specific architecture unresolved | **Yes — hard prerequisite before wallet scales** |
| 5 | Hire Purchase Act cap re: G-Garage | Confirmed: $15,000 cap, G-Garage deals sit outside it | **Yes — hard prerequisite before any financing feature ships** (already stated) |
