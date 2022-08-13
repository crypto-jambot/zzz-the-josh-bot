/*********************************************************************
 * Copyright (C) 2022 Joshua Sells joshuataylorsells@gmail.com
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 *
 * Proprietary and confidential
 *
 *********************************************************************/

import 'dotenv/config';
import Web3 from 'web3';
import eth_exchanges from '../config/ethereum_exchanges.json';
import bsc_exchanges from '../config/binance_smart_chain_exchanges.json';
import polygon_exchanges from '../config/polygon_exchanges.json';
import settings from '../config/settings.json';
import * as Constants from '../constants/constants';
import { createAlchemyWeb3 } from '@alch/alchemy-web3';
import IUniswapV2Router02 from '@uniswap/v2-periphery/build/IUniswapV2Router02.json';
import IUniswapV2Factory from '@uniswap/v2-core/build/IUniswapV2Factory.json';

let web3;
let account;
let dodoPool;
let exchanges;

// Web3 setup
if (!settings.isLocal) {
    account = process.env.META_MASK_ADDRESS;
    switch (settings.nodeProvider) {
        case Constants.ALCHEMY:
            web3 = createAlchemyWeb3(`${Constants.ALCHEMY_WRAPPER_ETH_ENDPOINT}${process.env.ALCHEMY_API_KEY}`, { maxRetries: 100 });
            break;
        case Constants.INFURA:
            web3 = new Web3(`${Constants.INFURA_ETH_ENDPOINT}${process.env.INFURA_API_KEY}`);
            break;
        case Constants.GET_BLOCK_BSC:
            web3 = new Web3(`${Constants.GET_BLOCK_BSC_ENDPOINT}${process.env.GET_BLOCK_API_KEY}`);
            break;
        case Constants.GET_BLOCK_POLYGON:
            web3 = new Web3(`${Constants.GET_BLOCK_POLYGON_ENDPOINT}${process.env.GET_BLOCK_API_KEY}`);
            break;
        case Constants.CHAINSTACK_BSC:
            web3 = new Web3(Constants.CHAINSTACK_BSC_ENDPOINT);
            break;
        case Constants.CHAINSTACK_POLYGON:
            web3 = new Web3(Constants.CHAINSTACK_POLYGON_ENDPOINT);
            break;
        case Constants.QUICKNODE_BSC:
            web3 = new Web3(Constants.QUICKNODE_BSC_ENDPOINT);
            break;
        case Constants.MORALIS_BSC:
            web3 = new Web3(Constants.MORALIS_BSC_ENDPOINT);
            break;
        default:
            web3 = new Web3(Constants.LOCALHOST_ETH_ENDPOINT);
    }
} else {
    web3 = new Web3(Constants.LOCALHOST_ETH_ENDPOINT);
    switch (settings.blockchain) {
        case Constants.ETHEREUM:
            account = process.env.GANACHE_ETH_TEST_ADDRESS;
            break;
        case Constants.BINANCE_SMART_CHAIN:
            account = process.env.GANACHE_BSC_TEST_ADDRESS;
            dodoPool = process.env.DODO_BSC_BNB_POOL;
            break;
        case Constants.POLYGON:
            account = process.env.GANACHE_POLYGON_TEST_ADDRESS;
            dodoPool = process.env.DODO_POLYGON_MATIC_POOL;
        default:
            account = process.env.GANACHE_ETH_TEST_ADDRESS;
    }
}

switch (settings.bqDataset) {
    case Constants.ETHEREUM:
        exchanges = eth_exchanges;
        break;
    case Constants.BINANCE_SMART_CHAIN:
        exchanges = bsc_exchanges;
        break;
    case Constants.POLYGON:
        exchanges = polygon_exchanges;
        break;
    default:
        exchanges = eth_exchanges;
}

export const exchangeContracts = exchanges.map((exchange) => {
    return {
        name: exchange.name,
        routerContract: new web3.eth.Contract(IUniswapV2Router02.abi, exchange.routerAddress),
        factoryContract: new web3.eth.Contract(IUniswapV2Factory.abi, exchange.factoryAddress),
    };
});

export { web3, account, dodoPool };
