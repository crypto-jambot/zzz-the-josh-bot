// SPDX-License-Identifier: UNLICENSED
pragma solidity <=0.8.10;

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IDODO {
    function flashLoan(
        uint256 baseAmount,
        uint256 quoteAmount,
        address assetTo,
        bytes calldata data
    ) external;

    function _BASE_TOKEN_() external view returns (address);
}

contract Arbitrage {
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "caller is not the owner!");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setOwner(address newOwner) onlyOwner public {
        owner = newOwner;
    }

    function executeTrade(
        address _flashLoanPool, //You will make a flashloan from this DODOV2 pool
        address _token0,
        address _token1,
        uint256 _tradeAmount,
        address _router0,
        address _router1
    ) external {
        uint256 balanceBefore = IERC20(_token0).balanceOf(address(this));
        
        // Note: The data can be structured with any variables required by your logic. The following code is just an example
        bytes memory data = abi.encode(
            _flashLoanPool,
            _token0,
            _token1,
            _tradeAmount,
            _router0,
            _router1,
            balanceBefore
        );

        address flashLoanBase = IDODO(_flashLoanPool)._BASE_TOKEN_();

        if (flashLoanBase == _token0) {
            IDODO(_flashLoanPool).flashLoan(_tradeAmount, 0, address(this), data);
        } else {
            IDODO(_flashLoanPool).flashLoan(0, _tradeAmount, address(this), data);
        }
    }

    // Note: CallBack function executed by DODOV2(DVM) flashLoan pool
    // Dodo Vending Machine Factory --> 0x79887f65f83bdf15Bcc8736b5e5BcDB48fb8fE13
    function DVMFlashLoanCall(
        address sender,
        uint256 baseAmount,
        uint256 quoteAmount,
        bytes calldata data
    ) external {
        _flashLoanCallBack(sender, baseAmount, quoteAmount, data);
    }

    // Note: CallBack function executed by DODOV2(DPP) flashLoan pool
    // Dodo Private Pool Factory --> 0xd24153244066F0afA9415563bFC7Ba248bfB7a51
    function DPPFlashLoanCall(
        address sender,
        uint256 baseAmount,
        uint256 quoteAmount,
        bytes calldata data
    ) external {
        _flashLoanCallBack(sender, baseAmount, quoteAmount, data);
    }

    function _flashLoanCallBack(
        address sender,
        uint256,
        uint256,
        bytes calldata data
    ) internal {
        (
            address flashLoanPool,
            address token0,
            address token1,
            uint256 tradeAmount,
            address router0,
            address router1,
            uint256 balanceBefore
        ) = abi.decode(data, (address, address, address, uint256, address, address, uint256));

        uint256 balanceAfter = IERC20(token0).balanceOf(address(this));
        require(
            balanceAfter - balanceBefore == tradeAmount,
            "flashloan failed."
        );

        require(
            sender == address(this) && msg.sender == flashLoanPool,
            "flashloan denied."
        );

        // Note: Realize your own logic using the token from flashLoan pool.
        address[] memory path = new address[](2);
        path[0] = token0;
        path[1] = token1;

        swap(path, tradeAmount, 0, router0);
        path[0] = token1;
        path[1] = token0;
        swap(
            path,
            IERC20(token1).balanceOf(address(this)),
            tradeAmount,
            router1
        );

        IERC20(token0).transfer(
            owner,
            IERC20(token0).balanceOf(address(this)) - tradeAmount
        );

        // Return funds
        IERC20(token0).transfer(flashLoanPool, tradeAmount);
    }

    function swap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _amountOut,
        address _router
    ) internal {
        IUniswapV2Router02 router = IUniswapV2Router02(_router);
        require(
            IERC20(_path[0]).approve(_router, _amountIn),
            "Router approval failed."
        );

        router.swapExactTokensForTokens(
            _amountIn,
            _amountOut,
            _path,
            address(this),
            (block.timestamp + 1200)
        );
    }
}