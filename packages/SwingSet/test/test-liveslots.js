import '@agoric/install-ses';
import test from 'ava';
import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { assert, details as X } from '@agoric/assert';
import { WeakRef, FinalizationRegistry } from '../src/weakref';
import { waitUntilQuiescent } from '../src/waitUntilQuiescent';
import { makeLiveSlots } from '../src/kernel/liveSlots';

function capdata(body, slots = []) {
  return harden({ body, slots });
}

function capargs(args, slots = []) {
  return capdata(JSON.stringify(args), slots);
}

function oneResolution(promiseID, rejected, data) {
  return [[promiseID, rejected, data]];
}

function buildSyscall() {
  const log = [];

  const syscall = {
    send(targetSlot, method, args, resultSlot) {
      log.push({ type: 'send', targetSlot, method, args, resultSlot });
    },
    subscribe(target) {
      log.push({ type: 'subscribe', target });
    },
    resolve(resolutions) {
      log.push({ type: 'resolve', resolutions });
    },
  };

  return { log, syscall };
}

function makeDispatch(syscall, build) {
  const gcTools = harden({ WeakRef, FinalizationRegistry });
  const { setBuildRootObject, dispatch } = makeLiveSlots(
    syscall,
    'vatA',
    {},
    {},
    undefined,
    gcTools,
  );
  setBuildRootObject(build);
  return dispatch;
}

test('calls', async t => {
  const { log, syscall } = buildSyscall();

  function build(_vatPowers) {
    return Far('root', {
      one() {
        log.push('one');
      },
      two(p) {
        log.push(`two ${E.resolve(p) === p}`);
        p.then(
          res => log.push(['res', res]),
          rej => log.push(['rej', rej]),
        );
      },
    });
  }
  const dispatch = makeDispatch(syscall, build);
  t.deepEqual(log, []);
  const rootA = 'o+0';

  // root!one() // sendOnly
  dispatch.deliver(rootA, 'one', capargs(['args']), undefined);
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), 'one');

  // pr = makePromise()
  // root!two(pr.promise)
  // pr.resolve('result')
  dispatch.deliver(
    rootA,
    'two',
    capargs([{ '@qclass': 'slot', index: 0 }], ['p-1']),
    undefined,
  );
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), { type: 'subscribe', target: 'p-1' });
  t.deepEqual(log.shift(), 'two true');

  dispatch.notify(oneResolution('p-1', false, capargs('result')));
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), ['res', 'result']);

  // pr = makePromise()
  // root!two(pr.promise)
  // pr.reject('rejection')

  dispatch.deliver(
    rootA,
    'two',
    capargs([{ '@qclass': 'slot', index: 0 }], ['p-2']),
    undefined,
  );
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), { type: 'subscribe', target: 'p-2' });
  t.deepEqual(log.shift(), 'two true');

  dispatch.notify(oneResolution('p-2', true, capargs('rejection')));
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), ['rej', 'rejection']);

  // TODO: more calls, more slot types
});

test('liveslots pipelines to syscall.send', async t => {
  const { log, syscall } = buildSyscall();

  function build(_vatPowers) {
    return Far('root', {
      one(x) {
        const p1 = E(x).pipe1();
        const p2 = E(p1).pipe2();
        E(p2).pipe3();
        log.push('sent p1p2p3');
      },
    });
  }
  const dispatch = makeDispatch(syscall, build);
  t.deepEqual(log, []);
  const rootA = 'o+0';
  const x = 'o-5';
  const p1 = 'p+5';
  const p2 = 'p+6';
  const p3 = 'p+7';

  // root!one(x) // sendOnly
  dispatch.deliver(
    rootA,
    'one',
    capargs([{ '@qclass': 'slot', index: 0 }], [x]),
    undefined,
  );
  await waitUntilQuiescent();

  // calling one() should cause three syscall.send() calls to be made: one
  // for x!pipe1(), a second pipelined to the result promise of it, and a
  // third pipelined to the result of the second.

  t.deepEqual(log.shift(), 'sent p1p2p3');
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: x,
    method: 'pipe1',
    args: capargs([], []),
    resultSlot: p1,
  });
  t.deepEqual(log.shift(), { type: 'subscribe', target: p1 });
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: p1,
    method: 'pipe2',
    args: capargs([], []),
    resultSlot: p2,
  });
  t.deepEqual(log.shift(), { type: 'subscribe', target: p2 });
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: p2,
    method: 'pipe3',
    args: capargs([], []),
    resultSlot: p3,
  });
  t.deepEqual(log.shift(), { type: 'subscribe', target: p3 });
});

