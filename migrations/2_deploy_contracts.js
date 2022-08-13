const Arbitrage = artifacts.require('Arbitrage');

module.exports = async function (deployer) {
    await deployer.deploy(Arbitrage);
};
