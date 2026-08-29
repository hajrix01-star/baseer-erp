/** Run after API build: `node apps/api/dist/nurix-migration/nurix-counterparty-alias-resolution.policy-verification.js`. */
import { assertNurixCounterpartyAliasSeedIsSafe, NURIX_COUNTERPARTY_ALIAS_SEED, resolveNurixCounterpartyAlias } from './nurix-counterparty-alias-resolution.js';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

function main() {
  assertNurixCounterpartyAliasSeedIsSafe();
  const electricity = resolveNurixCounterpartyAlias('  الشركةُ السعوديةُ للكهرباء  ', NURIX_COUNTERPARTY_ALIAS_SEED);
  assert(electricity.status === 'MATCHED' && electricity.canonicalKey === 'SAUDI_ELECTRICITY', 'expected explicit Arabic electricity match');
  const oldTaxName = resolveNurixCounterpartyAlias('هيئة الزكاة والدخل', NURIX_COUNTERPARTY_ALIAS_SEED);
  assert(oldTaxName.status === 'MATCHED' && oldTaxName.canonicalKey === 'GOV_ZATCA' && oldTaxName.aliasKind === 'FORMER_NAME', 'expected former ZATCA name match');
  const unapprovedVariant = resolveNurixCounterpartyAlias('كهرباء السعودية', NURIX_COUNTERPARTY_ALIAS_SEED);
  assert(unapprovedVariant.status === 'REVIEW_REQUIRED' && unapprovedVariant.reason === 'NO_EXPLICIT_ALIAS', 'must not fuzzy-match an unapproved spelling');
}

let ambiguousSeedRejected = false;
try {
  assertNurixCounterpartyAliasSeedIsSafe([
    { ...NURIX_COUNTERPARTY_ALIAS_SEED[0]!, canonicalKey: 'ONE', alias: 'same' },
    { ...NURIX_COUNTERPARTY_ALIAS_SEED[0]!, canonicalKey: 'TWO', alias: 'same' },
  ]);
} catch (error) {
  if (!(error instanceof Error) || error.message !== 'AMBIGUOUS_COUNTERPARTY_ALIAS_SEED') throw error;
  ambiguousSeedRejected = true;
}
assert(ambiguousSeedRejected, 'expected ambiguous seed to be rejected');
main();
console.log('Nurix counterparty alias policy verification passed: explicit aliases only, safe normalisation, former-name lineage, and no fuzzy merging.');
