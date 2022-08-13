/*********************************************************************
 * Copyright (C) 2022 Joshua Sells joshuataylorsells@gmail.com
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 *
 * Proprietary and confidential
 *
 *********************************************************************/

export class BalancedPoolsError extends Error {
    constructor(exchangeX, exchangeY) {
        super();
        this.name = 'BALANCED_POOLS_ERROR';
        this.exchangeX = exchangeX;
        this.exchangeY = exchangeY;
    }
}

export class NegativeAmountOutCalculationError extends Error {
    constructor(pool0, pool1, orderedReserves) {
        super();
        this.name = 'NEGATIVE_AMOUNT_OUT_CALCULATION_ERROR';
        this.pool0 = pool0;
        this.pool1 = pool1;
        this.orderedReserves = orderedReserves;
    }
}

export class K0IsEqualToK1Error extends Error {
    constructor(message) {
        super(message);
        this.name = 'K0_IS_EQUAL_TO_K1_ERROR';
    }
}

export class ZeroAmountOutCalculationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ZERO_AMOUNT_OUT_CALCULATION_ERROR';
    }
}

export class ZeroAmountInCalculationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ZERO_AMOUNT_IN_CALCULATION_ERROR';
    }
}

export class FailureToEstimateGas extends Error {
    constructor(message) {
        super(message);
        this.name = "COULDN'T_ESTIMATE_GAS";
    }
}
