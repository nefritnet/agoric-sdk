// @ts-check

import { E } from '@agoric/eventual-send';
import { assert, details as X } from '@agoric/assert';
import { MathKind, amountMath } from '@agoric/ertp/src/amountMath';

import {
  getInputPrice,
  getOutputPrice,
  calcLiqValueToMint,
  calcValueToRemove,
  trade,
  calcSecondaryRequired,
} from '../../contractSupport';

import '../../../exported';

/**
 * @param {ContractFacet} zcf
 * @param {(brand: Brand) => boolean} isSecondary
 * @param {(brand: Brand, pool: Pool) => void} initPool
 * @param {Brand} centralBrand
 */
export const makeAddPool = (zcf, isSecondary, initPool, centralBrand) => {
  const makePool = (liquidityZcfMint, poolSeat, secondaryBrand) => {
    let liqTokenSupply = 0n;
    const {
      brand: liquidityBrand,
      issuer: liquidityIssuer,
    } = liquidityZcfMint.getIssuerRecord();

    const addLiquidityActual = (pool, zcfSeat, secondaryAmount) => {
      const liquidityValueOut = calcLiqValueToMint(
        liqTokenSupply,
        zcfSeat.getAmountAllocated('Central').value,
        pool.getCentralAmount().value,
      );

      const liquidityAmountOut = amountMath.make(
        liquidityValueOut,
        liquidityBrand,
      );
      liquidityZcfMint.mintGains({ Liquidity: liquidityAmountOut }, poolSeat);
      liqTokenSupply += liquidityValueOut;

      trade(
        zcf,
        {
          seat: poolSeat,
          gains: {
            Central: zcfSeat.getCurrentAllocation().Central,
            Secondary: secondaryAmount,
          },
        },
        {
          seat: zcfSeat,
          gains: { Liquidity: liquidityAmountOut },
        },
      );
      zcfSeat.exit();
      return 'Added liquidity.';
    };

    const assertPoolInitialized = pool =>
      assert(
        !pool.getAmountMath().isEmpty(pool.getSecondaryAmount()),
        X`pool not initialized`,
      );

    const getReserves = (pool, inputBrand, outputBrand) => {
      let inputReserve;
      let outputReserve;
      if (isSecondary(outputBrand) && centralBrand === inputBrand) {
        inputReserve = pool.getCentralAmount().value;
        outputReserve = pool.getSecondaryAmount().value;
      } else if (isSecondary(inputBrand) && centralBrand === outputBrand) {
        inputReserve = pool.getSecondaryAmount().value;
        outputReserve = pool.getCentralAmount().value;
      } else {
        throw Error('brands must be central and secondary');
      }
      return { inputReserve, outputReserve };
    };

    /** @type {Pool} */
    const pool = {
      getLiquiditySupply: () => liqTokenSupply,
      getLiquidityIssuer: () => liquidityIssuer,
      getPoolSeat: () => poolSeat,
      getCentralAmount: () =>
        poolSeat.getAmountAllocated('Central', centralBrand),
      getSecondaryAmount: () =>
        poolSeat.getAmountAllocated('Secondary', secondaryBrand),

      // The caller wants to sell inputAmount. if that could produce at most N,
      // but they could also get N by only selling inputAmount - epsilon
      // we'll reply with { amountIn: inputAmount - epsilon, amountOut: N }.
      getPriceGivenAvailableInput: (inputAmount, outputBrand) => {
        assertPoolInitialized(pool);
        const { inputReserve, outputReserve } = getReserves(
          pool,
          inputAmount.brand,
          outputBrand,
        );
        const valueOut = getInputPrice(
          inputAmount.value,
          inputReserve,
          outputReserve,
        );
        const valueIn = getOutputPrice(valueOut, inputReserve, outputReserve);
        return {
          amountOut: amountMath.make(valueOut, outputBrand),
          amountIn: amountMath.make(valueIn, inputAmount.brand),
        };
      },

      // The caller wants at least outputAmount. if that requires at least N,
      // but they can get outputAmount + delta for N, we'll reply with
      // { amountIn: N, amountOut: outputAmount + delta }.
      getPriceGivenRequiredOutput: (inputBrand, outputAmount) => {
        assertPoolInitialized(pool);
        const { inputReserve, outputReserve } = getReserves(
          pool,
          inputBrand,
          outputAmount.brand,
        );
        const valueIn = getOutputPrice(
          outputAmount.value,
          inputReserve,
          outputReserve,
        );
        const valueOut = getInputPrice(valueIn, inputReserve, outputReserve);
        return {
          amountOut: amountMath.make(valueOut, outputAmount.brand),
          amountIn: amountMath.make(valueIn, inputBrand),
        };
      },
      addLiquidity: zcfSeat => {
        if (liqTokenSupply === 0n) {
          const userAllocation = zcfSeat.getCurrentAllocation();
          return addLiquidityActual(pool, zcfSeat, userAllocation.Secondary);
        }

        const userAllocation = zcfSeat.getCurrentAllocation();
        const secondaryIn = userAllocation.Secondary;

        // To calculate liquidity, we'll need to calculate alpha from the primary
        // token's value before, and the value that will be added to the pool
        const secondaryOut = amountMath.make(
          calcSecondaryRequired(
            userAllocation.Central.value,
            pool.getCentralAmount().value,
            pool.getSecondaryAmount().value,
            secondaryIn.value,
          ),
          secondaryBrand,
        );

        // Central was specified precisely so offer must provide enough secondary.
        assert(
          amountMath.isGTE(secondaryIn, secondaryOut),
          'insufficient Secondary deposited',
        );

        return addLiquidityActual(pool, zcfSeat, secondaryOut);
      },
      removeLiquidity: userSeat => {
        const liquidityIn = userSeat.getAmountAllocated(
          'Liquidity',
          liquidityBrand,
        );
        const liquidityValueIn = liquidityIn.value;
        assert.typeof(liquidityValueIn, 'bigint');
        const centralTokenAmountOut = amountMath.make(
          calcValueToRemove(
            liqTokenSupply,
            pool.getCentralAmount().value,
            liquidityValueIn,
          ),
          centralBrand,
        );

        const tokenKeywordAmountOut = amountMath.make(
          calcValueToRemove(
            liqTokenSupply,
            pool.getSecondaryAmount().value,
            liquidityValueIn,
          ),
          secondaryBrand,
        );

        liqTokenSupply -= liquidityValueIn;

        trade(
          zcf,
          {
            seat: poolSeat,
            gains: { Liquidity: liquidityIn },
          },
          {
            seat: userSeat,
            gains: {
              Central: centralTokenAmountOut,
              Secondary: tokenKeywordAmountOut,
            },
          },
        );

        userSeat.exit();
        return 'Liquidity successfully removed.';
      },
    };
    return pool;
  };

  /**
   * Allows users to add new liquidity pools. `secondaryIssuer` and
   * its keyword must not have been already used
   *
   * @param {Issuer} secondaryIssuer
   * @param {Keyword} keyword - will be used in the
   * terms.issuers for the contract, but not used otherwise
   */
  const addPool = async (secondaryIssuer, keyword) => {
    const liquidityKeyword = `${keyword}Liquidity`;
    zcf.assertUniqueKeyword(liquidityKeyword);

    const [secondaryMathKind, secondaryBrand] = await Promise.all([
      E(secondaryIssuer).getAmountMathKind(),
      E(secondaryIssuer).getBrand(),
    ]);

    assert(
      !isSecondary(secondaryBrand),
      X`issuer ${secondaryIssuer} already has a pool`,
    );
    assert(
      secondaryMathKind === MathKind.NAT,
      X`${keyword} issuer must use NAT math`,
    );

    // We've checked all the foreseeable exceptions (except
    // zcf.assertUniqueKeyword(keyword), which will be checked by saveIssuer()
    // before proceeding), so we can do the work now.
    await zcf.saveIssuer(secondaryIssuer, keyword);
    const liquidityZCFMint = await zcf.makeZCFMint(liquidityKeyword);
    const { zcfSeat: poolSeat } = zcf.makeEmptySeatKit();
    const pool = makePool(liquidityZCFMint, poolSeat, secondaryBrand);
    initPool(secondaryBrand, pool);
    return liquidityZCFMint.getIssuerRecord().issuer;
  };

  return addPool;
};
