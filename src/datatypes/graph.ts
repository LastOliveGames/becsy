import {CheckError, InternalError} from '../errors';

interface Printable {
  toString(): string;
}


/**
 * A directed graph with weighted edges and a few extra constraints:
 * 1. Loop edges on a single vertex are not allowed, nor are multiple edges from A to B.
 * 2. An edge from A to B with a higher weight will override an edge from B to A.
 * 3. A "denial" edge from A to B will similarly override lower-weight edges, but not count as an
 *    edge itself.  We store these with negative weights.
 */
export class Graph<V extends Printable> {
  private readonly numVertices: number;
  private readonly edges: number[];
  private paths: number[];
  private readonly vertexIndexMap = new Map<V, number>();
  private sealed = false;
  private sortedVertices: V[];
  private readonly dependencyCounts: number[];
  private readonly traversalCounts: number[];
  private numTraversedVertices: number;

  constructor(private readonly vertices: V[]) {
    this.numVertices = vertices.length;
    for (let i = 0; i < vertices.length; i++) {
      this.vertexIndexMap.set(vertices[i], i);
    }
    this.edges = new Array(this.numVertices ** 2).fill(0);
    this.dependencyCounts = new Array(this.numVertices);
    this.traversalCounts = new Array(this.numVertices);
  }

  get topologicallySortedVertices(): V[] {
    DEBUG: if (!this.sealed) throw new InternalError('Graph not yet sealed');
    if (!this.sortedVertices) this.sortedVertices = this.sortTopologically();
    return this.sortedVertices;
  }

  private getEdgeIndex(source: V, target: V): number {
    const sourceId = this.vertexIndexMap.get(source);
    const targetId = this.vertexIndexMap.get(target);
    DEBUG: if (sourceId === undefined) throw new InternalError(`Unknown vertex: ${source}`);
    DEBUG: if (targetId === undefined) throw new InternalError(`Unknown vertex: ${target}`);
    return sourceId * this.numVertices + targetId;
  }

  private setEdge(source: V, target: V, weight: number): void {
    DEBUG: if (this.sealed) throw new InternalError('Graph already sealed');
    if (source === target) return;
    const sourceToTarget = this.getEdgeIndex(source, target);
    const targetToSource = this.getEdgeIndex(target, source);
    const absWeight = Math.abs(weight);
    if (absWeight < Math.abs(this.edges[sourceToTarget]) ||
        absWeight < Math.abs(this.edges[targetToSource])) return;
    this.edges[sourceToTarget] = weight;
    if (absWeight > Math.abs(this.edges[targetToSource])) this.edges[targetToSource] = 0;
  }

  addEdge(source: V, target: V, weight: number): void {
    DEBUG: if (weight <= 0) throw new InternalError(`Edge has non-positive weight: ${weight}`);
    this.setEdge(source, target, weight);
  }

  denyEdge(source: V, target: V, weight: number): void {
    DEBUG: if (weight <= 0) throw new InternalError(`Edge has non-positive weight: ${weight}`);
    this.setEdge(source, target, -weight);
  }

  hasEdge(source: V, target: V): boolean {
    return this.edges[this.getEdgeIndex(source, target)] > 0;
  }

  hasPath(source: V, target: V): boolean {
    DEBUG: if (!this.sealed) throw new InternalError('Graph not yet sealed');
    return this.paths[this.getEdgeIndex(source, target)] > 0;
  }

  private hasEdgeBetweenIds(sourceId: number, targetId: number): boolean {
    DEBUG: if (sourceId > this.numVertices) {
      throw new InternalError(`Vertex id out of range: ${sourceId} > ${this.numVertices}`);
    }
    DEBUG: if (targetId > this.numVertices) {
      throw new InternalError(`Vertex id out of range: ${targetId} > ${this.numVertices}`);
    }
    return this.edges[sourceId * this.numVertices + targetId] > 0;
  }

  seal(): void {
    DEBUG: if (this.sealed) throw new InternalError('Graph already sealed');
    this.sealed = true;
    this.derivePaths();
    CHECK: this.checkForCycles();
    this.simplify();
    this.countDependencies();
  }

