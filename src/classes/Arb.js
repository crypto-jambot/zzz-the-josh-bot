/*********************************************************************
 * Copyright (C) 2022 Joshua Sells joshuataylorsells@gmail.com
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 *
 * Proprietary and confidential
 *
 *********************************************************************/

import fs from 'fs';
import 'dotenv/config';
import Big from 'big.js';
import {
    BalancedPoolsError,
    NegativeAmountOutCalculationError,
    K0IsEqualToK1Error,
    ZeroAmountOutCalculationError,
    FailureToEstimateGas,
} from '../error/error';
import { exchangeContracts, web3, account as ACCOUNT, dodoPool as DODO_POOL } from '../setup/setup';
import settings from '../config/settings.json';
import IArbitrage from '../../build/contracts/Arbitrage.json';
import { getTokenContract, convertFromWei } from '../util/util';
import { BigQuery } from '@google-cloud/bigquery';
const arbitrage = new web3.eth.Contract(IArbitrage.abi, IArbitrage.networks[1].address);

export class Arb {
    pool0 = null;
    pool1 = null;
    orderedReserves = null;
    grossProfit = null;
    estimatedGasPrice = null;
    actualGasPrice = null;
    estimatedGasUnits = null;
    actualGasUnits = null;
    estimatedTransactionCost = null;
    actualTransactionCost = null;
    gasLimit = null;
    estimatedNetProfit = null;
    actualNetProfit = null;
    shouldAttemptArbitrage = null;
    transactionSuccess = null;
    transactionHash = null;
    insertTimestamp = null;
    data = null;

    constructor() {}

    initialize = async (x, y, pair) => {
        let exchangeToBuyOn = null;
        let exchangeToSellOn = null;
        let ordered = null;

        // AND logic. If both tokens are lendable, then we can choose the most profitable exchange to start on. (Buy from the most unbalanced liq pool)
        if (pair.token0Lendable && pair.token1Lendable) {
            // determineExchangeToStart = get pair info object with ratio farthest from 1. (the most unbalanced liq pool)

            exchangeToBuyOn = this.getMostUnbalancedPool(pair.exchanges[x], pair.exchanges[y]);

            exchangeToSellOn = exchangeToBuyOn == pair.exchanges[x] ? pair.exchanges[y] : pair.exchanges[x];

            // once you have an exchange to start with, find the token that has the cheapest price ratio between the two pools. It will be 1 or the other.
            ordered = this.getExchangeWithBestPrice(exchangeToBuyOn, exchangeToSellOn, 1) == exchangeToBuyOn;
        } else if (pair.token0Lendable) {
            // Output from initial swap is token1. Find exchange where token0/token1 is the least
            exchangeToBuyOn = this.getExchangeWithBestPrice(pair.exchanges[x], pair.exchanges[y], 1);
            exchangeToSellOn = exchangeToBuyOn == pair.exchanges[x] ? pair.exchanges[y] : pair.exchanges[x];

            ordered = true;
        } else {
            // Output from initial swap is token0. Find exchange where token1/token0 is the least
            exchangeToBuyOn = this.getExchangeWithBestPrice(pair.exchanges[x], pair.exchanges[y], 0);
            exchangeToSellOn = exchangeToBuyOn == pair.exchanges[x] ? pair.exchanges[y] : pair.exchanges[x];

            ordered = false;
        }

        this.pool0 = new Pool(exchangeToBuyOn, pair, ordered);
        this.pool1 = new Pool(exchangeToSellOn, pair, !ordered);
        this.orderedReserves = this.pool0.ordered
            ? [this.pool0.reserve0, this.pool0.reserve1, this.pool1.reserve1, this.pool1.reserve0]
            : [this.pool0.reserve1, this.pool0.reserve0, this.pool1.reserve0, this.pool1.reserve1];

        this.pool0.amountOut = this.calculateAmountToBuy();

        if (Big(this.pool0.amountOut).lte(Big(0))) {
            throw new ZeroAmountOutCalculationError('Calculated amount to buy on exchange 0 was zero or less.');
        }

        this.pool0.amountIn = await this.calculateAmountToSpend();

        if (Big(this.pool0.amountIn).lte(Big(0))) {
            throw new ZeroAmountInCalculationError('Calculated amount to deposit on exchange 0 was zero or less: ');
        }

        this.pool1.amountIn = this.pool0.amountOut;
        this.pool1.amountOut = await this.calculateFinalAmountRecieved();

        if (Big(this.pool1.amountOut).lte(Big(0))) {
            throw new ZeroAmountOutCalculationError('Calculated final amount to recieve from pool1 was zero or less.');
        }
        this.grossProfit = Big(this.pool1.amountOut).minus(this.pool0.amountIn).toString();
    };

