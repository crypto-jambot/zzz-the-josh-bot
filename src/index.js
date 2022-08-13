/*********************************************************************
 * Copyright (C) 2022 Joshua Sells joshuataylorsells@gmail.com
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 *
 * Proprietary and confidential
 *
 *********************************************************************/

import 'dotenv/config';
import { generateListOfArbs, getAllReserves, getPairContracts, containsProfitableArb, getBestArb } from './util/util';
import settings from './config/settings.json';

export const main = async (pair) => {
    // Filter out null exchanges. (Exchanges where there isn't a pair for the specific tokens).
    pair.exchanges = pair.exchanges.filter((exchange) => {
        return exchange.pairAddress != null;
    });

    try {
        getPairContracts(pair);
        await getAllReserves(pair);
        const arbList = await generateListOfArbs(pair);
        if (!containsProfitableArb(arbList)) {
            // console.log(`No arb found for ${pair.token0Symbol} and ${pair.token1Symbol}`);
            return;
        }
        const bestArb = getBestArb(arbList);
        await bestArb.executeTrade();
        if (settings.uploadToBigQuery) {
            await bestArb.uploadToBigQuery();
        }
        return {
            data: bestArb.data,
            estimatedNetProfit: bestArb.estimatedNetProfit,
        };
    } catch (err) {
        console.log(err.message);
    }
};
