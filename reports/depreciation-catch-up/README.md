# Catch-up depreciation, 2263 Mass Ave assets (revised 2026-10-19)

**Have the accountant review this.** It is a reconstruction, not a tax filing. This version replaces the first import: delete the first journal entry (DEP-CATCHUP-12-31-2025) in QuickBooks before importing the new CSV.

## Step 1: rewrite the 2016 purchase entry (LIMPASTO_5-22-16, 05/22/2016)

No Form 8594 exists, so the split follows the Bill of Sale ($83,000 for personal property). The $2,000 left over is for the lease, license and goodwill. The furniture figure keeps your earlier estimate; the extra $38,000 moves from the leasehold interest to equipment.

| Account | Was | Now (debit) |
|---|---|---|
| 1405 Intangible & Acquisition Assets:Leasehold Interest - 2263 Mass Ave | $40,000 | **$2,000** |
| 1330 Kitchen Equipment (Fixed Assets) | $35,000 | **$73,000** |
| 1320 Furniture & Fixtures | $10,000 | $10,000 |
| 1205 Asset Acquisition Clearing (credit) | $85,000 | $85,000 |

## Step 2: create 3 accounts in QuickBooks (no amortization account needed any more)

| Suggested # | Name (parent:child) | Type / detail type |
|---|---|---|
| 1325 | Furniture, Fixtures & Equipment (FFE):Accumulated Depreciation - Furniture & Fixtures (2263 Mass Ave) | Fixed Assets / Accumulated Depreciation |
| 1335 | Furniture, Fixtures & Equipment (FFE):Accumulated Depreciation - Kitchen Equipment (2263 Mass Ave) | Fixed Assets / Accumulated Depreciation |
| 1365 | Leasehold Improvements:Accumulated Depreciation - Mass Ave Leasehold Improvements | Fixed Assets / Accumulated Depreciation |

If you already created 1406 (accumulated amortization) it can stay unused or be deleted.

## Step 3: import `saasant-depreciation-catch-up-je.csv`

Format matches what worked last time: dates as MM/DD/YY, columns named "Debit Amount" and "Credit Amount".

One journal entry dated 12/31/25: debit **Retained Earnings** $203,211.03; credit the three accounts above ($188,867.61) and credit 1330 Kitchen Equipment twice: $4,574.06 to retire the old dishwasher and $9,769.36 to write off 2016 inventory (the accountant agreed on 2026-10-19). It is a prior-period adjustment, so **it does not touch the 2026 P&L**. If QuickBooks rejects Retained Earnings, use "Opening balance equity".

| Account | Cost | Accumulated | Left on books |
|---|---|---|---|
| 1320 Furniture & Fixtures | $32,394.05 | $32,394.05 | $0 |
| 1330 Kitchen Equipment (old location, excl. retired dishwasher and inventory) | $102,093.34 | $92,143.56 | $9,949.78 |
| 1361 Mass Ave Leasehold Improvements | $64,330.00 | $64,330.00 | $0 |
| 1405 Leasehold Interest - 2263 Mass Ave | $2,000.00 | $0 | $2,000.00 |
| **Total** | **$200,817.39** | **$188,867.61** | **$11,949.78** |

$11,949.78 is left on the books, so the gain on the $100,000 sale is about **$88,050**. If you already imported the version without the inventory write-off, import `saasant-inventory-writeoff-only.csv` instead of redoing everything.

## How the numbers were built (`depreciation-catch-up-schedule.csv`)

- **2016–2021:** $171,386 from the tax returns, as filed. The returns don't say which assets, so furniture and leasehold improvements through 2021 are treated as fully depreciated and the rest goes to kitchen equipment.
- **2022–2025 (reconstructed, $17,481.61 in total):** every purchase after 2021 in the kitchen equipment and leasehold registers. Items of $2,500 or more use 7-year 200% declining-balance, half-year (what the 2024 return used). Items under $2,500 are expensed in the year bought. 2024 uses the $1,935 the 2024 return claimed on the four large items, and 2025 uses the **$3,317 the 2025 return claimed** on the same four.
- **Retired dishwasher:** the high-temp dishwasher ($4,574.06, in service 1/1/2024) was replaced 8/9/2025 but never retired on the 2025 return. It is written off in this entry, not sold. The $1,773.66 already claimed on it is not booked; the remaining $2,800.40 is the loss.
- **Not included:** 2026 depreciation on the old assets through the sale date. It lowers book value and raises the gain by the same amount, so it doesn't change EBITDA.

## The $9,769.36 inventory write-off (agreed with the accountant)

Cost through 2021 on the new split is $181,155.36 and the returns claimed $171,386, so $9,769.36 was never depreciated and nothing on the 2024 depreciation report carries it forward. The 2016 agreement says the price included food and liquor inventory, so it is treated as inventory bought in 2016 (not depreciable). It is written off against Retained Earnings and is not part of what is being sold.

## At the sale

Debit cash, debit each accumulated depreciation account above, credit each asset account at cost, credit 8010 Gain on Asset Sale for the difference. About $60K of the $100K is for the lease, liquor license and goodwill and about $39K is equipment (resale value per Erin's asset list); how the price is allocated between them matters for taxes.