    calculateGas = async () => {
        this.estimatedGasPrice = await web3.eth.getGasPrice();
        let gasUnits = 500000;
        if (settings.isDeployed) {
            try {
                gasUnits = await arbitrage.methods
                    .executeTrade(
                        // '0x10Dd6d8A29D489BEDE472CC1b22dc695c144c5c7',
                        this.pool0.ordered ? this.pool0.token0.address : this.pool0.token1.address,
                        this.pool0.ordered ? this.pool0.token1.address : this.pool0.token0.address,
                        this.pool0.amountIn,
                        this.pool0.exchange.routerAddress,
                        this.pool1.exchange.routerAddress
                    )
                    .estimateGas({ from: ACCOUNT });
                // console.log('Gas Estimation Successful.');
            } catch (err) {
                throw new FailureToEstimateGas(`${err.message} - ${this.pool0.exchange.name} and ${this.pool1.exchange.name}`);
            }
        }
        this.estimatedGasUnits = gasUnits;
        // console.log(`Estimated GAS Units: ${this.estimatedGasUnits}`);
        this.gasLimit = Number(
            Big(gasUnits)
                .times(Big(100).plus(Number(process.env.GAS_UNIT_BUFFER_PERCENTAGE)).div(Big(100)))
                .toFixed(0)
        );
        // console.log(`GAS Limit: ${this.gasLimit}`);
        this.estimatedTransactionCost = Big(this.estimatedGasPrice).times(Big(gasUnits)).toString();
        this.estimatedNetProfit = Big(this.grossProfit).minus(Big(this.estimatedTransactionCost)).toString();

        const maxCost = Big(this.estimatedGasPrice).times(Big(this.gasLimit)).toString();
        this.shouldAttemptArbitrage = Big(this.grossProfit).minus(Big(maxCost)).gt(Big(0));
    };

