// @ts-check

import { assert, details as X } from '@agoric/assert';
import { mustBeComparable } from '@agoric/same-structure';
import { passStyleOf, REMOTE_STYLE } from '@agoric/marshal';
import { isNat } from '@agoric/nat';

import './types';
import natMathHelpers from './mathHelpers/natMathHelpers';
import setMathHelpers from './mathHelpers/setMathHelpers';
import { isSetValue, isNatValue } from './typeGuards';

// We want an enum, but narrowed to the AmountMathKind type.
/**
 * Constants for the kinds of amountMath we support.
 *
 * @type {{ NAT: 'nat', SET: 'set', STRING_SET: 'strSet' }}
 */
const MathKind = {
  NAT: 'nat',
  SET: 'set',
  STRING_SET: 'strSet',
};
harden(MathKind);

/**
 * Amounts describe digital assets. From an amount, you can learn the
 * kind of digital asset as well as "how much" or "how many". Amounts
 * have two parts: a brand (the kind of digital asset) and the value
 * (the answer to "how much"). For example, in the phrase "5 bucks",
 * "bucks" takes the role of the brand and the value is 5. Amounts
 * can describe fungible and non-fungible digital assets. Amounts are
 * pass-by-copy and can be made by and sent to anyone.
 *
 * The issuer has an internal table that maps purses and payments to
 * amounts. The issuer must be able to do things such as add digital
 * assets to a purse and withdraw digital assets from a purse. To do
 * so, it must know how to add and subtract digital assets. Rather
 * than hard-coding a particular solution, we chose to parameterize
 * the issuer with a collection of polymorphic functions, which we
 * call `amountMath`. These math functions include concepts like
 * addition, subtraction, and greater than or equal to.
 *
 * We also want to make sure there is no confusion as to what kind of
 * asset we are using. Thus, amountMath includes checks of the
 * `brand`, the unique identifier for the type of digital asset. If
 * the wrong brand is used in amountMath, an error is thrown and the
 * operation does not succeed.
 *
 * amountMath uses mathHelpers to do most of the work, but then adds
 * the brand to the result. The function `value` gets the value from
 * the amount by removing the brand (amount -> value), and the function
 * `make` adds the brand to produce an amount (value -> amount). The
 * function `coerce` takes an amount and checks it, returning an amount (amount
 * -> amount).
 *
 * Each issuer of digital assets has an associated brand in a one-to-one
 * mapping. In untrusted contexts, such as in analyzing payments and
 * amounts, we can get the brand and find the issuer which matches the
 * brand. The issuer and the brand mutually validate each other.
 */

/** @type {{ nat: NatMathHelpers, set: SetMathHelpers }} */
const helpers = {
  nat: natMathHelpers,
  set: setMathHelpers,
};

/**
 * @param {Value} value
 * @returns {NatMathHelpers | SetMathHelpers}
 */
const getHelpersFromValue = value => {
  if (isSetValue(value)) {
    return setMathHelpers;
  }
  if (isNatValue(value)) {
    return natMathHelpers;
  }
  assert.fail(X`value ${value} must be a bigint or an array`);
};

/** @type {(amount: Amount) => AmountMathKind} */
const getMathKind = amount => {
  if (isSetValue(amount.value)) {
    return 'set';
  }
  if (isNatValue(amount.value)) {
    return 'nat';
  }
  assert.fail(X`value ${amount.value} must be a bigint or an array`);
};

/**
 * @type {(amount: Amount ) => NatMathHelpers | SetMathHelpers }
 */
const getHelpersFromAmount = amount => {
  return getHelpersFromValue(amount.value);
};

/** @type {(leftAmount: Amount, rightAmount: Amount ) =>
 * NatMathHelpers | SetMathHelpers } */
const getHelpers = (leftAmount, rightAmount) => {
  const leftHelpers = getHelpersFromAmount(leftAmount);
  const rightHelpers = getHelpersFromAmount(rightAmount);
  assert.equal(leftHelpers, rightHelpers);
  return leftHelpers;
};

/** @type {(amount: Amount, brand?: Brand) => void} */
const optionalBrandCheck = (amount, brand) => {
  if (brand !== undefined) {
    mustBeComparable(brand);
    assert.equal(
      amount.brand,
      brand,
      X`amount's brand ${amount.brand} did not match expected brand ${brand}`,
    );
  }
};

/** @type {(value: Value, brand: Brand) => Amount} */
const noCoerceMake = (value, brand) => {
  const amount = harden({ brand, value });
  return amount;
};

/** @type {(value: Value) => void} */
const assertLooksLikeValue = value => {
  assert(
    Array.isArray(value) || isNat(value),
    X`value ${value} must be a Nat or an array`,
  );
};

