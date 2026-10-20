# M04 / M08 integration — PR #137

PR #137 merges the original M04 completion history into current main. PR #146 already incorporated its implementation and adapted it to the approved M03 onboarding and closure flow.

The conflict resolution preserves:

- The real `HttpWalletSource`, wallet summary, top-up, withdrawal and cursor-based transaction history in 11Ship.
- M08 notification inbox, settings and notification routing to wallet, delivery and profile screens, together with M11 feedback entries.
- M03 registration without bank/review, confirmed initial funding and sufficient available commission balance before accepting orders.
- Closure refunds only after active deliveries and financial obligations are settled, using verified bank details and the existing hold/debit-once rules.
- Admin finance permissions, routes and shell alongside notifications, orders and feedback.

The withdrawal migration is `1795132800000_create-wallet-withdrawals.sql`; the obsolete `1794182400000_create-wallet-withdrawals.sql` must not coexist with it or with the M08 migration at that timestamp.

The resolved merge commit `8e7d748b8fd76f31306ce7faf215644fed6250f5` has the same source tree as main `bac3c01a76ffc389c6503bc4a6d66e945221cc97`. This note is the only subsequent file change. Full CI and both Android APK builds are required on the resulting PR head before merge. This integration does not authorize VPS deployment, production migrations or enabling Firebase.
