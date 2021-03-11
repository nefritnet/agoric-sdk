/* global __dirname */
// ts-check
import '../../../../exported';

// eslint-disable-next-line import/no-extraneous-dependencies
import '@agoric/install-ses';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'ava';
import { E } from '@agoric/eventual-send';
import { amountMath } from '@agoric/ertp';
import bundleSource from '@agoric/bundle-source';
import { makeNotifierKit } from '@agoric/notifier';

import { checkDetails, checkPayout } from './helpers';
import { setup } from '../../setupBasicMints';
import { makeFakePriceAuthority } from '../../../../tools/fakePriceAuthority';
import buildManualTimer from '../../../../tools/manualTimer';
import { makeRatio } from '../../../../src/contractSupport';

const loanRoot = `${__dirname}/../../../../src/contracts/loan/`;
const autoswapRoot = `${__dirname}/../../../../src/contracts/autoswap`;

test.todo('loan - no mmr');
test.todo('loan - bad mmr');
test.todo('loan - no priceAuthority');
test.todo('loan - badPriceAuthority');
test.todo('loan - bad autoswap, no autoswap');
test.todo('loan - wrong keywords');

test.todo('loan - lend - wrong exit rule');
test.todo('loan - lend - must want nothing');

test('loan - lend - exit before borrow', async t => {
  const { moolaKit: collateralKit, simoleanKit: loanKit, zoe } = setup();
  const bundle = await bundleSource(loanRoot);
  const installation = await E(zoe).install(bundle);

  // Create autoswap installation and instance
  const autoswapBundle = await bundleSource(autoswapRoot);
  const autoswapInstallation = await E(zoe).install(autoswapBundle);

  const { instance: autoswapInstance } = await E(zoe).startInstance(
    autoswapInstallation,
    harden({ Central: collateralKit.issuer, Secondary: loanKit.issuer }),
  );

  const issuerKeywordRecord = harden({
    Collateral: collateralKit.issuer,
    Loan: loanKit.issuer,
  });

  const timer = buildManualTimer(console.log);

  const priceAuthority = makeFakePriceAuthority({
    priceList: [],
    timer,
  });

  const { notifier: periodNotifier } = makeNotifierKit();

  const terms = {
    mmr: makeRatio(150, loanKit.brand),
    autoswapInstance,
    priceAuthority,
    periodNotifier,
    interestRate: 5,
    interestPeriod: 10,
  };

  const { creatorInvitation: lendInvitation, instance } = await E(
    zoe,
  ).startInstance(installation, issuerKeywordRecord, terms);

  const maxLoan = amountMath.make(1000n, loanKit.brand);

  // Alice is willing to lend Loan tokens
  const proposal = harden({
    give: { Loan: maxLoan },
  });

  const payments = harden({
    Loan: loanKit.mint.mintPayment(maxLoan),
  });

  const lenderSeat = await E(zoe).offer(lendInvitation, proposal, payments);

  const borrowInvitation = await E(lenderSeat).getOfferResult();

  await checkDetails(t, zoe, borrowInvitation, {
    description: 'borrow',
    handle: null,
    installation,
    instance,
    maxLoan,
  });

  await E(lenderSeat).tryExit();

  // Usually, the payout is received when either 1) the loan is repaid or 2) the
  // collateral is liquidated.
  await checkPayout(t, lenderSeat, 'Loan', loanKit, maxLoan);
});
