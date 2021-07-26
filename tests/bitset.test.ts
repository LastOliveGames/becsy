import {Bitset} from '../src/datatypes/bitset';

describe('bitset operations', () => {

  test('set in base cell', () => {
    const bitset = new Bitset(32);
    bitset.set(1);
    expect(bitset.get(1)).toBe(true);
    expect(bitset.get(2)).toBe(false);
  });

  test('unset in base cell', () => {
    const bitset = new Bitset(32);
    bitset.set(1);
    bitset.unset(1);
    expect(bitset.get(1)).toBe(false);
    expect(bitset.get(2)).toBe(false);
  });

  test('set in high cell', () => {
    const bitset = new Bitset(64);
    bitset.set(33);
    expect(bitset.get(33)).toBe(true);
    expect(bitset.get(1)).toBe(false);
    expect(bitset.get(36)).toBe(false);
  });

  test('clear', () => {
    const bitset = new Bitset(50);
    bitset.set(1);
    bitset.set(33);
    bitset.clear();
    expect(bitset.get(1)).toBe(false);
    expect(bitset.get(2)).toBe(false);
    expect(bitset.get(33)).toBe(false);
    expect(bitset.get(49)).toBe(false);
  });

});

