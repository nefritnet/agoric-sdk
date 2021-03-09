import { makeIssuerKit, amountMath } from '@agoric/ertp';
import { makeZoe } from '../../src/zoeService/zoe';
import fakeVatAdmin from '../../src/contractFacet/fakeVatAdmin';

const setup = () => {
  const moolaBundle = makeIssuerKit('moola');
  const simoleanBundle = makeIssuerKit('simoleans');
  const bucksBundle = makeIssuerKit('bucks');
  const allBundles = {
    moola: moolaBundle,
    simoleans: simoleanBundle,
    bucks: bucksBundle,
  };
  const brands = new Map();

  for (const k of Object.getOwnPropertyNames(allBundles)) {
    brands.set(k, allBundles[k].brand);
  }

  const zoe = makeZoe(fakeVatAdmin);

  const makeSimpleMake = brand => value => amountMath.make(value, brand);

  return harden({
    moolaIssuer: moolaBundle.issuer,
    moolaMint: moolaBundle.mint,
    moolaR: moolaBundle,
    moolaKit: moolaBundle,
    simoleanIssuer: simoleanBundle.issuer,
    simoleanMint: simoleanBundle.mint,
    simoleanR: simoleanBundle,
    simoleanKit: simoleanBundle,
    bucksIssuer: bucksBundle.issuer,
    bucksMint: bucksBundle.mint,
    bucksR: bucksBundle,
    bucksKit: bucksBundle,
    brands,
    moola: makeSimpleMake(moolaBundle.brand),
    simoleans: makeSimpleMake(simoleanBundle.brand),
    bucks: makeSimpleMake(bucksBundle.brand),
    zoe,
  });
};
harden(setup);
export { setup };
