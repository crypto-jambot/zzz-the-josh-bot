/*********************************************************************
 * Copyright (C) 2022 Joshua Sells joshuataylorsells@gmail.com
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 *
 * Proprietary and confidential
 *
 *********************************************************************/

import Big from 'big.js';
import { web3 } from '../setup/setup';
import IERC20 from '@openzeppelin/contracts/build/contracts/ERC20.json';
import IUniswapV2Pair from '@uniswap/v2-core/build/IUniswapV2Pair.json';
import { Arb } from '../classes/Arb';
import {
    BalancedPoolsError,
    NegativeAmountOutCalculationError,
    K0IsEqualToK1Error,
    ZeroAmountOutCalculationError,
    FailureToEstimateGas,
} from '../error/error';

export const getPairContracts = (pair) => {
    for (let i = 0; i < pair.exchanges.length; i++) {
        pair.exchanges[i].pairContract = getPairContract(pair.exchanges[i].pairAddress);
    }
};

const getPairContract = (pairAddress) => {
    return new web3.eth.Contract(IUniswapV2Pair.abi, pairAddress);
};

export const getAllReserves = async (pair) => {
    for (let i = 0; i < pair.exchanges.length; i++) {
        pair.exchanges[i].reserves = await getReserves(pair.exchanges[i].pairContract);
    }
};

export const getReserves = async (pairContract) => {
    const { reserve0, reserve1 } = await pairContract.methods.getReserves().call();
    if (Big(reserve0).eq(Big(0)) || Big(reserve1).eq(Big(0))) {
        // console.error(`ERROR: Empty Reserves for pair contract: ${pairContract._address}`);
        return null;
    }
    if (Big(reserve0).lt(Big(0)) || Big(reserve1).lt(Big(0))) {
        // console.error(`ERROR: Negative Reserves for pair contract: ${pairContract._address}`);
        return null;
    }
    return { reserve0, reserve1 };
};

export const generateListOfArbs = async (pair) => {
    let arbList = [];

    // Go through each exchange in the outer loop
    for (let x = 0; x < pair.exchanges.length; x++) {
        // Go through a subset of exchanges and compare to the exchange in the outer loop
        for (let y = x + 1; y < pair.exchanges.length; y++) {
            // Check to make sure reserves are valid before proceeding
            if (pair.exchanges[x].reserves == null || pair.exchanges[y].reserves == null) continue;

            try {
                const arb = new Arb();
                await arb.initialize(x, y, pair);
                if (!Big(arb.grossProfit).gt(Big(0))) continue;
                await arb.calculateGas();
                arbList.push(arb);
            } catch (err) {
                if (err instanceof BalancedPoolsError) {
                    // console.log(
                    //     `Pools for ${pair.token0Symbol} and ${pair.token1Symbol} are already balanced between ${err.exchangeX.name} - ${err.exchangeX.pairAddress} - and ${err.exchangeY.name} - ${err.exchangeY.pairAddress}.`
                    // );
                    continue;
                } else if (err instanceof NegativeAmountOutCalculationError) {
                    // console.log(
                    //     `Calculated amount to recieve from pool0 is negative - pool0PairAddress: ${err.pool0.pairAddress} - pool1PairAddress: ${err.pool1.pairAddress} - orderedReserves: ${err.orderedReserves}.`
                    // );
                    continue;
                } else if (err instanceof K0IsEqualToK1Error || err instanceof ZeroAmountOutCalculationError) {
                    // console.log(err.message);
                    continue;
                } else if (err instanceof FailureToEstimateGas) {
                    // console.log(err.message);
                    continue;
                } else {
                    console.log(`Unknown Error encountered: ${err.message}`);
                    // throw err;
                }
            }
        }
    }
    return arbList;
};

export const getTokenContract = (tokenAddress) => {
    return new web3.eth.Contract(IERC20.abi, tokenAddress);
};

export const containsProfitableArb = (arbList) => {
    if (arbList.length == 0) {
        return false;
    }

    let potentialArbInList = false;
    for (const arb of arbList) {
        if (arb.shouldAttemptArbitrage) {
            potentialArbInList = true;
        }
        // if (Big(arb.grossProfit).gt(Big(0))) {
        //     potentialArbInList = true;
        // }
    }

    // return true;
    return potentialArbInList;
};