  private checkForCycles(): void {
    const cycles = this.findCycles();
    if (cycles.length) {
      cycles.sort((x, y) => x.length - y.length);
      throw new CheckError(
        'Precedence cycles detected for the following systems, ' +
        'please resolve by adjusting their schedules: ' +
        cycles.map(cycle => cycle.map(u => u.toString()).join('—')).join(', ')
      );
    }
  }

  findCycles(): V[][] {
    // This implements Johnson's cycle finding algorithm from
    // https://www.cs.tufts.edu/comp/150GA/homeworks/hw1/Johnson%2075.PDF
    const blocked = new Array<boolean>(this.numVertices).fill(false), b: Set<number>[] = [];
    const stack: number[] = [], cycles: V[][] = [];
    let s: number, vertices: Set<number>;
    for (let i = 0; i < this.numVertices; i++) b[i] = new Set();

    const unblock = (u: number) => {
      blocked[u] = false;
      for (const w of b[u]) {
        b[u].delete(w);
        if (blocked[w]) unblock(w);
      }
    };

    const circuit = (v: number) => {
      let f = false;
      stack.push(v);
      blocked[v] = true;
      for (let w = 0; w < this.numVertices; w++) {
        if (!vertices.has(w) || !this.hasEdgeBetweenIds(v, w)) continue;
        if (w === s) {
          cycles.push(stack.map(u => this.vertices[u]));
          f = true;
        } else if (!blocked[w] && circuit(w)) {
          f = true;
        }
      }
      if (f) {
        unblock(v);
      } else {
        for (let w = 0; w < this.numVertices; w++) {
          if (!vertices.has(w) || !this.hasEdgeBetweenIds(v, w)) continue;
          b[w].add(v);
        }
      }
      stack.pop();
      return f;
    };

    for (s = 0; s < this.numVertices; s++) {
      const componentVertices = this.findLeastStronglyConnectedComponent(s);
      s = componentVertices[0];
      for (const v of componentVertices) {
        blocked[v] = false;
        b[v].clear();
      }
      vertices = new Set(componentVertices);
      circuit(s);
    }

    return cycles;
  }

  private findLeastStronglyConnectedComponent(minId: number): number[] {
    // Implements the path-based strong component algorithm on the subgraph consisting of vertices
    // minId through numVertices - 1.
    // https://en.wikipedia.org/wiki/Path-based_strong_component_algorithm
    let leastComponent: number[] | undefined;
    const preorder: number[] = [], s: number[] = [], p: number[] = [];
    const assigned: boolean[] = [];
    let counter = 0;

    const search = (v: number) => {
      preorder[v] = ++counter;
      s.push(v);
      p.push(v);
      for (let w = minId; w < this.numVertices; w++) {
        if (!this.hasEdgeBetweenIds(v, w)) continue;
        if (preorder[w]) {
          if (!assigned[w]) {
            while (p.length && preorder[p[p.length - 1]] > preorder[w]) p.pop();
          }
        } else {
          search(w);
        }
      }
      if (p[p.length - 1] === v) {
        const component = [];
        while (true) {
          const w = s.pop()!;
          component.push(w);
          assigned[w] = true;
          if (w === v) break;
        }
        p.pop();
        component.sort((a, b) => a - b);
        if (!leastComponent || component[0] < leastComponent[0]) leastComponent = component;
      }
    };

    for (let i = minId; i < this.numVertices; i++) {
      if (!preorder[i]) search(i);
    }
    return leastComponent!;
  }

  induceSubgraph(subvertices: V[]): Graph<V> {
    const subgraph = new Graph<V>(subvertices);
    for (const vertex of subvertices) {
      DEBUG: if (!this.vertexIndexMap.has(vertex)) {
        throw new InternalError(`Vertex not in graph: ${vertex}`);
      }
      for (const target of subvertices) {
        const edgeIndex = this.getEdgeIndex(vertex, target);
        const weight = this.edges[edgeIndex];
        if (weight > 0) {
          subgraph.addEdge(vertex, target, weight);
        } else if (weight < 0) {
          subgraph.denyEdge(vertex, target, -weight);
        }
      }
    }
    if (this.sealed) subgraph.seal();
    return subgraph;
  }