    executeTrade = async () => {
        let running = fs.readFileSync('output/running.txt', 'utf-8');

        if (running == 'true') {
            console.log('Already attrempting a trade.');
            return;
        }

        fs.writeFileSync('output/running.txt', 'true');

        try {
            console.log(`Attempting Arbitrage...\n`);

            const tokenContract = getTokenContract(this.pool0.ordered ? this.pool0.token0.address : this.pool0.token1.address);
            const balanceBefore = await tokenContract.methods.balanceOf(ACCOUNT).call();
            const ethBalanceBefore = await web3.eth.getBalance(ACCOUNT);
            let receipt = null;

            if (settings.executeTrades) {
                // if (!settings.isLocal) {
                const networkId = await web3.eth.net.getId();
                // web3.eth.accounts.wallet.add(process.env.META_MASK_PRIVATE_KEY);
                const transaction = arbitrage.methods.executeTrade(
                    // '0x10Dd6d8A29D489BEDE472CC1b22dc695c144c5c7',
                    this.pool0.ordered ? this.pool0.token0.address : this.pool0.token1.address,
                    this.pool0.ordered ? this.pool0.token1.address : this.pool0.token0.address,
                    this.pool0.amountIn,
                    this.pool0.exchange.routerAddress,
                    this.pool1.exchange.routerAddress
                );
                const encodedTransaction = transaction.encodeABI();
                const nonce = await web3.eth.getTransactionCount(ACCOUNT);
                const signedTx = await web3.eth.accounts.signTransaction(
                    {
                        to: arbitrage.options.address,
                        data: encodedTransaction,
                        gas: this.gasLimit,
                        gasPrice: this.estimatedGasPrice,
                    },
                    process.env.META_MASK_PRIVATE_KEY
                );
                // console.log(signedTx);
                try {
                    receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
                } catch (err) {
                    console.log(err);
                }
            }

            console.log(receipt ? `Trade Complete:\n` : `Skipped over Trade\n`);

            const balanceAfter = await tokenContract.methods.balanceOf(ACCOUNT).call();
            const ethBalanceAfter = await web3.eth.getBalance(ACCOUNT);
            const tokenGained = Big(balanceAfter).minus(Big(balanceBefore)).toString();
            this.actualTransactionCost = Big(ethBalanceBefore).minus(Big(ethBalanceAfter)).toString();
            this.actualNetProfit = Big(tokenGained).minus(Big(this.actualTransactionCost)).toString();

            const inputToken = this.pool0.ordered ? this.pool0.token0 : this.pool0.token1;
            const outputToken = this.pool0.ordered ? this.pool0.token1 : this.pool0.token0;

            if (receipt) {
                this.actualGasUnits = receipt.gasUsed.toString();
                this.actualGasPrice = Big(this.actualTransactionCost).div(Big(this.actualGasUnits)).toString();
                this.transactionSuccess = true;
                this.transactionHash = receipt.transactionHash;
            }

            const data = {
                'Initial Exchange': `${this.pool0.exchange.name} (${this.pool0.pairAddress})`,
                'Final Exchange': `${this.pool1.exchange.name} (${this.pool1.pairAddress})`,
                'Flash Loan Token': `${inputToken.symbol} (${inputToken.address})`,
                'Arbitrage Token': `${outputToken.symbol} (${outputToken.address})`,
                '-': {},
                'Gross Profit': convertFromWei(this.grossProfit, inputToken.decimals),
                'Estimated Net Profit': convertFromWei(this.estimatedNetProfit, inputToken.decimals),
                '-': {},
                'Estimated Gas Price': this.estimatedGasPrice.toString(),
                'Actual Gas Price': receipt ? Big(this.actualTransactionCost).div(Big(receipt.cumulativeGasUsed)).toString() : 'Unknown',
                'Estimated Gas Units': this.estimatedGasUnits.toString(),
                'Actual Gas Units Used': receipt ? this.actualGasUnits : 'Unknown',
                'Estimated transaction Cost': convertFromWei(this.estimatedTransactionCost, inputToken.decimals),
                'Actual Transaction Cost': receipt ? convertFromWei(this.actualTransactionCost, inputToken.decimals) : 'Unknown',
                '-': {},
                'ETH Balance Before': convertFromWei(ethBalanceBefore.toString(), inputToken.decimals),
                'ETH Balance After': convertFromWei(ethBalanceAfter.toString(), inputToken.decimals),
                '-': {},
                'Flash Loan Token Balance Before': convertFromWei(balanceBefore.toString(), outputToken.decimals),
                'Flash Loan Token Balance After': convertFromWei(balanceAfter.toString(), outputToken.decimals),
                '-': {},
                'Flash Loan Token Gained/Lost': convertFromWei(tokenGained, inputToken.decimals),
                'Net Profit': `${convertFromWei(this.actualNetProfit, inputToken.decimals)} ${inputToken.symbol}`,
                'Transaction Hash': receipt ? receipt.transactionHash : 'Unknown',
            };

            this.data = data;
            console.table(data);
        } finally {
            fs.writeFileSync('output/running.txt', 'false');
        }
    };

