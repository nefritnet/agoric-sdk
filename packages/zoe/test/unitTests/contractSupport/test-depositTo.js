/* global __dirname */
// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'ava';

import { E } from '@agoric/eventual-send';
import bundleSource from '@agoric/bundle-source';

import { setup } from '../setupBasicMints';
import { makeZoe } from '../../..';
import { makeFakeVatAdmin } from '../../../src/contractFacet/fakeVatAdmin';
import { depositToSeat } from '../../../src/contractSupport/zoeHelpers';

const contractRoot = `${__dirname}/../zcf/zcfTesterContract`;

const makeOffer = async (zoe, zcf, proposal, payments) => {
  let zcfSeat;
  const getSeat = seat => {
    zcfSeat = seat;
  };
  const invitation = await zcf.makeInvitation(getSeat, 'seat');
  const userSeat = await E(zoe).offer(invitation, proposal, payments);
  return { zcfSeat, userSeat };
};

async function setupContract(moolaIssuer, bucksIssuer) {
  let testJig;
  const setJig = jig => {
    testJig = jig;
  };
  const zoe = makeZoe(makeFakeVatAdmin(setJig).admin);

  // pack the contract
  const bundle = await bundleSource(contractRoot);
  // install the contract
  const installation = await zoe.install(bundle);

  // Alice creates an instance
  const issuerKeywordRecord = harden({
    Pixels: moolaIssuer,
    Money: bucksIssuer,
  });

  await E(zoe).startInstance(installation, issuerKeywordRecord);

  /** @type {ContractFacet} */
  const zcf = testJig.zcf;
  return { zoe, zcf };
}

test(`depositToSeat - groundZero`, async t => {
  const { moola, moolaIssuer, bucksMint, bucks, bucksIssuer } = setup();
  const { zoe, zcf } = await setupContract(moolaIssuer, bucksIssuer);

  const { zcfSeat } = await makeOffer(
    zoe,
    zcf,
    harden({ want: { A: moola(3) }, give: { B: bucks(5) } }),
    harden({ B: bucksMint.mintPayment(bucks(5)) }),
  );
  const newBucks = bucksMint.mintPayment(bucks(2));
  await depositToSeat(zcf, zcfSeat, { B: bucks(2) }, { B: newBucks });
  t.deepEqual(
    zcfSeat.getCurrentAllocation(),
    { A: moola(0), B: bucks(7) },
    'should add deposit',
  );
});

test(`depositToSeat - keyword variations`, async t => {
  const { moola, moolaIssuer, bucksMint, bucks, bucksIssuer } = setup();
  const { zoe, zcf } = await setupContract(moolaIssuer, bucksIssuer);

  const { zcfSeat } = await makeOffer(
    zoe,
    zcf,
    harden({ want: { A: moola(3) }, give: { B: bucks(5) } }),
    harden({ B: bucksMint.mintPayment(bucks(5)) }),
  );
  const newBucks = bucksMint.mintPayment(bucks(2));
  await depositToSeat(zcf, zcfSeat, { C: bucks(2) }, { C: newBucks });
  t.deepEqual(
    zcfSeat.getCurrentAllocation(),
    { A: moola(0), B: bucks(5), C: bucks(2) },
    'should add deposit',
  );
});

test(`depositToSeat - mismatched keywords`, async t => {
  const { moola, moolaIssuer, bucksMint, bucks, bucksIssuer } = setup();
  const { zoe, zcf } = await setupContract(moolaIssuer, bucksIssuer);

  const { zcfSeat } = await makeOffer(
    zoe,
    zcf,
    harden({ want: { A: moola(3) }, give: { B: bucks(5) } }),
    harden({ B: bucksMint.mintPayment(bucks(5)) }),
  );
  const newBucks = bucksMint.mintPayment(bucks(2));
  await t.throwsAsync(
    () => depositToSeat(zcf, zcfSeat, { C: bucks(2) }, { D: newBucks }),
    {
      message: `payment not found for (a string)`,
    },
    'mismatched keywords',
  );
  t.deepEqual(
    zcfSeat.getCurrentAllocation(),
    { A: moola(0), B: bucks(5) },
    'should add deposit',
  );
});
