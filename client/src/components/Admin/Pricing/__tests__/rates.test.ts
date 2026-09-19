import { parseRate } from '../rates';

describe('parseRate', () => {
  it.each([
    ['0', 0],
    ['2.5', 2.5],
    ['.5', 0.5],
    ['10.', 10],
    [' 3 ', 3],
  ])('accepts %p', (input, expected) => {
    expect(parseRate(input)).toBe(expected);
  });

  it.each(['', '  ', '-1', '1e5', 'abc', '1.2.3', '1,5', 'NaN', 'Infinity'])(
    'rejects %p',
    (input) => {
      expect(parseRate(input)).toBeNull();
    },
  );
});
