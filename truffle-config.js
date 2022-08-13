require('babel-register');
require('babel-polyfill');
const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
    networks: {
        development: {
            host: '127.0.0.1',
            port: 8545,
            network_id: '*', // Match any network id
        },
        mainnet: {
            provider: () =>
                new HDWalletProvider(process.env.META_MASK_MNEMONIC_PHRASE, `wss://mainnet.infura.io/ws/v3/5bada9e3ecf8457dba4a0dd12fa8bb03`),
            network_id: 1,
            gasPrice: 20000000000,
        },
        bsc: {
            provider: () => new HDWalletProvider('put in mnemonic here...', 'https://nd-702-884-701.p2pify.com/17c521a5a55bb46de0aee62d76b6ca5a'),
            network_id: 56,
            gasPrice: 5000000000,
        },
        polygon: {
            provider: () => new HDWalletProvider('put in mnemonic here...', 'wss://ws-nd-098-564-968.p2pify.com/4e267bf795c27e77369c881438fa2289'),
            network_id: 137,
            gasPrice: 50000000000,
        },
    },

    compilers: {
        solc: {
            version: '0.8.9',
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
};
