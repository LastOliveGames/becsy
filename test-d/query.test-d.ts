import {expectType} from 'tsd';
import {System} from '../src/system';

test('query has not flavours by default', () => {
  class A {
    a = 0;
  }

  interface ExpectedShape {
    current: undefined;
    added: undefined;
    removed: undefined;
    changed: undefined;
    addedOrChanged: undefined;
    changedOrRemoved: undefined;
    addedChangedOrRemoved: undefined;
  }

  class UnusedTestSystem extends System {
    private q = this.query(b => b.with(A));
    execute() {
      expectType<ExpectedShape>(this.q);
    }
  }
});

test('query has flavour added by .with', () => {
  class A {
    a = 0;
  }

  interface ExpectedShape {
    current: readonly Entity[];
  }

  class UnusedTestSystem extends System {
    private q = this.query(b => b.with(A));
    execute() {
      expectType<ExpectedShape>(this.q);
    }
  }
});

test('query has narrow flavour type added by .with', () => {
  class A {
    a = 0;
  }

  interface ExpectedShape {
    current: readonly A[];
  }

  class UnusedTestSystem extends System {
    private q = this.query(b => b.with(A));
    execute() {
      expectType<ExpectedShape>(this.q);
    }
  }
});

test('query has narrow flavour types added by multiple .with', () => {
  class A {
    a = 0;
  }

  class B {
    b = 0;
  }

  interface ExpectedShape {
    current: readonly A[] | readonly B[];
  }

  class UnusedTestSystem extends System {
    private q = this.query(b => b.with(A).with(B));
    execute() {
      expectType<ExpectedShape>(this.q);
    }
  }
});

test('query has narrow flavour types added by single .with', () => {
  class A {
    a = 0;
  }

  class B {
    b = 0;
  }

  interface ExpectedShape {
    current: readonly A[] | readonly B[];
  }

  class UnusedTestSystem extends System {
    private q = this.query(b => b.with(A, B));
    execute() {
      expectType<ExpectedShape>(this.q);
    }
  }
});
