import { isPositiveAmount, computeEvenAllocation, round6 } from './grantMath';

describe('grantMath', () => {
  describe('isPositiveAmount', () => {
    it('accepts a positive finite number', () => {
      expect(isPositiveAmount(1)).toBe(true);
      expect(isPositiveAmount(0.5)).toBe(true);
    });

    it('rejects zero, negative, non-finite, and non-number values', () => {
      expect(isPositiveAmount(0)).toBe(false);
      expect(isPositiveAmount(-1)).toBe(false);
      expect(isPositiveAmount(Infinity)).toBe(false);
      expect(isPositiveAmount(NaN)).toBe(false);
      expect(isPositiveAmount('5')).toBe(false);
      expect(isPositiveAmount(null)).toBe(false);
      expect(isPositiveAmount(undefined)).toBe(false);
    });

    it('rejects a value above MAX_SAFE_INTEGER', () => {
      expect(isPositiveAmount(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
    });
  });

  describe('computeEvenAllocation', () => {
    it('evenly splits a total that divides cleanly', () => {
      expect(computeEvenAllocation(100, 4)).toBe(25);
    });

    it('rounds to 6 decimal places, with no remainder assigned to anyone', () => {
      const perParticipant = computeEvenAllocation(100, 3);
      expect(perParticipant).toBe(33.333333);
      // By design: perParticipant * 3 !== 100 exactly — this is the approved policy.
      expect(perParticipant * 3).not.toBe(100);
    });
  });

  describe('round6', () => {
    it('rounds to 6 decimal places', () => {
      expect(round6(1.23456789)).toBe(1.234568);
    });

    it('leaves an already-short value untouched', () => {
      expect(round6(5)).toBe(5);
    });
  });
});
