export class Pool<T> {
  private readonly list: T[];
  private readonly locks = new Map<T, number>();
  private next = 0;

  constructor(readonly Class: {new() : T}, initialSize = 20) {
    this.list = new Array(initialSize);
    for (let i = 0; i < initialSize; i++) {
      const item = this.list[i] = new Class();
      this.locks.set(item, 0);
    }
  }

  logStats(): void {
    let count = 0;
    for (const item of this.list) if (!this.locks.get(item)) count++;
    console.log(`Pool ${this.Class.name}: ${count} of ${this.list.length} available`);
  }

  borrow(): T {
    let next = this.next;
    const initial = next;
    const length = this.list.length;
    let item;
    while (this.locks.get(item = this.list[next])) {
      next += 1;
      if (next === length) next = 0;
      if (next === initial) break;
    }

    const count = this.locks.get(item)!;
    if (count) {
      item = new this.Class();
      this.list.push(item);
      this.locks.set(item, 1);
      next = 0;
    } else {
      this.locks.set(item, count + 1);
    }
    this.next = next;
    return item;
  }

  relinquish(item: T): void {
    const count = this.locks.get(item);
    if (count === undefined) {
      throw new Error(`Released item not in pool ${this.Class.name}: ${item}`);
    }
    if (count <= 0) {
      throw new Error(`Item released too many times from pool ${this.Class.name}: ${item}`);
    }
    this.locks.set(item, count - 1);
  }
}
