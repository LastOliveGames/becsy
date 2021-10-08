import {Graph} from '../src/datatypes/graph';

describe('bitset operations', () => {

  let graph: Graph<string>;

  beforeEach(() => {
    graph = new Graph(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  test('add edges', () => {
    graph.addEdge('a', 'b', 1);
    graph.addEdge('c', 'd', 1);
    graph.addEdge('c', 'd', 2);
    graph.addEdge('e', 'f', 1);
    graph.addEdge('f', 'e', 2);
    graph.addEdge('g', 'h', 1);
    graph.addEdge('h', 'g', 1);
    expect(graph.hasEdge('a', 'b')).toBe(true);
    expect(graph.hasEdge('b', 'a')).toBe(false);
    expect(graph.hasEdge('c', 'd')).toBe(true);
    expect(graph.hasEdge('d', 'c')).toBe(false);
    expect(graph.hasEdge('e', 'f')).toBe(false);
    expect(graph.hasEdge('f', 'e')).toBe(true);
    expect(graph.hasEdge('g', 'h')).toBe(true);
    expect(graph.hasEdge('h', 'g')).toBe(true);
  });

  test('deny edges', () => {
    graph.denyEdge('a', 'b', 1);
    graph.addEdge('c', 'd', 1);
    graph.denyEdge('c', 'd', 2);
    graph.addEdge('e', 'f', 1);
    graph.denyEdge('f', 'e', 2);
    graph.addEdge('g', 'h', 1);
    graph.denyEdge('h', 'g', 1);
    expect(graph.hasEdge('a', 'b')).toBe(false);
    expect(graph.hasEdge('b', 'a')).toBe(false);
    expect(graph.hasEdge('c', 'd')).toBe(false);
    expect(graph.hasEdge('d', 'c')).toBe(false);
    expect(graph.hasEdge('e', 'f')).toBe(false);
    expect(graph.hasEdge('f', 'e')).toBe(false);
    expect(graph.hasEdge('g', 'h')).toBe(true);
    expect(graph.hasEdge('h', 'g')).toBe(false);
  });

  test('find simple cycle', () => {
    graph.addEdge('a', 'b', 1);
    graph.addEdge('b', 'a', 1);
    expect(graph.findCycles()).toEqual([['a', 'b']]);
  });

  test('find longer cycle', () => {
    graph.addEdge('a', 'b', 1);
    graph.addEdge('b', 'c', 1);
    graph.addEdge('c', 'd', 1);
    graph.addEdge('d', 'a', 1);
    graph.addEdge('c', 'e', 1);
    graph.addEdge('g', 'a', 1);
    expect(graph.findCycles()).toEqual([['a', 'b', 'c', 'd']]);
  });

  test('find multiple cycles', () => {
    graph.addEdge('a', 'b', 1);
    graph.addEdge('b', 'a', 1);
    graph.addEdge('b', 'c', 1);
    graph.addEdge('c', 'b', 1);
    graph.addEdge('c', 'd', 1);
    graph.addEdge('d', 'e', 1);
    graph.addEdge('e', 'c', 1);
    graph.addEdge('c', 'f', 1);
    graph.addEdge('f', 'g', 1);
    expect(graph.findCycles()).toEqual([['a', 'b'], ['b', 'c'], ['c', 'd', 'e']]);
  });

  test('topological sort', () => {
    graph.addEdge('h', 'f', 1);
    graph.addEdge('g', 'e', 1);
    graph.addEdge('h', 'e', 1);
    graph.addEdge('f', 'd', 1);
    graph.addEdge('d', 'c', 1);
    graph.addEdge('e', 'c', 1);
    graph.seal();
    expect(graph.topologicallySortedVertices).toEqual(['a', 'b', 'g', 'h', 'e', 'f', 'd', 'c']);
  });

  test('subgraph', () => {
    graph.addEdge('a', 'b', 1);
    graph.addEdge('b', 'c', 1);
    graph.addEdge('c', 'a', 1);
    const subgraph = graph.induceSubgraph(['a', 'b']);
    subgraph.seal();
    expect(subgraph.topologicallySortedVertices).toEqual(['a', 'b']);
  });

  test('ignore self loops', () => {
    graph.addEdge('a', 'a', 1);
    expect(graph.hasEdge('a', 'a')).toBe(false);
  });

  test('traverse', () => {
    graph.addEdge('a', 'b', 1);
    graph.addEdge('b', 'c', 1);
    graph.addEdge('b', 'd', 1);
    graph.addEdge('c', 'e', 1);
    graph.addEdge('d', 'e', 1);
    graph.addEdge('f', 'g', 1);
    graph.seal();
    expect(graph.traverse()).toEqual(['a', 'f', 'h']);
    expect(graph.traverse('f')).toEqual(['g']);
    expect(graph.traverse('g')).toEqual([]);
    expect(graph.traverse('a')).toEqual(['b']);
    expect(graph.traverse('b')).toEqual(['c', 'd']);
    expect(graph.traverse('c')).toEqual([]);
    expect(graph.traverse('d')).toEqual(['e']);
    expect(graph.traverse('e')).toEqual([]);
    expect(graph.traverse('h')).toBe(undefined);
  });

});