export const getInstructions = (pair, bestArb, pool0InputToken, pool0OutputToken, pool1InputToken, pool1OutputToken) => {
    // Create a stringBuilder for displaying results once everything is done.
    let results = `-----------------------------------------\n`;
    results += `Potential Arb found with the Pair: ${pair.token0Symbol}/${pair.token1Symbol}.\n\n`;
    results += `Spend ${Big(bestArb.pool0.amountIn)
        .div(Big(10).pow(Number(pool0InputToken.decimals)))
        .toFixed(4)} ${pool0InputToken.symbol} and receieve ${Big(bestArb.pool0.amountOut)
        .div(Big(10).pow(Number(pool0OutputToken.decimals)))
        .toFixed(4)} ${pool0OutputToken.symbol} on ${bestArb.pool0.exchange.name}\n`;
    results += `Dump ${Big(bestArb.pool1.amountIn)
        .div(Big(10).pow(Number(pool1InputToken.decimals)))
        .toFixed(4)} ${pool1InputToken.symbol} and receieve ${Big(bestArb.pool1.amountOut)
        .div(Big(10).pow(Number(pool1OutputToken.decimals)))
        .toFixed(4)} ${pool1OutputToken.symbol} on ${bestArb.pool1.exchange.name}\n`;
    results += `NET PROFIT: ${Big(bestArb.netProfit)
        .div(Big(10).pow(Number(pool1OutputToken.decimals)))
        .toFixed(10)} ${pool1OutputToken.symbol}\n\n`;
    results += `_token0: ${pool0InputToken.address}\n`;
    results += `_token1: ${pool0OutputToken.address}\n`;
    results += `_tradeAmount: ${bestArb.pool0.amountIn}\n`;
    results += `_router0: ${bestArb.pool0.exchange.routerAddress}\n`;
    results += `_router1: ${bestArb.pool1.exchange.routerAddress}\n`;
    results += `pool0PairAddress: ${bestArb.pool0.pairAddress}\n`;
    results += `pool1PairAddress: ${bestArb.pool1.pairAddress}\n`;
    results += `-----------------------------------------\n`;
    return results;
};

export const getOrderedTokens = (bestArb) => {
    let pool0InputToken = null;
    let pool0OutputToken = null;
    let pool1InputToken = null;
    let pool1OutputToken = null;

    if (bestArb.pool0.ordered) {
        pool0InputToken = bestArb.pool0.token0;
        pool0OutputToken = bestArb.pool0.token1;
    } else {
        pool0InputToken = bestArb.pool0.token1;
        pool0OutputToken = bestArb.pool0.token0;
    }

    if (bestArb.pool1.ordered) {
        pool1InputToken = bestArb.pool1.token0;
        pool1OutputToken = bestArb.pool1.token1;
    } else {
        pool1InputToken = bestArb.pool1.token1;
        pool1OutputToken = bestArb.pool1.token0;
    }

    return {
        pool0InputToken: pool0InputToken,
        pool0OutputToken: pool0OutputToken,
        pool1InputToken: pool1InputToken,
        pool1OutputToken: pool1OutputToken,
    };
};

export const getBestArb = (arbList) => {
    return arbList.reduce((previous, current) => {
        if (previous.estimatedNetProfit == null) {
            return current;
        }
        if (current.estimatedNetProfit == null) {
            return previous;
        }
        return current.estimatedNetProfit > previous.estimatedNetProfit ? current : previous;
    }, arbList[0]);
    // return arbList.reduce((previous, current) => {
    //     if (previous.grossProfit == null) {
    //         return current;
    //     }
    //     if (current.grossProfit == null) {
    //         return previous;
    //     }
    //     return current.grossProfit > previous.grossProfit ? current : previous;
    // }, arbList[0]);
};

export const convertToWei = (amount, decimals) => {
    return Big(amount)
        .times(Big(10).pow(Number(decimals)))
        .toString();
};

export const convertFromWei = (amount, decimals) => {
    return Big(amount)
        .div(Big(10).pow(Number(decimals)))
        .toString();
};