    uploadToBigQuery = async () => {
        this.insertTimestamp = new Date().toISOString();
        const outputString = JSON.stringify(this, (key, value) => {
            if (key == 'pairContract' || key == 'routerContract') {
                return undefined;
            }
            return value;
        });

        const output = JSON.parse(outputString);
        const rows = [];
        rows.push(output);
        // console.log(rows[0]);
        console.log('Uploading to BigQuery');
        const bigQuery = new BigQuery();
        const datasetId = settings.bqDataset;
        const tableId = settings.bqTable;

        // Load data into the table
        await bigQuery.dataset(datasetId).table(tableId).insert(rows);
        console.log(`Inserted ${rows.length} rows.`);
    };

    getExchangeWithBestPrice = (exchangeX, exchangeY, quoteToken) => {
        let exchangeXQuote;
        let exchangeYQuote;

        if (quoteToken == 0) {
            exchangeXQuote = this.calculatePrice(exchangeX.reserves.reserve1, exchangeX.reserves.reserve0);
            exchangeYQuote = this.calculatePrice(exchangeY.reserves.reserve1, exchangeY.reserves.reserve0);
        } else {
            exchangeXQuote = this.calculatePrice(exchangeX.reserves.reserve0, exchangeX.reserves.reserve1);

            exchangeYQuote = this.calculatePrice(exchangeY.reserves.reserve0, exchangeY.reserves.reserve1);
        }

        if (Big(exchangeXQuote).eq(Big(exchangeYQuote))) {
            throw new BalancedPoolsError(exchangeX, exchangeY);
        }

        return Big(exchangeXQuote).lt(Big(exchangeYQuote)) ? exchangeX : exchangeY;
    };

    getMostUnbalancedPool = (exchangeX, exchangeY) => {
        const exchangeXPriceRatioDistanceFrom1 = this.getPriceRatioDistanceFrom1(exchangeX.reserves.reserve0, exchangeX.reserves.reserve1);

        const exchangeYPriceRatioDistanceFrom1 = this.getPriceRatioDistanceFrom1(exchangeY.reserves.reserve0, exchangeY.reserves.reserve1);

        return Big(exchangeXPriceRatioDistanceFrom1).gt(Big(exchangeYPriceRatioDistanceFrom1)) ? exchangeX : exchangeY;
    };

    getPriceRatioDistanceFrom1 = (reserve0, reserve1) => {
        return Big(this.calculatePrice(reserve0, reserve1)).minus(Big(1)).abs().toString();
    };

    calculatePrice = (reserveNumerator, reserveDenominator) => {
        return Big(reserveNumerator).div(Big(reserveDenominator)).toString();
    };