const brandMethods = ['isMyIssuer', 'getAllegedName', 'getDisplayInfo'];

const checkBrand = (brand, msg) => {
  assert(passStyleOf(brand) === REMOTE_STYLE, msg);
  const ownKeys = Reflect.ownKeys(brand);
  const inBrandMethods = key => brandMethods.includes(key);
  assert(
    ownKeys.every(inBrandMethods),
    X`The brand ${brand} doesn't look like a brand. It has these keys: ${ownKeys}`,
  );
};

/** @type {(brand: Brand) => void} */
const assertLooksLikeBrand = brand => {
  const msg = X`The brand ${brand} doesn't look like a brand.`;
  checkBrand(brand, msg);
};

/**
 * Give a better error message by logging the entire amount
 * rather than just the brand
 *
 * @type {(amount: Amount) => void}
 */
const assertLooksLikeAmountBrand = amount => {
  const msg = X`The amount ${amount} doesn't look like an amount. Did you pass a value instead?`;
  checkBrand(amount.brand, msg);
};

const assertLooksLikeAmount = amount => {
  assertLooksLikeAmountBrand(amount);
  assertLooksLikeValue(amount.value);
};

const checkLRAndGetHelpers = (leftAmount, rightAmount, brand = undefined) => {
  assertLooksLikeAmount(leftAmount);
  assertLooksLikeAmount(rightAmount);
  optionalBrandCheck(leftAmount, brand);
  optionalBrandCheck(rightAmount, brand);
  assert.equal(
    leftAmount.brand,
    rightAmount.brand,
    X`Brands in left ${leftAmount.brand} and right ${rightAmount.brand} should match but do not`,
  );
  return getHelpers(leftAmount, rightAmount);
};

const coerceLR = (h, leftAmount, rightAmount) => {
  return [h.doCoerce(leftAmount.value), h.doCoerce(rightAmount.value)];
};

/** @type {AmountMath} */
const amountMath = {
  make: (allegedValue, brand) => {
    assertLooksLikeBrand(brand);
    assertLooksLikeValue(allegedValue);
    // @ts-ignore
    const value = getHelpersFromValue(allegedValue).doCoerce(allegedValue);
    return harden({ brand, value });
  },
  coerce: (allegedAmount, brand) => {
    assertLooksLikeAmount(allegedAmount);
    assertLooksLikeBrand(brand);
    assert(
      brand === allegedAmount.brand,
      X`The brand in the allegedAmount ${allegedAmount} in 'coerce' didn't match the specified brand ${brand}.`,
    );
    // Will throw on inappropriate value
    return amountMath.make(allegedAmount.value, brand);
  },
  getValue: (amount, brand) => amountMath.coerce(amount, brand).value,
  makeEmpty: (brand, mathKind = MathKind.NAT) => {
    assert(
      helpers[mathKind],
      X`${mathKind} must be MathKind.NAT or MathKind.SET. MathKind.STRING_SET is accepted but deprecated`,
    );
    assertLooksLikeBrand(brand);
    return noCoerceMake(helpers[mathKind].doMakeEmpty(), brand);
  },
  makeEmptyFromAmount: amount =>
    amountMath.makeEmpty(amount.brand, getMathKind(amount)),
  isEmpty: (amount, brand = undefined) => {
    assertLooksLikeAmount(amount);
    optionalBrandCheck(amount, brand);
    const h = getHelpersFromAmount(amount);
    // @ts-ignore
    return h.doIsEmpty(h.doCoerce(amount.value));
  },
  isGTE: (leftAmount, rightAmount, brand = undefined) => {
    const h = checkLRAndGetHelpers(leftAmount, rightAmount, brand);
    // @ts-ignore
    return h.doIsGTE(...coerceLR(h, leftAmount, rightAmount));
  },
  isEqual: (leftAmount, rightAmount, brand = undefined) => {
    const h = checkLRAndGetHelpers(leftAmount, rightAmount, brand);
    // @ts-ignore
    return h.doIsEqual(...coerceLR(h, leftAmount, rightAmount));
  },
  add: (leftAmount, rightAmount, brand = undefined) => {
    const h = checkLRAndGetHelpers(leftAmount, rightAmount, brand);
    return noCoerceMake(
      // @ts-ignore
      h.doAdd(...coerceLR(h, leftAmount, rightAmount)),
      leftAmount.brand,
    );
  },
  subtract: (leftAmount, rightAmount, brand = undefined) => {
    const h = checkLRAndGetHelpers(leftAmount, rightAmount, brand);
    return noCoerceMake(
      // @ts-ignore
      h.doSubtract(...coerceLR(h, leftAmount, rightAmount)),
      leftAmount.brand,
    );
  },
};
harden(amountMath);

export { amountMath, MathKind, getMathKind };
