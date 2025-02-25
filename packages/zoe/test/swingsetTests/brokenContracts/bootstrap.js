import { E } from '@agoric/eventual-send';
import { Far } from '@agoric/marshal';
import { makeIssuerKit } from '@agoric/ertp';
/* eslint-disable import/extensions, import/no-unresolved */
import crashingAutoRefund from './bundle-crashingAutoRefund';
/* eslint-enable import/extensions, import/no-unresolved */

const setupBasicMints = () => {
  const all = [
    makeIssuerKit('moola'),
    makeIssuerKit('simoleans'),
    makeIssuerKit('bucks'),
  ];
  const mints = all.map(objs => objs.mint);
  const issuers = all.map(objs => objs.issuer);
  const amountMaths = all.map(objs => objs.amountMath);

  return harden({
    mints,
    issuers,
    amountMaths,
  });
};

const makeVats = (log, vats, zoe, installations, startingValues) => {
  const { mints, issuers, amountMaths } = setupBasicMints();
  const makePayments = values =>
    mints.map((mint, i) => {
      return mint.mintPayment(amountMaths[i].make(values[i]));
    });

  // Setup Alice
  const alicePayment = makePayments(startingValues);
  // const alicePayment = mints[0].mintPayment(amountMaths[0].make(3));
  const aliceP = E(vats.alice).build(zoe, issuers, alicePayment, installations);

  log(`=> alice is set up`);
  return harden(aliceP);
};

export function buildRootObject(vatPowers, vatParameters) {
  return Far('root', {
    async bootstrap(vats, devices) {
      const vatAdminSvc = await E(vats.vatAdmin).createVatAdminService(
        devices.vatAdmin,
      );
      const zoe = await E(vats.zoe).buildZoe(vatAdminSvc);
      const installations = {
        crashAutoRefund: await E(zoe).install(crashingAutoRefund.bundle),
      };

      const [testName, startingValues] = vatParameters.argv;

      const aliceP = makeVats(
        vatPowers.testLog,
        vats,
        zoe,
        installations,
        startingValues,
      );
      await E(aliceP).startTest(testName);
    },
  });
}
