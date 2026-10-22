# Product brief (draft v0) — working name: "Pulse"

**Status:** draft for discussion, 2026-10-22. Everything marked *(hypothesis)* is
untested. Builds on [`product-strategy-notes.md`](product-strategy-notes.md) and
[`hardcode-audit.md`](hardcode-audit.md).

## One line

A gentle, always-current financial advisor for independent restaurant owners:
connect QuickBooks and your POS in ten minutes, and get a daily answer to "how are
we doing, and is anything worth a look?" without hiring a consultant or learning
to read a P&L.

## Who it's for

**Buyer and daily user:** the owner-operator of an independent, full-service
restaurant doing roughly $1M-$5M a year, on QuickBooks Online and Toast
*(hypothesis: pick one POS first)*. They run the floor or the kitchen, check
numbers on their phone, and feel judged by their accountant. They would never
adopt a full inventory and vendor-bill suite.

**Secondary users:** a GM (daily ops view) and the bookkeeper or accountant
(month-end), who should see this as an ally that shortens their calls, not a
replacement.

**Not for:** chains, multi-concept groups, quick-service, anyone needing recipe
costing or bill pay.

## The problem

QuickBooks reports aren't built for operators, so owners find out about a bad
month a month late. Restaurant-specific tools (MarginEdge, Restaurant365) are
deep on food costing and invoices, heavy to set up, and priced for operations
teams. Horizontal BI tools (Syft, Fathom) aren't restaurant-aware. Consultants
and accountants fill the gap, but they're expensive and often make owners feel
dumb.

## What it does (wedge)

1. **Today:** last night vs. that weekday's goal, covers, spend per cover,
   fully-loaded nightly margin.
2. **This week / month:** revenue pace, prime cost against format-appropriate
   bands, labor and COGS percentages, budget pace that respects seasonality.
3. **A morning digest** (text or email) that only raises its hand when something
   is genuinely off, with a specific, plain-language "worth a look."
4. **Plan:** budget and labor modeling that stay tied to QuickBooks (export for
   re-import).

Everything above already exists in working form for Urban Hearth. The product is
the generalization, onboarding and delivery.

## Why we win

- **Daily operator question, not accounting or inventory.** Different buyer and
  price point than MarginEdge; complementary, not a clone.
- **Advisory voice.** Non-judgmental, hedged, invites a look rather than issues
  a verdict. Cheaper *and* kinder than the status quo.
- **Domain rules, hand-authored.** The owners' own diagnostic heuristics encoded
  as explicit rules (traceable, not model guesses), calibrated by restaurant
  format.
- **Ten-minute onboarding** as a competitive feature against multi-week setups.
- **Built and used by operators.** Credibility, and a live testbed.

## What's already proven vs. not

| Proven (running at Urban Hearth) | Unproven |
|---|---|
| QBO sync, account classification, P&L, budget pace, weekday targets, nightly margin, Toast covers and labor | Onboarding a stranger's chart of accounts without hand SQL |
| Colorblind-validated status design | Multi-tenant architecture, billing, real auth |
| Rules-shaped drill-downs (flag, collapse) | The advisory layer itself (the rule set doesn't exist yet) |
| | Any second restaurant, any second POS |

## Key risks

1. **Retention:** a dashboard is a habit, not infrastructure. Mitigation: push
   digest, multi-user roles, multi-location, forecasting.
2. **POS access:** Toast may require partner approval for third-party apps.
   *First thing to verify.*
3. **Onboarding quality:** most restaurants' charts of accounts are messier than
   ours, and many don't use account numbers.
4. **Wrong advice is worse than a wrong chart.** Start with explicit rules the
   owners can stand behind; keep language suggestive.
5. **Crowded space and a solo builder.** Incumbents can copy a dashboard.
   Differentiation is tone, speed to value, and judgment, not features.

## Business model *(all hypotheses)*

- Subscription per location, monthly, roughly $79-$199 depending on tier;
  14-day trial. Anchor against MarginEdge and a few hours of consulting a month.
- Tiers by capability, not seats: Essentials (dashboard, digest), Plus
  (budget and labor modeling, advisory rules), later Capital (debt service and
  covenant tracking for SBA borrowers).
- Accountant referral channel: free seat for the bookkeeper.

## Out of scope for v1

Recipe and inventory costing, vendor invoices and bill pay, scheduling, payroll
processing, POS other than the first chosen one, peer benchmarking (needs scale),
Urban-Hearth-specific modules (loans, buyouts) until a customer asks.

## Path

1. **Validate (now):** 2-3 friendly pilot restaurants; look at their charts of
   accounts; confirm Toast access path; talk to the bookkeeper side. Optional
   low-key conversation with MarginEdge contacts.
2. **Core extraction:** per the audit: account roles, shared settings module,
   POS adapter boundary. Urban Hearth stays on the existing app.
3. **Multi-tenant shell + onboarding wizard + digest** in a new repo; migrate
   Urban Hearth as tenant #1.
4. **Pilot, then price test.**

## Decisions needed from you

- Toast-first, or POS-agnostic from day one?
- Full-service dinner independents only, or also lunch/all-day formats?
- New repo from scratch vs. forking this one and deleting the UH-only parts?
- How much of your and your wife's time can go to writing the first advisory
  rules and the voice guide?
