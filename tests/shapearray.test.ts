import {AtomicSharedShapeArray} from '../src/datatypes/shapearray';


describe('AtomicSharedShapeArray', () => {
  test('withAny matches a hit in any mask word', () => {
    const shapes = Object.create(AtomicSharedShapeArray.prototype) as any;
    shapes.stride = 2;
    shapes.array = new Uint32Array([1, 0]);
    const trackingMask = {mask: [1, 2], lastMatches: [], changed: false};

    expect(shapes.matchAny(0, trackingMask)).toBe(true);
    expect(trackingMask.changed).toBe(true);
  });

  test('withAny clears prior match state when no mask word matches', () => {
    const shapes = Object.create(AtomicSharedShapeArray.prototype) as any;
    shapes.stride = 2;
    shapes.array = new Uint32Array([0, 0]);
    const lastMatches = [[1, 0]];
    const trackingMask = {mask: [1, 2], lastMatches, changed: false};

    expect(shapes.matchAny(0, trackingMask)).toBe(false);
    expect(lastMatches[0]).toBeUndefined();
  });
});