test('liveslots pipeline/non-pipeline calls', async t => {
  const { log, syscall } = buildSyscall();

  function build(_vatPowers) {
    let p1;
    return Far('onetwo', {
      one(p) {
        p1 = p;
        E(p1).pipe1();
        p1.then(o2 => E(o2).nonpipe2());
      },
      two() {
        E(p1).nonpipe3();
      },
    });
  }
  const dispatch = makeDispatch(syscall, build);

  t.deepEqual(log, []);

  const rootA = 'o+0';
  const p1 = 'p-1';
  const o2 = 'o-2';
  const slot0arg = { '@qclass': 'slot', index: 0 };

  // function deliver(target, method, argsdata, result) {
  dispatch.deliver(rootA, 'one', capargs([slot0arg], [p1]));
  await waitUntilQuiescent();
  // the vat should subscribe to the inbound p1 during deserialization
  t.deepEqual(log.shift(), { type: 'subscribe', target: p1 });
  // then it pipeline-sends `pipe1` to p1, with a new result promise
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: p1,
    method: 'pipe1',
    args: capargs([], []),
    resultSlot: 'p+5',
  });
  // then it subscribes to the result promise too
  t.deepEqual(log.shift(), { type: 'subscribe', target: 'p+5' });
  t.deepEqual(log, []);

  // now we tell it the promise has resolved, to object 'o2'
  dispatch.notify(oneResolution(p1, false, capargs(slot0arg, [o2])));
  await waitUntilQuiescent();
  // this allows E(o2).nonpipe2() to go out, which was not pipelined
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: o2,
    method: 'nonpipe2',
    args: capargs([], []),
    resultSlot: 'p+6',
  });
  // and nonpipe2() wants a result
  t.deepEqual(log.shift(), { type: 'subscribe', target: 'p+6' });
  t.deepEqual(log, []);

  // now call two(), which should send nonpipe3 to o2, not p1, since p1 has
  // been resolved
  dispatch.deliver(rootA, 'two', capargs([], []));
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: o2,
    method: 'nonpipe3',
    args: capargs([], []),
    resultSlot: 'p+7',
  });
  // and nonpipe3() wants a result
  t.deepEqual(log.shift(), { type: 'subscribe', target: 'p+7' });
  t.deepEqual(log, []);
});