    // Algebra formula for calculating the optimal amount to arbitrage from one liquidity pool to the other. Should balance out two pools to equal the same ratio price. (token0Reserves / token1Reserves)
    // input0 = Input token reserves for pool0. (The pool you are starting on in the arbitrage transaction).
    // output0 = Output token reserves for pool0. (The pool you are starting on in the arbitrage transaction).
    // input1 = Input token reserves for poo11. (The pool you are ending on in the arbitrage transaction).
    // output1 = Output token reserves for pool1. (The pool you are ending on in the arbitrage transaction).
    // k0 = input0 * output0
    // k1 = input1 * output1
    // x1 = (k1 * output0) + (k0 * input1) + output0 * (squareRoot(k0 * k1)) + input1 * (squareRoot(k0 * k1)) / k1 - k0
    // x1 = (k1 * output0) + (k0 * input1) - output0 * (squareRoot(k0 * k1)) - input1 * (squareRoot(k0 * k1)) / k1 - k0
    // Checks for the following:
    // - Both results being negative
    // - Both results being within a valid range
    // - Liquidity Constants equal the same. TODO - implement logic to handle the calculation when this occurs.
    // - Both results are equal to zero
    // - Both results being out of range - meaning that they are both greater than the output0 reserves
    calculateAmountToBuy = () => {
        Big.PE = 40;
        Big.RM = 0;
        const input0BN = Big(this.orderedReserves[0]);
        const output0BN = Big(this.orderedReserves[1]);
        const input1BN = Big(this.orderedReserves[2]);
        const output1BN = Big(this.orderedReserves[3]);
        const k0BN = input0BN.times(output0BN);
        const k1BN = input1BN.times(output1BN);
        const sqrtK0K1BN = k0BN.times(k1BN).sqrt();
        const x1Numerator = k1BN.times(output0BN).plus(k0BN.times(input1BN)).plus(output0BN.times(sqrtK0K1BN)).plus(input1BN.times(sqrtK0K1BN));
        const x2Numerator = k1BN.times(output0BN).plus(k0BN.times(input1BN)).minus(output0BN.times(sqrtK0K1BN)).minus(input1BN.times(sqrtK0K1BN));
        const denominator = k1BN.minus(k0BN);
        if (denominator.eq(Big(0))) {
            throw new K0IsEqualToK1Error('ERROR: k0 is equal to k1');
        }
        const x1 = x1Numerator.div(denominator);
        const x2 = x2Numerator.div(denominator);
        if (x1.lt(Big(0)) && x2.lt(Big(0))) {
            throw new NegativeAmountOutCalculationError(this.pool0, this.pool1, this.orderedReserves);
        }
        const x1InRange = x1.gt(Big(0)) && x1.lt(output0BN);
        const x2InRange = x2.gt(Big(0)) && x2.lt(output0BN);
        const x1IsZero = x1.eq(Big(0));
        const x2IsZero = x2.eq(Big(0));

        if (x1InRange && x2InRange) {
            throw new Error('Both numbers are in range. Not sure what to do lel...');
        }

        if (x1IsZero && x2IsZero) {
            throw new Error('Both numbers are zero. Not sure what to do lel...');
        }

        if (x1.gt(output0BN) && x2.gt(output0BN)) {
            throw new Error('Both numbers are greater than the output reserves of pool0. Not sure what to do lel...');
        }

        if (x1InRange) return x1.toFixed(0);
        if (x2InRange) return x2.toFixed(0);

        // If we get to this point in the calculation, then that means one number is negative and one number is zero.
        // Return the value that equals zero
        return x1IsZero ? x1.toFixed(0) : x2.toFixed(0);
    };

    calculateAmountToSpend = async () => {
        Big.PE = 40;
        return await this.pool0.exchange.routerContract.methods
            .getAmountIn(this.pool0.amountOut, this.orderedReserves[0], this.orderedReserves[1])
            .call();
    };

    calculateFinalAmountRecieved = async () => {
        Big.PE = 40;
        return await this.pool1.exchange.routerContract.methods
            .getAmountOut(this.pool1.amountIn, this.orderedReserves[2], this.orderedReserves[3])
            .call();
    };
}

class Pool {
    exchange = null;
    pairAddress = null;
    pairContract = null;
    token0 = null;
    token1 = null;
    reserve0 = null;
    reserve1 = null;
    ordered = null;
    amountIn = null;
    amountOut = null;

    constructor(exchange, pair, ordered) {
        this.exchange = new Exchange(exchange.name);
        this.pairAddress = exchange.pairAddress;
        this.pairContract = exchange.pairContract;
        this.token0 = new Token(pair.token0Symbol, pair.token0Decimals, pair.token0Address, pair.token0Lendable);
        this.token1 = new Token(pair.token1Symbol, pair.token1Decimals, pair.token1Address, pair.token1Lendable);
        this.reserve0 = exchange.reserves.reserve0;
        this.reserve1 = exchange.reserves.reserve1;
        this.ordered = ordered;
    }
}

class Token {
    symbol = null;
    decimals = null;
    address = null;
    lendable = null;

    constructor(symbol, decimals, address, lendable) {
        this.symbol = symbol;
        this.decimals = decimals;
        this.address = address;
        this.lendable = lendable;
    }
}

class Exchange {
    name = null;
    routerAddress = null;
    routerContract = null;

    constructor(name) {
        let exchange = exchangeContracts.filter((exchangeContract) => {
            return exchangeContract.name.toUpperCase() == name.toUpperCase();
        });
        this.name = name;
        this.routerAddress = exchange[0].routerContract._address;
        this.routerContract = exchange[0].routerContract;
    }
}
