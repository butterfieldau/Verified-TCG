---
name: Portfolio history semantics
description: Home charts actual ownership value from account creation, separately from profit and loss.
---

Verified TCG Home uses an ownership-value timeline: zero at account creation, active and archived quantities only during their actual ownership intervals, and real retained provider observations. Cards do not appear before acquisition; sold quantities disappear on sale and restored quantities begin a new interval. Profit and loss remains a separate calculation.

**Why:** The collector explicitly chose an account-to-present ownership timeline over a current-holdings market backcast. Showing pre-acquisition value or treating acquisition jumps as gains would misrepresent the account’s history.

**How to apply:** Use account creation and acquisition/sale/restore boundaries as timeline events. Omit non-zero dates lacking complete real prices or FX; never interpolate. Keep acquisition cost, realised gain, and unrealised gain separate from value-chart movement.