async function doOutboundPromise(t, mode) {
  const { log, syscall } = buildSyscall();

  function build(_vatPowers) {
    return Far('root', {
      run(target, resolution) {
        let p; // vat creates the promise
        if (resolution === 'reject') {
          // eslint-disable-next-line prefer-promise-reject-errors
          p = Promise.reject('reject');
        } else {
          p = Promise.resolve(resolution); // resolves in future turn
        }
        E(target).one(p); // sends promise
        // then sends resolution/rejection

        // Queue up a call that includes the promise again. This will run
        // *after* the promise has been resolved. Our current implementation
        // will use the same promise identifier.
        Promise.resolve().then(() => E(target).two(p));
      },
    });
  }
  const dispatch = makeDispatch(syscall, build);

  t.deepEqual(log, []);

  const rootA = 'o+0';
  const target = 'o-1';
  const expectedP1 = 'p+5';
  const expectedResultP1 = 'p+6';
  const expectedP2 = 'p+7';
  const expectedResultP2 = 'p+8';
  const slot0arg = { '@qclass': 'slot', index: 0 };

  let resolution;
  const resolveSyscall = {
    type: 'resolve',
    resolutions: [[expectedP1, false]],
  };
  if (mode === 'to presence') {
    // n.b.: because the `body` object gets stringified and THEN compared to the
    // `body` string generated by liveslots, the order of the properties here is
    // significant.
    const body = {
      '@qclass': 'slot',
      iface: `Alleged: presence ${target}`,
      index: 0,
    };
    resolution = slot0arg;
    resolveSyscall.resolutions[0][2] = capargs(body, [target]);
  } else if (mode === 'to data') {
    resolution = 4;
    resolveSyscall.resolutions[0][2] = capargs(4, []);
  } else if (mode === 'reject') {
    resolution = 'reject';
    resolveSyscall.resolutions[0][1] = true;
    resolveSyscall.resolutions[0][2] = capargs('reject', []);
  } else {
    assert.fail(X`unknown mode ${mode}`);
  }

  // function deliver(target, method, argsdata, result) {
  dispatch.deliver(rootA, 'run', capargs([slot0arg, resolution], [target]));
  await waitUntilQuiescent();

  // The vat should send 'one' and mention the promise for the first time. It
  // does not subscribe to its own promise.
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: target,
    method: 'one',
    args: capargs([slot0arg], [expectedP1]),
    resultSlot: expectedResultP1,
  });
  // then it subscribes to the result promise
  t.deepEqual(log.shift(), { type: 'subscribe', target: expectedResultP1 });

  // on the next turn, the promise is resolved/rejected, and the vat notifies the
  // kernel
  t.deepEqual(log.shift(), resolveSyscall);

  // On the next turn, 'two' is sent, with the previously-resolved promise.
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: target,
    method: 'two',
    args: capargs([slot0arg], [expectedP2]),
    resultSlot: expectedResultP2,
  });
  resolveSyscall.resolutions[0][0] = expectedP2;
  t.deepEqual(log.shift(), resolveSyscall);

  // and again it subscribes to the result promise
  t.deepEqual(log.shift(), { type: 'subscribe', target: expectedResultP2 });

  t.deepEqual(log, []);
}

test('liveslots retires outbound promise IDs after resolve to presence', async t => {
  await doOutboundPromise(t, 'to presence');
});

test('liveslots retires outbound promise IDs after resolve to data', async t => {
  await doOutboundPromise(t, 'to data');
});

test('liveslots retires outbound promise IDs after reject', async t => {
  await doOutboundPromise(t, 'reject');
});

function hush(p) {
  p.then(
    () => undefined,
    () => undefined,
  );
}

async function doResultPromise(t, mode) {
  const { log, syscall } = buildSyscall();

  function build(_vatPowers) {
    return Far('root', {
      async run(target1) {
        const p1 = E(target1).getTarget2();
        hush(p1);
        const p2 = E(p1).one();
        // p1 resolves first, then p2 resolves on a subsequent crank
        await p2;
        // the second call to p1 should be sent to the object, not the
        // promise, since the resolution of p1 is now known
        const p3 = E(p1).two();
        hush(p3);
      },
    });
  }
  const dispatch = makeDispatch(syscall, build);
  t.deepEqual(log, []);

  const slot0arg = { '@qclass': 'slot', index: 0 };
  const rootA = 'o+0';
  const target1 = 'o-1';
  const expectedP1 = 'p+5';
  const expectedP2 = 'p+6';
  const expectedP3 = 'p+7';
  // if getTarget2 returns an object, two() is sent to it
  const target2 = 'o-2';
  // if it returns data or a rejection, two() results in an error

  dispatch.deliver(rootA, 'run', capargs([slot0arg], [target1]));
  await waitUntilQuiescent();

  // The vat should send 'getTarget2' and subscribe to the result promise
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: target1,
    method: 'getTarget2',
    args: capargs([], []),
    resultSlot: expectedP1,
  });
  t.deepEqual(log.shift(), { type: 'subscribe', target: expectedP1 });

  // then it should pipeline the one(), and subscribe to the result
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: expectedP1,
    method: 'one',
    args: capargs([], []),
    resultSlot: expectedP2,
  });
  t.deepEqual(log.shift(), { type: 'subscribe', target: expectedP2 });

  // now it should be waiting for p2 to resolve, before it can send two()
  t.deepEqual(log, []);

  // resolve p1 first. The one() call was already pipelined, so this
  // should not trigger any new syscalls.
  if (mode === 'to presence') {
    dispatch.notify(
      oneResolution(expectedP1, false, capargs(slot0arg, [target2])),
    );
  } else if (mode === 'to data') {
    dispatch.notify(oneResolution(expectedP1, false, capargs(4, [])));
  } else if (mode === 'reject') {
    dispatch.notify(oneResolution(expectedP1, true, capargs('error', [])));
  } else {
    assert.fail(X`unknown mode ${mode}`);
  }
  await waitUntilQuiescent();
  t.deepEqual(log, []);

  // Now we resolve p2, allowing the second two() to proceed
  dispatch.notify(oneResolution(expectedP2, false, capargs(4, [])));
  await waitUntilQuiescent();

  if (mode === 'to presence') {
    // If we resolved it to a target, we should see two() sent through to the
    // new target, not the original promise.
    t.deepEqual(log.shift(), {
      type: 'send',
      targetSlot: target2, // #823 fails here: expect o-2, get p+5
      method: 'two',
      args: capargs([], []),
      resultSlot: expectedP3,
    });
    t.deepEqual(log.shift(), { type: 'subscribe', target: expectedP3 });
  } else if (mode === 'to data' || mode === 'reject') {
    // Resolving to a non-target means a locally-generated error, and no
    // send() call
  } else {
    assert.fail(X`unknown mode ${mode}`);
  }
  // #823 fails here for the non-presence cases: we expect no syscalls, but
  // instead we get a send to p+5
  t.deepEqual(log, []);
}

