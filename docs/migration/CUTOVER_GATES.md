# Cutover gates

The legacy online system is never modified by this repository during development.

Before cutover, a rehearsal must prove per company and per month:

- company, user, membership, role, and permission mappings;
- active and cancelled documents and their original serials;
- gross, net, VAT, ledger debit/credit, period movement, and as-of balances;
- attachments by SHA-256 hash;
- business-date ambiguity report with zero unreviewed rows.

The final cutover requires a short legacy write freeze, final snapshot, repeatable import, full reconciliation, and owner approval. After Baseer accepts writes, Noorix remains read-only and archived.