  private sortTopologically(): V[] {
    const edgeCounts = new Array(this.numVertices).fill(0);
    for (let i = 0; i < this.numVertices; i++) {
      for (let j = 0; j < this.numVertices; j++) {
        if (this.hasEdgeBetweenIds(i, j)) edgeCounts[j] += 1;
      }
    }
    const vertices: V[] = [];
    let changed;
    while (vertices.length < this.numVertices) {
      changed = false;
      for (let i = 0; i < edgeCounts.length; i++) {
        if (edgeCounts[i] === 0) {
          changed = true;
          edgeCounts[i] = -1;
          vertices.push(this.vertices[i]);
          for (let j = 0; j < this.numVertices; j++) {
            if (this.hasEdgeBetweenIds(i, j)) edgeCounts[j] -= 1;
          }
        }
      }
      DEBUG: if (!changed) {
        throw new InternalError('Graph has a cycle, topological sort not possible');
      }
    }
    return vertices;
  }

  derivePaths(): void {
    const n = this.numVertices;

    // Remove denial edges, no longer needed
    for (let i = 0; i < this.edges.length; i++) {
      if (this.edges[i] < 0) this.edges[i] = 0;
    }
    // console.log(this.printMatrix(this.edges));

    // Derive path matrix using a variant of the Floyd-Warshall algorithm
    const paths = this.edges.slice();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        for (let k = 0; k < n; k++) {
          if (k === i || k === j) continue;
          const weight1 = paths[i * n + k];
          const weight2 = paths[k * n + j];
          if (weight1 && weight2) {
            const weight = Math.min(weight1, weight2);
            if (paths[i * n + j] < weight && paths[j * n + i] < weight) {
              paths[i * n + j] = weight;
              paths[j * n + i] = 0;
            }
          }
        }
      }
    }
    this.paths = paths;
    // console.log(this.printMatrix(paths));

    // Overwrite edge weights with stronger paths.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (this.edges[i * n + j]) this.edges[i * n + j] = paths[i * n + j];
      }
    }
  }

  private simplify(): void {
    const n = this.numVertices;
    const paths = this.paths;

    // Perform a transitive reduction
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!this.edges[i * n + j]) continue;
        for (let k = 0; k < n; k++) {
          if (k === i || k === j) continue;
          if (paths[i * n + k] && paths[k * n + j]) this.edges[i * n + j] = 0;
        }
      }
    }
    // console.log(this.printMatrix(this.edges));
  }

  private countDependencies(): void {
    for (let i = 0; i < this.numVertices; i++) {
      let count = 0;
      for (let j = 0; j < this.numVertices; j++) {
        if (this.edges[j * this.numVertices + i]) count += 1;
      }
      this.dependencyCounts[i] = count;
    }
  }

  /**
   * Traverses vertices of the graph based on dependency order.  When called without an argument it
   * initializes (or re-initializes) the traversal and returns vertices with no dependencies.  When
   * called with an argument, it marks that vertex as done and returns the vertices whose
   * dependencies are all satisfied (if any).
   * @param completedVertex The vertex to mark done; if missing, initializes the traversal instead.
   * @returns The list of vertices whose dependencies have all been satisfied, or `undefined` if
   *    this was the last vertex and the traversal is done.
   */
  traverse(completedVertex?: V): V[] | void {
    DEBUG: if (!this.sealed) throw new InternalError('Graph not yet sealed');
    const traversedVertices = [];
    if (completedVertex) {
      this.numTraversedVertices += 1;
      const sourceId = this.vertexIndexMap.get(completedVertex);
      DEBUG: if (sourceId === undefined) {
        throw new InternalError(`Unknown vertex: ${completedVertex}`);
      }
      for (let i = 0; i < this.numVertices; i++) {
        if (this.edges[sourceId * this.numVertices + i]) {
          if (--this.traversalCounts[i] === 0) {
            traversedVertices.push(this.vertices[i]);
          }
        }
      }
    } else {
      this.numTraversedVertices = 0;
      for (let i = 0; i < this.numVertices; i++) {
        const count = this.traversalCounts[i] = this.dependencyCounts[i];
        if (count === 0) {
          traversedVertices.push(this.vertices[i]);
        }
      }
    }
    if (this.numTraversedVertices === this.numVertices) return;
    return traversedVertices;
  }

  private printMatrix(matrix: number[]): string {
    const n = this.numVertices;
    const lines = [];
    for (let i = 0; i < n; i++) {
      const line = [];
      for (let j = 0; j < n; j++) line.push(matrix[i * n + j]);
      lines.push(line.join(' '));
    }
    return lines.join('\n');
  }

}