test('liveslots retires result promise IDs after resolve to presence', async t => {
  await doResultPromise(t, 'to presence');
});

test('liveslots retires result promise IDs after resolve to data', async t => {
  await doResultPromise(t, 'to data');
});

test('liveslots retires result promise IDs after reject', async t => {
  await doResultPromise(t, 'reject');
});

test('liveslots vs symbols', async t => {
  const { log, syscall } = buildSyscall();

  function build(_vatPowers) {
    return Far('root', {
      [Symbol.asyncIterator](arg) {
        return ['ok', 'asyncIterator', arg];
      },
      good(target) {
        E(target)[Symbol.asyncIterator]('arg');
      },
      bad(target) {
        return E(target)
          [Symbol.for('nope')]('arg')
          .then(
            _ok => 'oops no error',
            err => ['caught', err],
          );
      },
    });
  }
  const dispatch = makeDispatch(syscall, build);
  t.deepEqual(log, []);
  const rootA = 'o+0';
  const target = 'o-1';

  // E(root)[Symbol.asyncIterator]('one')
  const rp1 = 'p-1';
  dispatch.deliver(rootA, 'Symbol.asyncIterator', capargs(['one']), 'p-1');
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), {
    type: 'resolve',
    resolutions: [[rp1, false, capargs(['ok', 'asyncIterator', 'one'])]],
  });
  t.deepEqual(log, []);

  // root~.good(target) -> send(methodname=Symbol.asyncIterator)
  dispatch.deliver(
    rootA,
    'good',
    capargs([{ '@qclass': 'slot', index: 0 }], [target]),
    undefined,
  );
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), {
    type: 'send',
    targetSlot: target,
    method: 'Symbol.asyncIterator',
    args: capargs(['arg']),
    resultSlot: 'p+5',
  });
  t.deepEqual(log.shift(), { type: 'subscribe', target: 'p+5' });
  t.deepEqual(log, []);

  // root~.bad(target) -> error because other Symbols are rejected
  const rp2 = 'p-2';
  const expErr = {
    '@qclass': 'error',
    errorId: 'error:liveSlots:vatA#1',
    message: 'arbitrary Symbols cannot be used as method names',
    name: 'Error',
  };
  dispatch.deliver(
    rootA,
    'bad',
    capargs([{ '@qclass': 'slot', index: 0 }], [target]),
    rp2,
  );
  await waitUntilQuiescent();
  t.deepEqual(log.shift(), {
    type: 'resolve',
    resolutions: [[rp2, false, capargs(['caught', expErr])]],
  });
  t.deepEqual(log, []);
});
