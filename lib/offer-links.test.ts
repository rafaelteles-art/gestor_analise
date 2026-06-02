import { describe, it, expect } from 'vitest';
import { orphanOfferNames } from './offer-links';

describe('orphanOfferNames', () => {
  it('returns names present in account arrays but absent from offers', () => {
    const accountNames = ['Lotto', 'Atenas', 'Lotto', 'DeletedOffer'];
    const existingOffers = ['Lotto', 'Atenas'];
    expect(orphanOfferNames(accountNames, existingOffers)).toEqual(['DeletedOffer']);
  });

  it('is case-sensitive and de-duplicates', () => {
    expect(orphanOfferNames(['A', 'A', 'b'], ['a'])).toEqual(['A', 'b']);
  });

  it('returns empty when all names match', () => {
    expect(orphanOfferNames(['X'], ['X', 'Y'])).toEqual([]);
  });
});
