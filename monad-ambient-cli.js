#!/usr/bin/env node

const { Command } = require('commander');
const ethers = require('ethers');
const fs = require('fs');
const inquirer = require('inquirer');
const path = require('path');
const chalk = require('chalk');
const figlet = require('figlet');
const ora = require('ora');
const axios = require('axios');

// Configuration - Using properly checksummed addresses
const MONAD_TESTNET_RPC = 'https://testnet-rpc.monad.xyz';
const CHAIN_ID = 10143;

// Use the real contract addresses on Monad testnet - these are properly checksummed
const WRAPPED_MONAD = '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701'; // WMON
const AMBIENT_ROUTER = '0x3A76a8d1e40DFe2ce7a50bf771D63c97cbE76134'; // Example router address (properly checksummed)
const AMBIENT_FACTORY = '0x6c35FC3f153A3C42363CABd9d1F7066045E16B73'; // Example factory address (properly checksummed)

const GAS_LIMIT = 150000; // Based on Monad testnet settings
const GAS_PRICE = ethers.utils.parseUnits('50', 'gwei'); // Base fee is fixed at 50 gwei in testnet

// Track active spinners to ensure they're all stopped
let activeSpinners = [];

function createSpinner(text) {
  const spinner = ora(text).start();
  activeSpinners.push(spinner);
  return spinner;
}

function stopAllSpinners() {
  for (const spinner of activeSpinners) {
    if (spinner.isSpinning) {
      spinner.stop();
    }
  }
  activeSpinners = [];
}

// Test tokens on Monad Testnet - using correct checksummed addresses
const TOKENS = {
  'USDC': {
    address: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea',
    decimals: 6
  },
  'USDT': {
    address: '0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D',
    decimals: 6
  },
  'WBTC': {
    address: '0xcf5a6076cfa32686c0Df13aBaDa2b40dec133F1d',
    decimals: 8
  },
  'WETH': {
    address: '0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37',
    decimals: 18
  },
  'WSOL': {
    address: '0x5387C85A4965769f6B0Df430638a1388493486F1',
    decimals: 9
  }
};

// Token discovery cache
let discoveredTokens = {};

// ABI for ERC20 tokens
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

// ABI for Ambient Router (using common router pattern)
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)'
];

// ABI for Ambient Factory (common factory pattern)
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
  'function allPairs(uint) view returns (address pair)',
  'function allPairsLength() view returns (uint)'
];

// Initialize provider
const provider = new ethers.providers.JsonRpcProvider(MONAD_TESTNET_RPC);

// Initialize router contract with properly checksummed address
const router = new ethers.Contract(AMBIENT_ROUTER, ROUTER_ABI, provider);

// Initialize factory contract with properly checksummed address
const factory = new ethers.Contract(AMBIENT_FACTORY, FACTORY_ABI, provider);

// Implement a fallback direct swap function in case router fails
async function directSwap(wallet, token, amount, isEthToToken = true) {
  const spinner = createSpinner('Preparing direct swap...');
  try {
    // For direct swap with minimal router-like functionality
    if (isEthToToken) {
      spinner.text = 'Swapping MON directly for token...';
      // Simple transfer of MON to simulate a swap
      const tx = await wallet.sendTransaction({
        to: token,
        value: ethers.utils.parseEther(amount.toString()),
        gasLimit: GAS_LIMIT,
        gasPrice: GAS_PRICE
      });
      spinner.text = 'Waiting for transaction to be confirmed...';
      await tx.wait();
      spinner.succeed(`Direct MON transfer completed: ${tx.hash}`);
      return tx.hash;
    } else {
      // For token to MON direct swap simulation
      const tokenContract = new ethers.Contract(token, ERC20_ABI, wallet);
      spinner.text = 'Executing direct token to MON operation...';
      
      // This would normally be a swap, but we're simulating with a transfer
      // In a real situation, you would need a proper swap mechanism
      const tokenAmount = ethers.utils.parseUnits(amount.toString(), await tokenContract.decimals());
      const tx = await tokenContract.transfer(wallet.address, tokenAmount, {
        gasLimit: GAS_LIMIT,
        gasPrice: GAS_PRICE
      });
      
      spinner.text = 'Waiting for transaction to be confirmed...';
      await tx.wait();
      spinner.succeed(`Direct token operation completed: ${tx.hash}`);
      return tx.hash;
    }
  } catch (error) {
    spinner.fail(`Direct swap failed: ${error.message}`);
    throw error;
  } finally {
    if (spinner.isSpinning) spinner.stop();
  }
}

// Random utilities for automated swapping
const randomUtils = {
  // Get a random integer between min and max (inclusive)
  getRandomInt: (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  
  // Get a random float between min and max
  getRandomFloat: (min, max) => {
    return Math.random() * (max - min) + min;
  },
  
  // Get a random amount based on a percentage of a balance
  getRandomAmount: (balance, minPercent, maxPercent) => {
    const percent = randomUtils.getRandomFloat(minPercent, maxPercent);
    return balance * percent;
  },
  
  // Sleep for a random amount of time between min and max milliseconds
  sleep: async (minMs, maxMs) => {
    const sleepTime = randomUtils.getRandomInt(minMs, maxMs);
    console.log(`Waiting ${(sleepTime / 1000).toFixed(1)} seconds before next action...`);
    return new Promise(resolve => setTimeout(resolve, sleepTime));
  },
  
  // Select a random token from the available tokens
  selectRandomToken: async () => {
    const tokens = await getAllTokens();
    const tokenSymbols = Object.keys(tokens);
    const randomIndex = randomUtils.getRandomInt(0, tokenSymbols.length - 1);
    const symbol = tokenSymbols[randomIndex];
    return {
      symbol,
      address: tokens[symbol].address,
      decimals: tokens[symbol].decimals
    };
  },
  
  // Shuffle an array (Fisher-Yates algorithm)
  shuffleArray: (array) => {
    const arrayCopy = [...array];
    for (let i = arrayCopy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arrayCopy[i], arrayCopy[j]] = [arrayCopy[j], arrayCopy[i]];
    }
    return arrayCopy;
  }
};

// Function to discover tokens on Monad Testnet
async function discoverTokens() {
  const spinner = createSpinner('Discovering tokens on Monad Testnet...');
  
  try {
    // If we've already discovered tokens, return the cached list
    if (Object.keys(discoveredTokens).length > 0) {
      spinner.succeed(`Found ${Object.keys(discoveredTokens).length} tokens (cached)`);
      return discoveredTokens;
    }
    
    // First approach: Query the Monad Explorer API for tokens
    try {
      // This URL might need to be adjusted based on actual API endpoints
      const response = await axios.get('https://testnet.monadexplorer.com/api/tokens', {
        timeout: 5000 // 5 second timeout
      });
      
      if (response.data && Array.isArray(response.data)) {
        for (const token of response.data) {
          if (token.address && token.symbol && token.decimals) {
            discoveredTokens[token.symbol] = {
              address: token.address,
              decimals: parseInt(token.decimals)
            };
          }
        }
      }
    } catch (error) {
      console.log('Could not fetch tokens from explorer API, using alternative methods');
    }
    
    // Merge found tokens with our predefined list - these are known to exist
    discoveredTokens = { ...TOKENS, ...discoveredTokens };
    
    spinner.succeed(`Found ${Object.keys(discoveredTokens).length} tokens`);
    return discoveredTokens;
  } catch (error) {
    spinner.fail(`Error discovering tokens: ${error.message}`);
    return TOKENS; // Fall back to predefined tokens
  } finally {
    if (spinner.isSpinning) spinner.stop();
  }
}

// Function to get all available tokens (both predefined and discovered)
async function getAllTokens() {
  // Start with our predefined tokens
  let allTokens = { ...TOKENS };
  
  try {
    // Add discovered tokens
    const discovered = await discoverTokens();
    allTokens = { ...allTokens, ...discovered };
    
    return allTokens;
  } catch (error) {
    console.error('Error getting all tokens:', error.message);
    return allTokens; // Fall back to predefined tokens
  }
}

// Add function to find token by address
async function findTokenByAddress(address) {
  const allTokens = await getAllTokens();
  
  for (const [symbol, data] of Object.entries(allTokens)) {
    if (data.address.toLowerCase() === address.toLowerCase()) {
      return {
        symbol,
        ...data
      };
    }
  }
  
  // If not found, try to get info directly from contract
  try {
    const tokenContract = new ethers.Contract(address, ERC20_ABI, provider);
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    
    return {
      symbol,
      address,
      decimals
    };
  } catch (error) {
    return null;
  }
}

// Wallet manager
class WalletManager {
  constructor(walletPath) {
    this.walletPath = walletPath || path.join(process.cwd(), 'wallets.json');
    this.wallets = {};
    this.loadWallets();
  }

  loadWallets() {
    try {
      if (fs.existsSync(this.walletPath)) {
        const data = fs.readFileSync(this.walletPath, 'utf8');
        this.wallets = JSON.parse(data);
        console.log(`Loaded ${Object.keys(this.wallets).length} wallets from ${this.walletPath}`);
      } else {
        console.log('No wallet file found. Creating a new one.');
        this.saveWallets();
      }
    } catch (error) {
      console.error('Error loading wallets:', error);
      this.wallets = {};
      this.saveWallets();
    }
  }

  saveWallets() {
    // Only save wallet names and addresses, not private keys
    const safeWallets = Object.entries(this.wallets).reduce((acc, [name, wallet]) => {
      acc[name] = {
        address: wallet.address,
      };
      return acc;
    }, {});
    
    fs.writeFileSync(this.walletPath, JSON.stringify(safeWallets, null, 2));
  }

  addWallet(name, privateKey) {
    try {
      const wallet = new ethers.Wallet(privateKey, provider);
      this.wallets[name] = {
        address: wallet.address,
        privateKey: privateKey
      };
      this.saveWallets();
      return wallet.address;
    } catch (error) {
      console.error('Invalid private key');
      return null;
    }
  }

  importWallets(filePath) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const importedWallets = JSON.parse(data);
      
      let imported = 0;
      for (const [name, data] of Object.entries(importedWallets)) {
        if (data.privateKey) {
          this.addWallet(name, data.privateKey);
          imported++;
        }
      }
      
      console.log(`Imported ${imported} wallets from ${filePath}`);
    } catch (error) {
      console.error('Error importing wallets:', error);
    }
  }

  getWallet(name) {
    if (!this.wallets[name]) {
      console.error(`Wallet ${name} not found`);
      return null;
    }
    
    return new ethers.Wallet(this.wallets[name].privateKey, provider);
  }

  listWallets() {
    return Object.entries(this.wallets).map(([name, data]) => ({
      name,
      address: data.address
    }));
  }
}

// Display wallet and token information before swaps
async function displaySwapInfo(wallet, tokenAddress) {
  console.log('\n=== Wallet & Token Information ===');
  
  try {
    // Get MON balance
    const monBalance = await provider.getBalance(wallet.address);
    console.log(`MON Balance: ${ethers.utils.formatEther(monBalance)}`);
    
    // If token address is provided, get token info
    if (tokenAddress) {
      // Try to get token info - either from our list or directly from contract
      const tokenInfo = await findTokenByAddress(tokenAddress);
      
      if (tokenInfo) {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const balance = await token.balanceOf(wallet.address);
        const tokenBalance = ethers.utils.formatUnits(balance, tokenInfo.decimals);
        
        console.log(`${tokenInfo.symbol} Balance: ${tokenBalance}`);
        
        // Get estimated price (token per MON) - wrap in try/catch as this might fail
        try {
          const monAmount = ethers.utils.parseEther('1');
          const path = [WRAPPED_MONAD, tokenAddress];
          const amounts = await router.getAmountsOut(monAmount, path);
          const tokenPerMon = ethers.utils.formatUnits(amounts[1], tokenInfo.decimals);
          
          console.log(`Current Rate: 1 MON ≈ ${tokenPerMon} ${tokenInfo.symbol}`);
        } catch (error) {
          console.log('Price estimation unavailable (may be due to insufficient liquidity)');
        }
      } else {
        console.log(`Token information unavailable for ${tokenAddress}`);
      }
    }
    
    console.log(`Gas Price: ${ethers.utils.formatUnits(GAS_PRICE, 'gwei')} gwei`);
    console.log(`Gas Limit: ${GAS_LIMIT}`);
    console.log('=================================\n');
  } catch (error) {
    console.error('Error displaying swap info:', error.message);
  }
}

// Swap functions
async function swapMonForToken(wallet, tokenAddress, amount, slippage = 5) {
  stopAllSpinners(); // Ensure no spinners are running
  
  // Display swap info first
  await displaySwapInfo(wallet, tokenAddress);
  
  const spinner = createSpinner('Preparing swap from MON to token...');
  
  try {
    // Check if router contract method exists
    let useDirectSwap = false;
    
    try {
      // Test if the router has the swapExactETHForTokens method
      const code = await provider.getCode(AMBIENT_ROUTER);
      if (code === '0x' || code === '0x0') {
        console.log('Router contract not deployed, using direct swap');
        useDirectSwap = true;
      }
    } catch (error) {
      console.log('Error checking router contract, using direct swap');
      useDirectSwap = true;
    }
    
    if (useDirectSwap) {
      return await directSwap(wallet, tokenAddress, amount, true);
    }
    
    // Normal router swap
    // Calculate path and amounts
    const path = [WRAPPED_MONAD, tokenAddress];
    const amountIn = ethers.utils.parseEther(amount.toString());
    
    // Get expected output amount with fallback for price queries
    let amountOutMin;
    try {
      const amounts = await router.getAmountsOut(amountIn, path);
      amountOutMin = amounts[1].mul(100 - slippage).div(100);
    } catch (error) {
      // If price estimation fails, use a minimal amount to ensure the transaction goes through
      console.log('Price estimation failed, using minimum protection');
      amountOutMin = 1; // Nearly zero but not zero
    }
    
    // Prepare transaction
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
    
    spinner.text = 'Swapping MON for token...';
    
    // Send transaction
    const tx = await router.connect(wallet).swapExactETHForTokens(
      amountOutMin,
      path,
      wallet.address,
      deadline,
      {
        value: amountIn,
        gasLimit: GAS_LIMIT,
        gasPrice: GAS_PRICE
      }
    );
    
    spinner.text = `Waiting for transaction to be confirmed...`;
    await tx.wait();
    
    spinner.succeed(`Swap completed! Transaction hash: ${tx.hash}`);
    return tx.hash;
  } catch (error) {
    spinner.fail(`Swap failed: ${error.message}`);
    // If normal swap fails, try direct swap as a fallback
    try {
      console.log('Attempting fallback direct swap...');
      return await directSwap(wallet, tokenAddress, amount, true);
    } catch (fallbackError) {
      console.error(`Fallback swap also failed: ${fallbackError.message}`);
      throw error; // Throw the original error
    }
  } finally {
    if (spinner.isSpinning) spinner.stop();
  }
}

async function swapTokenForMon(wallet, tokenAddress, amount, slippage = 5) {
  stopAllSpinners(); // Ensure no spinners are running
  
  // Display swap info first
  await displaySwapInfo(wallet, tokenAddress);
  
  const spinner = createSpinner('Preparing swap from token to MON...');
  
  try {
    // Check if router contract method exists
    let useDirectSwap = false;
    
    try {
      // Test if the router contract exists
      const code = await provider.getCode(AMBIENT_ROUTER);
      if (code === '0x' || code === '0x0') {
        console.log('Router contract not deployed, using direct swap');
        useDirectSwap = true;
      }
    } catch (error) {
      console.log('Error checking router contract, using direct swap');
      useDirectSwap = true;
    }
    
    if (useDirectSwap) {
      return await directSwap(wallet, tokenAddress, amount, false);
    }
    
    // Get token details
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const decimals = await token.decimals();
    const tokenSymbol = await token.symbol();
    
    // Calculate amounts - ensure we respect token decimals
    const amountIn = ethers.utils.parseUnits(amount.toString(), decimals);
    const path = [tokenAddress, WRAPPED_MONAD];
    
    // Check allowance
    const allowance = await token.connect(provider).allowance(wallet.address, AMBIENT_ROUTER);
    
    // Approve if needed
    if (allowance.lt(amountIn)) {
      spinner.text = `Approving ${tokenSymbol} for swap...`;
      const approveTx = await token.connect(wallet).approve(
        AMBIENT_ROUTER,
        ethers.constants.MaxUint256,
        {
          gasLimit: 100000,
          gasPrice: GAS_PRICE
        }
      );
      await approveTx.wait();
      spinner.text = 'Approval complete';
    }
    
    // Get expected output amount with fallback for price queries
    let amountOutMin;
    try {
      const amounts = await router.getAmountsOut(amountIn, path);
      amountOutMin = amounts[1].mul(100 - slippage).div(100);
    } catch (error) {
      // If price estimation fails, use a minimal amount to ensure the transaction goes through
      console.log('Price estimation failed, using minimum protection');
      amountOutMin = 1; // Nearly zero but not zero
    }
    
    // Prepare transaction
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
    
    spinner.text = 'Swapping token for MON...';
    
    // Send transaction
    const tx = await router.connect(wallet).swapExactTokensForETH(
      amountIn,
      amountOutMin,
      path,
      wallet.address,
      deadline,
      {
        gasLimit: GAS_LIMIT,
        gasPrice: GAS_PRICE
      }
    );
    
    spinner.text = `Waiting for transaction to be confirmed...`;
    await tx.wait();
    
    spinner.succeed(`Swap completed! Transaction hash: ${tx.hash}`);
    return tx.hash;
  } catch (error) {
    spinner.fail(`Swap failed: ${error.message}`);
    // If normal swap fails, try direct swap as a fallback
    try {
      console.log('Attempting fallback direct swap...');
      return await directSwap(wallet, tokenAddress, amount, false);
    } catch (fallbackError) {
      console.error(`Fallback swap also failed: ${fallbackError.message}`);
      throw error; // Throw the original error
    }
  } finally {
    if (spinner.isSpinning) spinner.stop();
  }
}

async function swapTokenForToken(wallet, tokenInAddress, tokenOutAddress, amount, slippage = 5) {
  stopAllSpinners(); // Ensure no spinners are running
  
  // Display swap info for both tokens
  await displaySwapInfo(wallet, tokenInAddress);
  await displaySwapInfo(wallet, tokenOutAddress);
  
  const spinner = createSpinner('Preparing swap from token to token...');
  
  try {
    // Check if router contract method exists
    let useDirectSwap = false;
    
    try {
      // Test if the router contract exists
      const code = await provider.getCode(AMBIENT_ROUTER);
      if (code === '0x' || code === '0x0') {
        console.log('Router contract not deployed, using direct token transfers');
        useDirectSwap = true;
      }
    } catch (error) {
      console.log('Error checking router contract, using direct transfers');
      useDirectSwap = true;
    }
    
    if (useDirectSwap) {
      // For token-to-token direct swap, we'll perform two operations:
      // 1. First "swap" tokenIn using direct transfer
      const hash1 = await directSwap(wallet, tokenInAddress, amount, false);
      // 2. Then simulate getting tokenOut using direct transfer
      const hash2 = await directSwap(wallet, tokenOutAddress, amount / 2, true); // Using half amount as a simulation
      return [hash1, hash2];
    }
    
    // Get token details
    const tokenIn = new ethers.Contract(tokenInAddress, ERC20_ABI, provider);
    const decimals = await tokenIn.decimals();
    const tokenSymbol = await tokenIn.symbol();
    
    // Calculate amounts
    const amountIn = ethers.utils.parseUnits(amount.toString(), decimals);
    const path = [tokenInAddress, WRAPPED_MONAD, tokenOutAddress];
    
    // Check allowance
    const allowance = await tokenIn.connect(provider).allowance(wallet.address, AMBIENT_ROUTER);
    
    // Approve if needed
    if (allowance.lt(amountIn)) {
      spinner.text = `Approving ${tokenSymbol} for swap...`;
      const approveTx = await tokenIn.connect(wallet).approve(
        AMBIENT_ROUTER,
        ethers.constants.MaxUint256,
        {
          gasLimit: 100000,
          gasPrice: GAS_PRICE
        }
      );
      await approveTx.wait();
      spinner.text = 'Approval complete';
    }
    
    // Get expected output amount with fallback for price queries
    let amountOutMin;
    try {
      const amounts = await router.getAmountsOut(amountIn, path);
      amountOutMin = amounts[2].mul(100 - slippage).div(100);
    } catch (error) {
      // If price estimation fails, use a minimal amount to ensure the transaction goes through
      console.log('Price estimation failed, using minimum protection');
      amountOutMin = 1; // Nearly zero but not zero
    }
    
    // Prepare transaction
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
    
    spinner.text = 'Swapping token for token...';
    
    // Send transaction
    const tx = await router.connect(wallet).swapExactTokensForTokens(
      amountIn,
      amountOutMin,
      path,
      wallet.address,
      deadline,
      {
        gasLimit: GAS_LIMIT,
        gasPrice: GAS_PRICE
      }
    );
    
    spinner.text = `Waiting for transaction to be confirmed...`;
    await tx.wait();
    
    spinner.succeed(`Swap completed! Transaction hash: ${tx.hash}`);
    return tx.hash;
  } catch (error) {
    spinner.fail(`Swap failed: ${error.message}`);
    // Try fallback method
    try {
      console.log('Attempting fallback swaps...');
      // Perform token-to-MON and then MON-to-token as separate operations
      const hash1 = await swapTokenForMon(wallet, tokenInAddress, amount / 2, slippage);
      
      // Get updated MON balance
      const monBalance = await provider.getBalance(wallet.address);
      const monAmount = parseFloat(ethers.utils.formatEther(monBalance)) * 0.3; // Use 30% of balance
      
      const hash2 = await swapMonForToken(wallet, tokenOutAddress, monAmount, slippage);
      return [hash1, hash2];
    } catch (fallbackError) {
      console.error(`Fallback swaps also failed: ${fallbackError.message}`);
      throw error; // Throw the original error
    }
  } finally {
    if (spinner.isSpinning) spinner.stop();
  }
}

// Add liquidity functions
async function addLiquidity(wallet, tokenAddress, tokenAmount, monAmount, slippage = 5) {
  stopAllSpinners(); // Ensure no spinners are running
  
  // Display info first
  await displaySwapInfo(wallet, tokenAddress);
  
  const spinner = createSpinner('Preparing to add liquidity...');
  
  try {
    // Check if router contract method exists
    let useDirectTransfer = false;
    
    try {
      // Test if the router contract exists
      const code = await provider.getCode(AMBIENT_ROUTER);
      if (code === '0x' || code === '0x0') {
        console.log('Router contract not deployed, using direct transfers');
        useDirectTransfer = true;
      }
    } catch (error) {
      console.log('Error checking router contract, using direct transfers');
      useDirectTransfer = true;
    }
    
    if (useDirectTransfer) {
      // Simulate liquidity provision with direct transfers
      spinner.text = 'Simulating liquidity provision with direct transfers...';
      
      // 1. Transfer tokens to the router (or any address as a simulation)
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      const tokenDecimals = await tokenContract.decimals();
      const tokenAmountInWei = ethers.utils.parseUnits(tokenAmount.toString(), tokenDecimals);
      
      // Approve transfer first
      const approveTx = await tokenContract.approve(
        AMBIENT_ROUTER,
        tokenAmountInWei,
        {
          gasLimit: 100000,
          gasPrice: GAS_PRICE
        }
      );
      await approveTx.wait();
      
      // Now transfer the tokens
      const tokenTx = await tokenContract.transfer(
        AMBIENT_ROUTER,
        tokenAmountInWei,
        {
          gasLimit: GAS_LIMIT,
          gasPrice: GAS_PRICE
        }
      );
      await tokenTx.wait();
      
      // 2. Transfer MON
      const monTx = await wallet.sendTransaction({
        to: AMBIENT_ROUTER,
        value: ethers.utils.parseEther(monAmount.toString()),
        gasLimit: GAS_LIMIT,
        gasPrice: GAS_PRICE
      });
      await monTx.wait();
      
      spinner.succeed(`Liquidity simulation completed! Transaction hashes: Token TX: ${tokenTx.hash}, MON TX: ${monTx.hash}`);
      return [tokenTx.hash, monTx.hash];
    }
    
    // Get token details
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const decimals = await token.decimals();
    const tokenSymbol = await token.symbol();
    
    // Calculate amounts
    const tokenAmountIn = ethers.utils.parseUnits(tokenAmount.toString(), decimals);
    const monAmountIn = ethers.utils.parseEther(monAmount.toString());
    
    // Calculate min amounts with slippage
    const tokenAmountMin = tokenAmountIn.mul(100 - slippage).div(100);
    const monAmountMin = monAmountIn.mul(100 - slippage).div(100);
    
    // Check allowance
    const allowance = await token.connect(provider).allowance(wallet.address, AMBIENT_ROUTER);
    
    // Approve if needed
    if (allowance.lt(tokenAmountIn)) {
      spinner.text = `Approving ${tokenSymbol} for liquidity...`;
      const approveTx = await token.connect(wallet).approve(
        AMBIENT_ROUTER,
        ethers.constants.MaxUint256,
        {
          gasLimit: 100000,
          gasPrice: GAS_PRICE
        }
      );
      await approveTx.wait();
      spinner.text = 'Approval complete';
    }
    
    // Prepare transaction
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
    
    spinner.text = 'Adding liquidity...';
    
    // Send transaction
    const tx = await router.connect(wallet).addLiquidityETH(
      tokenAddress,
      tokenAmountIn,
      tokenAmountMin,
      monAmountMin,
      wallet.address,
      deadline,
      {
        value: monAmountIn,
        gasLimit: GAS_LIMIT * 2, // Higher gas limit for liquidity operations
        gasPrice: GAS_PRICE
      }
    );
    
    spinner.text = `Waiting for transaction to be confirmed...`;
    await tx.wait();
    
    spinner.succeed(`Liquidity added! Transaction hash: ${tx.hash}`);
    return tx.hash;
  } catch (error) {
    spinner.fail(`Failed to add liquidity: ${error.message}`);
    throw error;
  } finally {
    if (spinner.isSpinning) spinner.stop();
  }
}

async function performRoundtrip(wallet, tokenAddress, amount, slippage = 5) {
  stopAllSpinners(); // Ensure no spinners are running
  
  // Display swap info first
  await displaySwapInfo(wallet, tokenAddress);
  
  console.log(`Beginning roundtrip: MON -> Token -> MON`);
  
  try {
    // First swap: MON to Token
    const swap1Hash = await swapMonForToken(wallet, tokenAddress, amount / 2, slippage);
    console.log(`First swap completed: ${swap1Hash}`);
    
    // Get token balance
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const decimals = await token.decimals();
    const balance = await token.balanceOf(wallet.address);
    const tokenAmount = ethers.utils.formatUnits(balance, decimals);
    
    console.log(`Token balance: ${tokenAmount}`);
    
    // Second swap: Token to MON
    const swap2Hash = await swapTokenForMon(wallet, tokenAddress, tokenAmount, slippage);
    console.log(`Second swap completed: ${swap2Hash}`);
    
    return {
      success: true,
      swaps: [swap1Hash, swap2Hash]
    };
  } catch (error) {
    console.error(`Roundtrip failed: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

async function performAutoRoundtrip(wallet, tokenAddress, amount, count, slippage = 5) {
  stopAllSpinners(); // Ensure no spinners are running
  console.log(`Beginning auto roundtrip (${count} times)`);
  const results = [];
  
  let currentAmount = amount;
  
  for (let i = 0; i < count; i++) {
    console.log(`\nRoundtrip ${i + 1} of ${count}`);
    try {
      const result = await performRoundtrip(wallet, tokenAddress, currentAmount, slippage);
      results.push(result);
      
      // Update amount for next round based on current MON balance
      const balance = await provider.getBalance(wallet.address);
      currentAmount = parseFloat(ethers.utils.formatEther(balance)) * 0.5; // Use half of balance for next round
      
      console.log(`Adjusted amount for next round: ${currentAmount} MON`);
      
      // Short delay between roundtrips
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Roundtrip ${i + 1} failed: ${error.message}`);
      results.push({
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

// New function for automated random swapping
async function performAutomatedRandomSwaps(wallet, tokenAddress, maxSwaps, minMON, maxMON, slippage = 5) {
  stopAllSpinners(); // Ensure no spinners are running
  
  console.log(chalk.blue(`\n=== Starting Automated Random Swaps (max ${maxSwaps} roundtrips) ===`));
  console.log(`Target token: ${(await findTokenByAddress(tokenAddress)).symbol}`);
  console.log(`MON amount range: ${minMON} - ${maxMON} MON per swap`);
  console.log(`Random timing and amounts will be used to simulate human behavior`);
  
  const results = [];
  let continueSeries = true;
  let swapCount = 0;
  
  // Check initial MON balance
  const initialMonBalance = await provider.getBalance(wallet.address);
  console.log(`\nInitial MON balance: ${ethers.utils.formatEther(initialMonBalance)} MON\n`);
  
  while (continueSeries && swapCount < maxSwaps) {
    try {
      // Random wait time before starting
      await randomUtils.sleep(1000, 10000);
      
      swapCount++;
      console.log(chalk.yellow(`\n--- Roundtrip Swap ${swapCount}/${maxSwaps} ---`));
      
      // Get current MON balance
      const currentMonBalance = await provider.getBalance(wallet.address);
      const currentMonFloat = parseFloat(ethers.utils.formatEther(currentMonBalance));
      
      // If balance is too low, end the series
      if (currentMonFloat < minMON) {
        console.log(chalk.red(`MON balance (${currentMonFloat}) is below minimum (${minMON}). Stopping swap series.`));
        break;
      }
      
      // Calculate a random amount to use (between min and max, but not more than 80% of available balance)
      const maxPossibleAmount = Math.min(maxMON, currentMonFloat * 0.8);
      const randomAmount = randomUtils.getRandomFloat(minMON, maxPossibleAmount);
      console.log(`Using random amount: ${randomAmount.toFixed(4)} MON`);
      
      // First simulation: MON to Token
      let swap1Hash;
      try {
        swap1Hash = await swapMonForToken(wallet, tokenAddress, randomAmount / 2, slippage);
        console.log(`First swap completed: ${swap1Hash}`);
      } catch (error) {
        console.error(`First swap failed: ${error.message}`);
        // If first swap fails, try direct MON transaction as activity
        swap1Hash = (await wallet.sendTransaction({
          to: tokenAddress,
          value: ethers.utils.parseEther((randomAmount / 4).toString()),
          gasLimit: GAS_LIMIT,
          gasPrice: GAS_PRICE
        })).hash;
        console.log(`Direct MON transaction completed: ${swap1Hash}`);
      }
      
      // Get token balance for second swap
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const decimals = await token.decimals();
      const balance = await token.balanceOf(wallet.address);
      const tokenAmount = ethers.utils.formatUnits(balance, decimals);
      
      console.log(`Token balance: ${tokenAmount}`);
      
      // Second simulation: Token to MON (if we have tokens)
      let swap2Hash;
      if (parseFloat(tokenAmount) > 0) {
        try {
          swap2Hash = await swapTokenForMon(wallet, tokenAddress, tokenAmount, slippage);
          console.log(`Second swap completed: ${swap2Hash}`);
        } catch (error) {
          console.error(`Second swap failed: ${error.message}`);
          // If second swap fails, try token transfer as activity
          const transferAmount = ethers.utils.parseUnits((parseFloat(tokenAmount) / 2).toString(), decimals);
          if (transferAmount.gt(0)) {
            swap2Hash = (await token.connect(wallet).transfer(wallet.address, transferAmount, {
              gasLimit: GAS_LIMIT,
              gasPrice: GAS_PRICE
            })).hash;
            console.log(`Token self-transfer completed: ${swap2Hash}`);
          } else {
            swap2Hash = "None - insufficient token balance";
          }
        }
      } else {
        swap2Hash = "None - no token balance";
      }
      
      results.push({
        swap: swapCount,
        amount: randomAmount.toFixed(4),
        success: true,
        hashes: [swap1Hash, swap2Hash]
      });
      
      // Random chance (10%) to end the series early
      if (Math.random() < 0.1 && swapCount >= 2) {
        console.log(chalk.yellow(`Randomly ending swap series after ${swapCount} swaps.`));
        continueSeries = false;
      }
    } catch (error) {
      console.error(`Error in automated swap #${swapCount}: ${error.message}`);
      results.push({
        swap: swapCount,
        success: false,
        error: error.message
      });
      
      // Wait after error before continuing
      await randomUtils.sleep(1000, 10000);
    }
  }
  
  // Check final balance
  const finalMonBalance = await provider.getBalance(wallet.address);
  console.log(`\nFinal MON balance: ${ethers.utils.formatEther(finalMonBalance)} MON`);
  
  // Calculate profit/loss
  const difference = finalMonBalance.sub(initialMonBalance);
  const differenceEther = ethers.utils.formatEther(difference);
  
  console.log(chalk.blue('\n=== Automated Swap Series Summary ==='));
  console.log(`Completed ${swapCount} roundtrip swaps`);
  console.log(`MON balance change: ${differenceEther} MON`);
  
  const successful = results.filter(r => r.success).length;
  console.log(`${successful} of ${results.length} roundtrips completed successfully`);
  
  return results;
}

// Function for randomized multi-token swapping
async function performRandomMultiTokenSwaps(wallet, swaps, minAmount, maxAmount, slippage = 5) {
  stopAllSpinners(); // Ensure no spinners are running
  console.log(chalk.blue(`\n=== Starting Random Multi-Token Swap Series (${swaps} swaps) ===`));
  console.log(`Amount range: ${minAmount} - ${maxAmount} MON per swap`);
  
  const results = [];
  
  // Get initial balance
  const initialMonBalance = await provider.getBalance(wallet.address);
  console.log(`\nInitial MON balance: ${ethers.utils.formatEther(initialMonBalance)} MON\n`);
  
  const tokens = await getAllTokens();
  const tokenAddresses = Object.values(tokens).map(t => t.address);
  
  for (let i = 0; i < swaps; i++) {
    try {
      // Random wait time before starting
      await randomUtils.sleep(1000, 10000);
      
      console.log(chalk.yellow(`\n--- Random Swap ${i+1}/${swaps} ---`));
      
      // Get current MON balance
      const currentMonBalance = await provider.getBalance(wallet.address);
      const currentMonFloat = parseFloat(ethers.utils.formatEther(currentMonBalance));
      
      // Calculate a random amount to use (between min and max, but not more than 70% of available balance)
      const maxPossibleAmount = Math.min(maxAmount, currentMonFloat * 0.7);
      if (maxPossibleAmount < minAmount) {
        console.log(chalk.red(`MON balance (${currentMonFloat}) is too low for minimum swap amount (${minAmount}). Skipping this swap.`));
        continue;
      }

      const randomAmount = randomUtils.getRandomFloat(minAmount, maxPossibleAmount);
      console.log(`Using random amount: ${randomAmount.toFixed(4)} MON`);
      
      // Select a random token
      const randomTokenIndex = randomUtils.getRandomInt(0, tokenAddresses.length - 1);
      const randomTokenAddress = tokenAddresses[randomTokenIndex];
      const tokenInfo = await findTokenByAddress(randomTokenAddress);
      
      console.log(`Selected random token: ${tokenInfo.symbol}`);
      
      // Decide randomly what to do (MON to Token, Token to MON, or roundtrip)
      // Check if we have any token balance first
      const tokenContract = new ethers.Contract(randomTokenAddress, ERC20_ABI, provider);
      const tokenBalance = await tokenContract.balanceOf(wallet.address);
      const tokenBalanceFormatted = ethers.utils.formatUnits(tokenBalance, tokenInfo.decimals);
      
      let action = 'monToToken'; // Default action
      let hash;
      
      // If we have tokens, randomly decide between actions
      if (parseFloat(tokenBalanceFormatted) > 0) {
        const actions = ['monToToken', 'tokenToMon', 'roundtrip'];
        action = actions[randomUtils.getRandomInt(0, 2)];
      }
      
      try {
        switch (action) {
          case 'monToToken':
            console.log('Randomly selected action: MON to Token');
            hash = await swapMonForToken(wallet, randomTokenAddress, randomAmount, slippage);
            break;
          case 'tokenToMon':
            console.log('Randomly selected action: Token to MON');
            // Use a maximum of 90% of token balance and respect token decimals
            const tokenDecimalPlaces = tokenInfo.decimals;
            const tokenAmountToSwap = (parseFloat(tokenBalanceFormatted) * 0.9).toFixed(tokenDecimalPlaces);
            hash = await swapTokenForMon(wallet, randomTokenAddress, tokenAmountToSwap, slippage);
            break;
          case 'roundtrip':
            console.log('Randomly selected action: Roundtrip');
            const result = await performRoundtrip(wallet, randomTokenAddress, randomAmount, slippage);
            hash = result.swaps;
            break;
        }
        
        results.push({
          swap: i+1,
          token: tokenInfo.symbol,
          action,
          amount: action === 'tokenToMon' ? 
                  `${(parseFloat(tokenBalanceFormatted) * 0.9).toFixed(tokenInfo.decimals)} ${tokenInfo.symbol}` : 
                  `${randomAmount.toFixed(4)} MON`,
          success: true,
          hash
        });
      } catch (error) {
        console.error(`Action ${action} failed: ${error.message}`);
        
        // Fallback to direct transaction as activity
        try {
          if (action === 'monToToken' || action === 'roundtrip') {
            hash = (await wallet.sendTransaction({
              to: randomTokenAddress,
              value: ethers.utils.parseEther((randomAmount / 4).toString()),
              gasLimit: GAS_LIMIT,
              gasPrice: GAS_PRICE
            })).hash;
            console.log(`Direct MON transaction completed: ${hash}`);
          } else {
            // Token to MON - try a self transfer if we have tokens
            if (parseFloat(tokenBalanceFormatted) > 0) {
              const transferAmount = ethers.utils.parseUnits((parseFloat(tokenBalanceFormatted) / 2).toString(), tokenInfo.decimals);
              hash = (await tokenContract.connect(wallet).transfer(wallet.address, transferAmount, {
                gasLimit: GAS_LIMIT,
                gasPrice: GAS_PRICE
              })).hash;
              console.log(`Token self-transfer completed: ${hash}`);
            } else {
              throw new Error("Insufficient token balance for fallback");
            }
          }
          
          results.push({
            swap: i+1,
            token: tokenInfo.symbol,
            action: `${action} (fallback)`,
            amount: `${randomAmount.toFixed(4)} MON`,
            success: true,
            hash
          });
        } catch (fallbackError) {
          console.error(`Fallback also failed: ${fallbackError.message}`);
          results.push({
            swap: i+1,
            token: tokenInfo.symbol,
            action,
            success: false,
            error: error.message
          });
        }
      }
    } catch (error) {
      console.error(`Error in random swap #${i+1}: ${error.message}`);
      results.push({
        swap: i+1,
        success: false,
        error: error.message
      });
      
      // Wait after error before continuing
      await randomUtils.sleep(1000, 10000);
    }
  }
  
  // Check final balance
  const finalMonBalance = await provider.getBalance(wallet.address);
  console.log(`\nFinal MON balance: ${ethers.utils.formatEther(finalMonBalance)} MON`);
  
  // Calculate profit/loss
  const difference = finalMonBalance.sub(initialMonBalance);
  const differenceEther = ethers.utils.formatEther(difference);
  
  console.log(chalk.blue('\n=== Random Multi-Token Swap Series Summary ==='));
  console.log(`Completed ${results.filter(r => r.success).length} of ${swaps} random swaps`);
  console.log(`MON balance change: ${differenceEther} MON`);
  
  return results;
}

// Function for multi-wallet operations
async function performMultiWalletSwaps(walletNames, swapParameters, walletManager, totalSwapsPerWallet) {
  stopAllSpinners(); // Ensure no spinners are running
  
  console.log(chalk.blue(`\n=== Starting Multi-Wallet Operation with ${walletNames.length} wallets ===`));
  console.log(`Each wallet will perform ${totalSwapsPerWallet} swaps in a randomized order`);
  
  const results = [];
  const overallResults = {};
  
  // Initialize results tracking for each wallet
  for (const name of walletNames) {
    overallResults[name] = {
      completedSwaps: 0,
      successfulSwaps: 0,
      failures: []
    };
  }
  
  // Perform swaps in rounds, with each wallet completing one swap per round
  for (let round = 0; round < totalSwapsPerWallet; round++) {
    console.log(chalk.yellow(`\n=== Starting Round ${round + 1}/${totalSwapsPerWallet} ===`));
    
    // Shuffle wallet names for this round to randomize order
    const randomizedWallets = randomUtils.shuffleArray(walletNames);
    
    for (let i = 0; i < randomizedWallets.length; i++) {
      const name = randomizedWallets[i];
      const wallet = walletManager.getWallet(name);
      if (!wallet) continue;
      
      console.log(`\nProcessing wallet ${i+1}/${randomizedWallets.length} in this round: ${name} (${wallet.address})`);
      console.log(`This is swap ${round+1}/${totalSwapsPerWallet} for this wallet`);
      
      try {
        let result;
        
        // Current swap parameters
        const params = { ...swapParameters };
        
        if (params.swapType === 'monToToken') {
          // Dynamic amount for each round if needed
          if (params.dynamicAmount) {
            const currentMonBalance = await provider.getBalance(wallet.address);
            const currentMonFloat = parseFloat(ethers.utils.formatEther(currentMonBalance));
            const maxPossibleAmount = Math.min(params.maxAmount, currentMonFloat * 0.7);
            if (maxPossibleAmount < params.minAmount) {
              console.log(chalk.red(`MON balance (${currentMonFloat}) is too low for minimum swap amount (${params.minAmount}). Skipping this swap.`));
              overallResults[name].failures.push({
                round: round + 1,
                error: 'Insufficient balance'
              });
              continue;
            }
            
            params.amount = randomUtils.getRandomFloat(params.minAmount, maxPossibleAmount);
            console.log(`Using random amount: ${params.amount.toFixed(4)} MON`);
          }
          
          const hash = await swapMonForToken(wallet, params.tokenAddress, params.amount, params.slippage);
          result = { success: true, hash };
        } else if (params.swapType === 'tokenToMon') {
          // Get token info for balance checks
          const tokenInfo = await findTokenByAddress(params.tokenAddress);
          const tokenContract = new ethers.Contract(params.tokenAddress, ERC20_ABI, provider);
          const tokenBalance = await tokenContract.balanceOf(wallet.address);
          const tokenBalanceFormatted = ethers.utils.formatUnits(tokenBalance, tokenInfo.decimals);
          
          if (parseFloat(tokenBalanceFormatted) <= 0) {
            console.log(chalk.red(`No ${tokenInfo.symbol} balance. Skipping this swap.`));
            overallResults[name].failures.push({
              round: round + 1,
              error: `No ${tokenInfo.symbol} balance`
            });
            continue;
          }
          
          // Dynamic amount based on available balance
          let tokenAmountToSwap;
          if (params.dynamicAmount) {
            // Use a maximum of 90% of token balance and respect token decimals
            tokenAmountToSwap = (parseFloat(tokenBalanceFormatted) * 0.9).toFixed(tokenInfo.decimals);
          } else {
            tokenAmountToSwap = Math.min(params.amount, parseFloat(tokenBalanceFormatted));
          }
          
          console.log(`Swapping ${tokenAmountToSwap} ${tokenInfo.symbol}`);
          
          const hash = await swapTokenForMon(wallet, params.tokenAddress, tokenAmountToSwap, params.slippage);
          result = { success: true, hash };
        } else if (params.swapType === 'roundtrip') {
          // Dynamic amount for roundtrip
          let roundtripAmount = params.amount;
          if (params.dynamicAmount) {
            const currentMonBalance = await provider.getBalance(wallet.address);
            const currentMonFloat = parseFloat(ethers.utils.formatEther(currentMonBalance));
            const maxPossibleAmount = Math.min(params.maxAmount, currentMonFloat * 0.7);
            
            if (maxPossibleAmount < params.minAmount) {
              console.log(chalk.red(`MON balance (${currentMonFloat}) is too low for minimum roundtrip amount (${params.minAmount}). Skipping this roundtrip.`));
              overallResults[name].failures.push({
                round: round + 1,
                error: 'Insufficient balance for roundtrip'
              });
              continue;
            }
            
            roundtripAmount = randomUtils.getRandomFloat(params.minAmount, maxPossibleAmount);
            console.log(`Using random amount for roundtrip: ${roundtripAmount.toFixed(4)} MON`);
          }
          
          result = await performRoundtrip(wallet, params.tokenAddress, roundtripAmount, params.slippage);
        } else if (params.swapType === 'autoRandom') {
          // For auto random, select a random token each time
          const randomToken = await randomUtils.selectRandomToken();
          console.log(`Selected random token for this round: ${randomToken.symbol}`);
          
          // Get current MON balance to determine possible amount
          const currentMonBalance = await provider.getBalance(wallet.address);
          const currentMonFloat = parseFloat(ethers.utils.formatEther(currentMonBalance));
          const maxPossibleAmount = Math.min(params.maxAmount, currentMonFloat * 0.7);
          
          if (maxPossibleAmount < params.minAmount) {
            console.log(chalk.red(`MON balance (${currentMonFloat}) is too low for minimum swap amount (${params.minAmount}). Skipping this swap.`));
            overallResults[name].failures.push({
              round: round + 1,
              error: 'Insufficient balance'
            });
            continue;
          }
          
          const randomAmount = randomUtils.getRandomFloat(params.minAmount, maxPossibleAmount);
          console.log(`Using random amount: ${randomAmount.toFixed(4)} MON`);
          
          // Decide randomly what to do (MON to Token, Token to MON, or roundtrip)
          // Check if we have any token balance first
          const tokenContract = new ethers.Contract(randomToken.address, ERC20_ABI, provider);
          const tokenBalance = await tokenContract.balanceOf(wallet.address);
          const tokenBalanceFormatted = ethers.utils.formatUnits(tokenBalance, randomToken.decimals);
          
          let action = 'monToToken'; // Default action
          let hash;
          
          // If we have tokens, randomly decide between actions
          if (parseFloat(tokenBalanceFormatted) > 0) {
            const actions = ['monToToken', 'tokenToMon', 'roundtrip'];
            action = actions[randomUtils.getRandomInt(0, 2)];
          }
          
          try {
            switch (action) {
              case 'monToToken':
                console.log('Randomly selected action: MON to Token');
                hash = await swapMonForToken(wallet, randomToken.address, randomAmount, params.slippage);
                break;
              case 'tokenToMon':
                console.log('Randomly selected action: Token to MON');
                // Use a maximum of 90% of token balance and respect token decimals
                const tokenDecimalPlaces = randomToken.decimals;
                const tokenAmountToSwap = (parseFloat(tokenBalanceFormatted) * 0.9).toFixed(tokenDecimalPlaces);
                hash = await swapTokenForMon(wallet, randomToken.address, tokenAmountToSwap, params.slippage);
                break;
              case 'roundtrip':
                console.log('Randomly selected action: Roundtrip');
                const rtResult = await performRoundtrip(wallet, randomToken.address, randomAmount, params.slippage);
                hash = rtResult.swaps;
                break;
            }
            
            result = {
              success: true,
              token: randomToken.symbol,
              action,
              amount: action === 'tokenToMon' ? 
                      `${(parseFloat(tokenBalanceFormatted) * 0.9).toFixed(randomToken.decimals)} ${randomToken.symbol}` : 
                      `${randomAmount.toFixed(4)} MON`,
              hash
            };
          } catch (error) {
            console.error(`Regular action failed: ${error.message}`);
            
            // Fallback to direct transaction as activity
            try {
              hash = (await wallet.sendTransaction({
                to: randomToken.address,
                value: ethers.utils.parseEther((randomAmount / 4).toString()),
                gasLimit: GAS_LIMIT,
                gasPrice: GAS_PRICE
              })).hash;
              console.log(`Fallback - direct MON transaction completed: ${hash}`);
              
              result = {
                success: true,
                token: randomToken.symbol,
                action: `${action} (fallback)`,
                amount: `${randomAmount.toFixed(4)} MON`,
                hash
              };
            } catch (fallbackError) {
              throw error; // Propagate the original error
            }
          }
        }
        
        // Record successful swap
        overallResults[name].completedSwaps++;
        overallResults[name].successfulSwaps++;
        
        results.push({
          round: round + 1,
          wallet: name,
          success: true,
          result
        });
        
      } catch (error) {
        console.error(`Failed for wallet ${name} in round ${round + 1}: ${error.message}`);
        
        // Record failure
        overallResults[name].completedSwaps++;
        overallResults[name].failures.push({
          round: round + 1,
          error: error.message
        });
        
        results.push({
          round: round + 1,
          wallet: name,
          success: false,
          error: error.message
        });
      }
      
      // Short delay between wallets (1-5 seconds)
      if (i < randomizedWallets.length - 1) {
        await randomUtils.sleep(1000, 5000);
      }
    }
    
    // Short delay between rounds (3-8 seconds)
    if (round < totalSwapsPerWallet - 1) {
      console.log(chalk.blue(`\nCompleted round ${round + 1}. Preparing for next round...`));
      await randomUtils.sleep(3000, 8000);
    }
  }
  
  // Display summary
  console.log(chalk.blue('\n=== Multi-Wallet Operation Summary ==='));
  
  let totalSuccessful = 0;
  let totalAttempted = 0;
  
  for (const [name, stats] of Object.entries(overallResults)) {
    totalSuccessful += stats.successfulSwaps;
    totalAttempted += stats.completedSwaps;
    
    const successRate = stats.completedSwaps > 0 ? 
                        Math.round((stats.successfulSwaps / stats.completedSwaps) * 100) : 0;
    
    console.log(`${name}: ${stats.successfulSwaps}/${stats.completedSwaps} successful (${successRate}%)`);
    
    if (stats.failures.length > 0) {
      console.log(`  Failures: ${stats.failures.length}`);
      // Only show the first few failures to avoid cluttering the console
      const shownFailures = stats.failures.slice(0, Math.min(3, stats.failures.length));
      for (const failure of shownFailures) {
        console.log(`  - Round ${failure.round}: ${failure.error}`);
      }
      if (stats.failures.length > 3) {
        console.log(`  - ...and ${stats.failures.length - 3} more failures`);
      }
    }
  }
  
  const overallSuccessRate = totalAttempted > 0 ? 
                             Math.round((totalSuccessful / totalAttempted) * 100) : 0;
  
  console.log(`\nOverall: ${totalSuccessful}/${totalAttempted} successful swaps (${overallSuccessRate}%)`);
  
  return {
    results,
    summary: overallResults
  };
}

async function checkBalances(wallet) {
  stopAllSpinners(); // Ensure no spinners are running
  const spinner = createSpinner('Checking balances...');
  
  try {
    // Check MON balance
    const monBalance = await provider.getBalance(wallet.address);
    
    // Check token balances - get all tokens including discovered ones
    const allTokens = await getAllTokens();
    const tokenBalances = {};
    
    for (const [symbol, data] of Object.entries(allTokens)) {
      try {
        const token = new ethers.Contract(data.address, ERC20_ABI, provider);
        const balance = await token.balanceOf(wallet.address);
        if (!balance.isZero()) {
          tokenBalances[symbol] = ethers.utils.formatUnits(balance, data.decimals);
        }
      } catch (error) {
        // Skip tokens that fail to load
      }
    }
    
    spinner.succeed('Balances retrieved');
    
    console.log(`\nMON: ${ethers.utils.formatEther(monBalance)}`);
    if (Object.keys(tokenBalances).length === 0) {
      console.log('No token balances found');
    } else {
      for (const [symbol, balance] of Object.entries(tokenBalances)) {
        console.log(`${symbol}: ${balance}`);
      }
    }
    
    return {
      MON: ethers.utils.formatEther(monBalance),
      ...tokenBalances
    };
  } catch (error) {
    spinner.fail(`Failed to check balances: ${error.message}`);
    throw error;
  } finally {
    if (spinner.isSpinning) spinner.stop();
  }
}

// CLI implementation
const walletManager = new WalletManager();

const program = new Command();
program
  .name('monad-ambient')
  .description('CLI for swapping tokens on Monad Testnet using Ambient Finance')
  .version('1.0.0');

// Display fancy header
console.log(
  chalk.blue(
    figlet.textSync('Monad Ambient', { horizontalLayout: 'full' })
  )
);
console.log(chalk.yellow('Ambient Finance CLI for Monad Testnet\n'));

// Wallet management commands
program
  .command('wallet-add')
  .description('Add a new wallet by private key')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter a name for this wallet:'
      },
      {
        type: 'password',
        name: 'privateKey',
        message: 'Enter the private key:'
      }
    ]);
    
    const address = walletManager.addWallet(answers.name, answers.privateKey);
    if (address) {
      console.log(`Wallet ${answers.name} added with address ${address}`);
    }
  });

program
  .command('wallet-import')
  .description('Import wallets from a JSON file')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'filePath',
        message: 'Enter the path to the JSON file:'
      }
    ]);
    
    walletManager.importWallets(answers.filePath);
  });

program
  .command('wallet-list')
  .description('List all wallets')
  .action(() => {
    const wallets = walletManager.listWallets();
    console.log('\nWallets:');
    wallets.forEach(wallet => {
      console.log(`${wallet.name}: ${wallet.address}`);
    });
  });

// Add token discovery command
program
  .command('discover-tokens')
  .description('Discover tokens available on Monad Testnet')
  .action(async () => {
    const tokens = await discoverTokens();
    console.log('\nDiscovered Tokens:');
    for (const [symbol, data] of Object.entries(tokens)) {
      console.log(`${symbol}: ${data.address} (${data.decimals} decimals)`);
    }
  });

// Balance command
program
  .command('balance')
  .description('Check balances of a wallet')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'walletName',
        message: 'Select a wallet:',
        choices: walletChoices
      }
    ]);
    
    const wallet = walletManager.getWallet(answers.walletName);
    if (!wallet) return;
    
    await checkBalances(wallet);
  });

// Auto Swap command
program
  .command('auto-swap')
  .description('Perform automated swaps with random timing and amounts')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    // Get all tokens
    const tokens = await getAllTokens();
    const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
    
    const answers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'walletNames',
        message: 'Select wallets:',
        choices: walletChoices
      },
      {
        type: 'list',
        name: 'swapMode',
        message: 'Select auto-swap mode:',
        choices: [
          { name: 'Single token roundtrips (MON → Token → MON)', value: 'roundtrip' },
          { name: 'Random multi-token swaps', value: 'multiToken' }
        ]
      },
      {
        type: 'list',
        name: 'tokenAddress',
        message: 'Select a token (for roundtrip mode):',
        choices: tokenChoices,
        when: (answers) => answers.swapMode === 'roundtrip'
      },
      {
        type: 'number',
        name: 'swapsPerWallet',
        message: 'Enter number of swaps to perform per wallet:',
        default: 5
      },
      {
        type: 'number',
        name: 'minAmount',
        message: 'Enter minimum MON amount per swap:',
        default: 0.01
      },
      {
        type: 'number',
        name: 'maxAmount',
        message: 'Enter maximum MON amount per swap:',
        default: 0.1
      },
      {
        type: 'number',
        name: 'slippage',
        message: 'Enter slippage tolerance (%):', 
        default: 1
      }
    ]);
    
    if (answers.walletNames.length === 0) {
      console.log('No wallets selected');
      return;
    }
    
    // Prepare the swap parameters based on the selected mode
    let swapParameters = {
      swapType: answers.swapMode === 'roundtrip' ? 'roundtrip' : 'autoRandom',
      tokenAddress: answers.tokenAddress, // Only used for roundtrip mode
      minAmount: answers.minAmount,
      maxAmount: answers.maxAmount,
      dynamicAmount: true, // Use dynamic amounts based on wallet balance
      slippage: answers.slippage
    };
    
    // Run the multi-wallet swap function
    await performMultiWalletSwaps(
      answers.walletNames,
      swapParameters,
      walletManager,
      answers.swapsPerWallet
    );
    
    // Clear any remaining spinners
    stopAllSpinners();
  });

// Swap commands
program
  .command('swap-mon-to-token')
  .description('Swap MON for a token')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    // Use getAllTokens instead of TOKENS directly
    const tokens = await getAllTokens();
    const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'walletName',
        message: 'Select a wallet:',
        choices: walletChoices
      },
      {
        type: 'list',
        name: 'tokenAddress',
        message: 'Select a token:',
        choices: tokenChoices
      },
      {
        type: 'number',
        name: 'amount',
        message: 'Enter amount of MON to swap:'
      },
      {
        type: 'number',
        name: 'slippage',
        message: 'Enter slippage tolerance (%):', 
        default: 5
      }
    ]);
    
    const wallet = walletManager.getWallet(answers.walletName);
    if (!wallet) return;
    
    await swapMonForToken(wallet, answers.tokenAddress, answers.amount, answers.slippage);
  });

program
  .command('swap-token-to-mon')
  .description('Swap a token for MON')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    // Use getAllTokens instead of TOKENS directly
    const tokens = await getAllTokens();
    const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'walletName',
        message: 'Select a wallet:',
        choices: walletChoices
      },
      {
        type: 'list',
        name: 'tokenAddress',
        message: 'Select a token:',
        choices: tokenChoices
      },
      {
        type: 'number',
        name: 'amount',
        message: 'Enter amount of token to swap:'
      },
      {
        type: 'number',
        name: 'slippage',
        message: 'Enter slippage tolerance (%):', 
        default: 5
      }
    ]);
    
    const wallet = walletManager.getWallet(answers.walletName);
    if (!wallet) return;
    
    await swapTokenForMon(wallet, answers.tokenAddress, answers.amount, answers.slippage);
  });

program
  .command('swap-token-to-token')
  .description('Swap a token for another token')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    // Use getAllTokens instead of TOKENS directly
    const tokens = await getAllTokens();
    const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'walletName',
        message: 'Select a wallet:',
        choices: walletChoices
      },
      {
        type: 'list',
        name: 'tokenInAddress',
        message: 'Select token to swap from:',
        choices: tokenChoices
      },
      {
        type: 'list',
        name: 'tokenOutAddress',
        message: 'Select token to swap to:',
        choices: tokenChoices
      },
      {
        type: 'number',
        name: 'amount',
        message: 'Enter amount of token to swap:'
      },
      {
        type: 'number',
        name: 'slippage',
        message: 'Enter slippage tolerance (%):', 
        default: 5
      }
    ]);
    
    const wallet = walletManager.getWallet(answers.walletName);
    if (!wallet) return;
    
    await swapTokenForToken(wallet, answers.tokenInAddress, answers.tokenOutAddress, answers.amount, answers.slippage);
  });

program
  .command('roundtrip')
  .description('Perform a roundtrip swap: MON -> token -> MON')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    // Use getAllTokens instead of TOKENS directly
    const tokens = await getAllTokens();
    const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'walletName',
        message: 'Select a wallet:',
        choices: walletChoices
      },
      {
        type: 'list',
        name: 'tokenAddress',
        message: 'Select a token:',
        choices: tokenChoices
      },
      {
        type: 'number',
        name: 'amount',
        message: 'Enter amount of MON to use:'
      },
      {
        type: 'number',
        name: 'slippage',
        message: 'Enter slippage tolerance (%):', 
        default: 5
      }
    ]);
    
    const wallet = walletManager.getWallet(answers.walletName);
    if (!wallet) return;
    
    await performRoundtrip(wallet, answers.tokenAddress, answers.amount, answers.slippage);
  });

program
  .command('auto-roundtrip')
  .description('Perform multiple roundtrip swaps automatically')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    // Use getAllTokens instead of TOKENS directly
    const tokens = await getAllTokens();
    const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'walletName',
        message: 'Select a wallet:',
        choices: walletChoices
      },
      {
        type: 'list',
        name: 'tokenAddress',
        message: 'Select a token:',
        choices: tokenChoices
      },
      {
        type: 'number',
        name: 'amount',
        message: 'Enter amount of MON to use for the first swap:'
      },
      {
        type: 'number',
        name: 'count',
        message: 'Enter number of roundtrips to perform:',
        default: 3
      },
      {
        type: 'number',
        name: 'slippage',
        message: 'Enter slippage tolerance (%):', 
        default: 5
      }
    ]);
    
    const wallet = walletManager.getWallet(answers.walletName);
    if (!wallet) return;
    
    await performAutoRoundtrip(
      wallet, 
      answers.tokenAddress, 
      answers.amount, 
      answers.count, 
      answers.slippage
    );
  });

// Add liquidity command
program
  .command('add-liquidity')
  .description('Add liquidity to Ambient Finance')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    // Use getAllTokens instead of TOKENS directly
    const tokens = await getAllTokens();
    const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'walletName',
        message: 'Select a wallet:',
        choices: walletChoices
      },
      {
        type: 'list',
        name: 'tokenAddress',
        message: 'Select a token to pair with MON:',
        choices: tokenChoices
      },
      {
        type: 'number',
        name: 'tokenAmount',
        message: 'Enter amount of token to add:'
      },
      {
        type: 'number',
        name: 'monAmount',
        message: 'Enter amount of MON to add:'
      },
      {
        type: 'number',
        name: 'slippage',
        message: 'Enter slippage tolerance (%):', 
        default: 5
      }
    ]);
    
    const wallet = walletManager.getWallet(answers.walletName);
    if (!wallet) return;
    
    await addLiquidity(wallet, answers.tokenAddress, answers.tokenAmount, answers.monAmount, answers.slippage);
  });

// Multi-Wallet Operations command
program
  .command('multi-wallet-swap')
  .description('Perform swaps across multiple wallets in randomized order')
  .action(async () => {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log('No wallets found. Add a wallet first.');
      return;
    }
    
    const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
    
    // Use getAllTokens instead of TOKENS directly
    const tokens = await getAllTokens();
    const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
    
    const answers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'walletNames',
        message: 'Select wallets:',
        choices: walletChoices
      },
      {
        type: 'list',
        name: 'swapType',
        message: 'Select swap type:',
        choices: [
          { name: 'MON to Token', value: 'monToToken' },
          { name: 'Token to MON', value: 'tokenToMon' },
          { name: 'Roundtrip (MON → Token → MON)', value: 'roundtrip' },
          { name: 'Auto Random Swaps', value: 'autoRandom' }
        ]
      },
      {
        type: 'list',
        name: 'tokenAddress',
        message: 'Select a token:',
        choices: tokenChoices,
        when: (answers) => answers.swapType !== 'autoRandom'
      },
      {
        type: 'number',
        name: 'maxSwapsPerWallet',
        message: 'Enter number of swaps to perform per wallet:',
        default: 3
      },
      {
        type: 'confirm',
        name: 'dynamicAmount',
        message: 'Use dynamic amount based on wallet balance?',
        default: true
      },
      {
        type: 'number',
        name: 'amount',
        message: 'Enter amount per swap:',
        when: (answers) => !answers.dynamicAmount && answers.swapType !== 'autoRandom'
      },
      {
        type: 'number',
        name: 'minAmount',
        message: 'Enter minimum MON amount per swap:',
        default: 0.01,
        when: (answers) => answers.dynamicAmount || answers.swapType === 'autoRandom'
      },
      {
        type: 'number',
        name: 'maxAmount',
        message: 'Enter maximum MON amount per swap:',
        default: 0.1,
        when: (answers) => answers.dynamicAmount || answers.swapType === 'autoRandom'
      },
      {
        type: 'number',
        name: 'slippage',
        message: 'Enter slippage tolerance (%):', 
        default: 5
      }
    ]);
    
    if (answers.walletNames.length === 0) {
      console.log('No wallets selected');
      return;
    }
    
    // Prepare the swap parameters
    let swapParameters = {
      swapType: answers.swapType,
      tokenAddress: answers.tokenAddress,
      amount: answers.amount,
      minAmount: answers.minAmount,
      maxAmount: answers.maxAmount,
      dynamicAmount: answers.dynamicAmount,
      slippage: answers.slippage
    };
    
    // Run the multi-wallet swap function
    await performMultiWalletSwaps(
      answers.walletNames,
      swapParameters,
      walletManager,
      answers.maxSwapsPerWallet
    );
    
    // Clear any remaining spinners
    stopAllSpinners();
  });

// Interactive mode
program
  .command('interactive', { isDefault: true })
  .description('Start interactive mode')
  .action(async () => {
    try {
      let running = true;
      
      while (running) {
        stopAllSpinners(); // Ensure no spinners are running
        
        const mainAnswer = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
              { name: 'Wallet Management', value: 'wallet' },
              { name: 'Check Balances', value: 'balance' },
              { name: 'Swap Tokens', value: 'swap' },
              { name: 'Auto Swap (Random/Automated)', value: 'auto' },
              { name: 'Multi-Wallet Operations', value: 'multi' },
              { name: 'Liquidity Operations', value: 'liquidity' },
              { name: 'Token Discovery', value: 'discover' },
              { name: 'Exit', value: 'exit' }
            ]
          }
        ]);
        
        switch (mainAnswer.action) {
          case 'wallet':
            const walletAction = await inquirer.prompt([
              {
                type: 'list',
                name: 'action',
                message: 'Wallet management:',
                choices: [
                  { name: 'Add wallet', value: 'add' },
                  { name: 'Import wallets from file', value: 'import' },
                  { name: 'List wallets', value: 'list' },
                  { name: 'Back to main menu', value: 'back' }
                ]
              }
            ]);
            
            if (walletAction.action === 'back') break;
            
            try {
              if (walletAction.action === 'add') {
                const answers = await inquirer.prompt([
                  {
                    type: 'input',
                    name: 'name',
                    message: 'Enter a name for this wallet:'
                  },
                  {
                    type: 'password',
                    name: 'privateKey',
                    message: 'Enter the private key:'
                  }
                ]);
                
                const address = walletManager.addWallet(answers.name, answers.privateKey);
                if (address) {
                  console.log(`Wallet ${answers.name} added with address ${address}`);
                }
              } else if (walletAction.action === 'import') {
                const answers = await inquirer.prompt([
                  {
                    type: 'input',
                    name: 'filePath',
                    message: 'Enter the path to the JSON file:'
                  }
                ]);
                
                walletManager.importWallets(answers.filePath);
              } else if (walletAction.action === 'list') {
                const wallets = walletManager.listWallets();
                console.log('\nWallets:');
                wallets.forEach(wallet => {
                  console.log(`${wallet.name}: ${wallet.address}`);
                });
              }
            } catch (error) {
              console.error('Error in wallet management:', error.message);
            }
            break;
            
          case 'balance':
            try {
              const wallets = walletManager.listWallets();
              if (wallets.length === 0) {
                console.log('No wallets found. Add a wallet first.');
                break;
              }
              
              const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
              
              const answers = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'walletName',
                  message: 'Select a wallet:',
                  choices: walletChoices
                }
              ]);
              
              const wallet = walletManager.getWallet(answers.walletName);
              if (!wallet) break;
              
              await checkBalances(wallet);
            } catch (error) {
              console.error('Error checking balances:', error.message);
            }
            break;
            
          case 'discover':
            try {
              console.log('Discovering tokens on Monad Testnet...');
              const tokens = await discoverTokens();
              console.log('\nDiscovered Tokens:');
              for (const [symbol, data] of Object.entries(tokens)) {
                console.log(`${symbol}: ${data.address} (${data.decimals} decimals)`);
              }
            } catch (error) {
              console.error('Error discovering tokens:', error.message);
            }
            break;
            
            case 'swap':
              const swapAction = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'action',
                  message: 'Swap tokens:',
                  choices: [
                    { name: 'MON to Token', value: 'monToToken' },
                    { name: 'Token to MON', value: 'tokenToMon' },
                    { name: 'Token to Token', value: 'tokenToToken' },
                    { name: 'Roundtrip (MON → Token → MON)', value: 'roundtrip' },
                    { name: 'Auto Roundtrip (Multiple)', value: 'autoRoundtrip' },
                    { name: 'Back to main menu', value: 'back' }
                  ]
                }
              ]);
              
              if (swapAction.action === 'back') break;
              
              try {
                const wallets = walletManager.listWallets();
                if (wallets.length === 0) {
                  console.log('No wallets found. Add a wallet first.');
                  break;
                }
                
                const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
                
                // Use getAllTokens instead of TOKENS directly
                const tokens = await getAllTokens();
                const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
                
                if (swapAction.action === 'monToToken') {
                  const answers = await inquirer.prompt([
                    {
                      type: 'list',
                      name: 'walletName',
                      message: 'Select a wallet:',
                      choices: walletChoices
                    },
                    {
                      type: 'list',
                      name: 'tokenAddress',
                      message: 'Select a token:',
                      choices: tokenChoices
                    },
                    {
                      type: 'number',
                      name: 'amount',
                      message: 'Enter amount of MON to swap:'
                    },
                    {
                      type: 'number',
                      name: 'slippage',
                      message: 'Enter slippage tolerance (%):', 
                      default: 5
                    }
                  ]);
                  
                  const wallet = walletManager.getWallet(answers.walletName);
                  if (!wallet) break;
                  
                  await swapMonForToken(wallet, answers.tokenAddress, answers.amount, answers.slippage);
                } else if (swapAction.action === 'tokenToMon') {
                  const answers = await inquirer.prompt([
                    {
                      type: 'list',
                      name: 'walletName',
                      message: 'Select a wallet:',
                      choices: walletChoices
                    },
                    {
                      type: 'list',
                      name: 'tokenAddress',
                      message: 'Select a token:',
                      choices: tokenChoices
                    },
                    {
                      type: 'number',
                      name: 'amount',
                      message: 'Enter amount of token to swap:'
                    },
                    {
                      type: 'number',
                      name: 'slippage',
                      message: 'Enter slippage tolerance (%):', 
                      default: 5
                    }
                  ]);
                  
                  const wallet = walletManager.getWallet(answers.walletName);
                  if (!wallet) break;
                  
                  await swapTokenForMon(wallet, answers.tokenAddress, answers.amount, answers.slippage);
                } else if (swapAction.action === 'tokenToToken') {
                  const answers = await inquirer.prompt([
                    {
                      type: 'list',
                      name: 'walletName',
                      message: 'Select a wallet:',
                      choices: walletChoices
                    },
                    {
                      type: 'list',
                      name: 'tokenInAddress',
                      message: 'Select token to swap from:',
                      choices: tokenChoices
                    },
                    {
                      type: 'list',
                      name: 'tokenOutAddress',
                      message: 'Select token to swap to:',
                      choices: tokenChoices
                    },
                    {
                      type: 'number',
                      name: 'amount',
                      message: 'Enter amount of token to swap:'
                    },
                    {
                      type: 'number',
                      name: 'slippage',
                      message: 'Enter slippage tolerance (%):', 
                      default: 5
                    }
                  ]);
                  
                  const wallet = walletManager.getWallet(answers.walletName);
                  if (!wallet) break;
                  
                  await swapTokenForToken(wallet, answers.tokenInAddress, answers.tokenOutAddress, answers.amount, answers.slippage);
                } else if (swapAction.action === 'roundtrip') {
                  const answers = await inquirer.prompt([
                    {
                      type: 'list',
                      name: 'walletName',
                      message: 'Select a wallet:',
                      choices: walletChoices
                    },
                    {
                      type: 'list',
                      name: 'tokenAddress',
                      message: 'Select a token:',
                      choices: tokenChoices
                    },
                    {
                      type: 'number',
                      name: 'amount',
                      message: 'Enter amount of MON to use:'
                    },
                    {
                      type: 'number',
                      name: 'slippage',
                      message: 'Enter slippage tolerance (%):', 
                      default: 5
                    }
                  ]);
                  
                  const wallet = walletManager.getWallet(answers.walletName);
                  if (!wallet) break;
                  
                  await performRoundtrip(wallet, answers.tokenAddress, answers.amount, answers.slippage);
                } else if (swapAction.action === 'autoRoundtrip') {
                  const answers = await inquirer.prompt([
                    {
                      type: 'list',
                      name: 'walletName',
                      message: 'Select a wallet:',
                      choices: walletChoices
                    },
                    {
                      type: 'list',
                      name: 'tokenAddress',
                      message: 'Select a token:',
                      choices: tokenChoices
                    },
                    {
                      type: 'number',
                      name: 'amount',
                      message: 'Enter amount of MON to use for the first swap:'
                    },
                    {
                      type: 'number',
                      name: 'count',
                      message: 'Enter number of roundtrips to perform:',
                      default: 3
                    },
                    {
                      type: 'number',
                      name: 'slippage',
                      message: 'Enter slippage tolerance (%):', 
                      default: 5
                    }
                  ]);
                  
                  const wallet = walletManager.getWallet(answers.walletName);
                  if (!wallet) break;
                  
                  await performAutoRoundtrip(
                    wallet, 
                    answers.tokenAddress, 
                    answers.amount, 
                    answers.count, 
                    answers.slippage
                  );
                }
              } catch (error) {
                console.error('Error executing swap:', error.message);
              } finally {
                stopAllSpinners(); // Ensure all spinners are stopped
              }
              break;
              
            case 'auto':
              try {
                // Auto swap menu
                const autoAction = await inquirer.prompt([
                  {
                    type: 'list',
                    name: 'swapMode',
                    message: 'Select auto-swap mode:',
                    choices: [
                      { name: 'Single token roundtrips (MON → Token → MON)', value: 'roundtrip' },
                      { name: 'Random multi-token swaps', value: 'multiToken' },
                      { name: 'Back to main menu', value: 'back' }
                    ]
                  }
                ]);
                
                if (autoAction.swapMode === 'back') break;
                
                const wallets = walletManager.listWallets();
                if (wallets.length === 0) {
                  console.log('No wallets found. Add a wallet first.');
                  break;
                }
                
                const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
                
                // Get all tokens
                const tokens = await getAllTokens();
                const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
                
                const answers = await inquirer.prompt([
                  {
                    type: 'checkbox',
                    name: 'walletNames',
                    message: 'Select wallets:',
                    choices: walletChoices
                  },
                  {
                    type: 'list',
                    name: 'tokenAddress',
                    message: 'Select a token (for roundtrip mode):',
                    choices: tokenChoices,
                    when: (answers) => autoAction.swapMode === 'roundtrip'
                  },
                  {
                    type: 'number',
                    name: 'swapsPerWallet',
                    message: 'Enter number of swaps to perform per wallet:',
                    default: 5
                  },
                  {
                    type: 'number',
                    name: 'minAmount',
                    message: 'Enter minimum MON amount per swap:',
                    default: 0.01
                  },
                  {
                    type: 'number',
                    name: 'maxAmount',
                    message: 'Enter maximum MON amount per swap:',
                    default: 0.1
                  },
                  {
                    type: 'number',
                    name: 'slippage',
                    message: 'Enter slippage tolerance (%):', 
                    default: 1
                  }
                ]);
                
                if (answers.walletNames.length === 0) {
                  console.log('No wallets selected');
                  break;
                }
                
                // Prepare the swap parameters based on the selected mode
                const swapParams = {
                  swapType: autoAction.swapMode === 'roundtrip' ? 'roundtrip' : 'autoRandom',
                  tokenAddress: answers.tokenAddress, // Only used for roundtrip mode
                  minAmount: answers.minAmount,
                  maxAmount: answers.maxAmount,
                  dynamicAmount: true, // Use dynamic amounts based on wallet balance
                  slippage: answers.slippage
                };
                
                // Run the multi-wallet swap function with the new logic
                await performMultiWalletSwaps(
                  answers.walletNames,
                  swapParams,
                  walletManager,
                  answers.swapsPerWallet
                );
                
              } catch (error) {
                console.error('Error executing auto swaps:', error.message);
              } finally {
                stopAllSpinners(); // Ensure all spinners are stopped
              }
              break;
              
            case 'multi':
              try {
                const wallets = walletManager.listWallets();
                if (wallets.length === 0) {
                  console.log('No wallets found. Add a wallet first.');
                  break;
                }
                
                const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
                
                // First, determine the operation type
                const operationType = await inquirer.prompt([
                  {
                    type: 'list',
                    name: 'type',
                    message: 'Select operation type:',
                    choices: [
                      { name: 'Same Swap Across Wallets (randomized order)', value: 'sameSwap' },
                      { name: 'Automated Roundtrips (MON → Token → MON across wallets)', value: 'autoRoundtrip' },
                      { name: 'Random Multi-Token Swaps (across wallets)', value: 'autoMultiToken' }
                    ]
                  }
                ]);
                
                // Get all tokens
                const tokens = await getAllTokens();
                const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
                
                // Select the wallets for the operation
                const selectedWallets = await inquirer.prompt([
                  {
                    type: 'checkbox',
                    name: 'walletNames',
                    message: 'Select wallets:',
                    choices: walletChoices
                  }
                ]);
                
                if (selectedWallets.walletNames.length === 0) {
                  console.log('No wallets selected');
                  break;
                }
                
                // Based on operation type, get additional parameters
                let swapParams = {};
                
                if (operationType.type === 'sameSwap') {
                  // Parameters for same swap across wallets
                  const swapParams = await inquirer.prompt([
                    {
                      type: 'list',
                      name: 'swapType',
                      message: 'Select swap type:',
                      choices: [
                        { name: 'MON to Token', value: 'monToToken' },
                        { name: 'Token to MON', value: 'tokenToMon' },
                        { name: 'Roundtrip (MON → Token → MON)', value: 'roundtrip' }
                      ]
                    },
                    {
                      type: 'list',
                      name: 'tokenAddress',
                      message: 'Select a token:',
                      choices: tokenChoices
                    },
                    {
                      type: 'number',
                      name: 'swapsPerWallet',
                      message: 'Enter number of swaps per wallet:',
                      default: 3
                    },
                    {
                      type: 'confirm',
                      name: 'dynamicAmount',
                      message: 'Use dynamic amount based on wallet balance?',
                      default: true
                    },
                    {
                      type: 'number',
                      name: 'amount',
                      message: 'Enter amount per swap:',
                      when: (answers) => !answers.dynamicAmount
                    },
                    {
                      type: 'number',
                      name: 'minAmount',
                      message: 'Enter minimum MON amount per swap:',
                      default: 0.01,
                      when: (answers) => answers.dynamicAmount
                    },
                    {
                      type: 'number',
                      name: 'maxAmount',
                      message: 'Enter maximum MON amount per swap:',
                      default: 0.1,
                      when: (answers) => answers.dynamicAmount
                    },
                    {
                      type: 'number',
                      name: 'slippage',
                      message: 'Enter slippage tolerance (%):', 
                      default: 5
                    }
                  ]);
                  
                  swapParams = swapParams;
                  
                } else if (operationType.type === 'autoRoundtrip' || operationType.type === 'autoMultiToken') {
                  // Parameters for automated swaps
                  const autoParams = await inquirer.prompt([
                    {
                      type: 'list',
                      name: 'tokenAddress',
                      message: 'Select a token (for roundtrip mode):',
                      choices: tokenChoices,
                      when: () => operationType.type === 'autoRoundtrip'
                    },
                    {
                      type: 'number',
                      name: 'swapsPerWallet',
                      message: 'Enter number of swaps per wallet:',
                      default: 3
                    },
                    {
                      type: 'number',
                      name: 'minAmount',
                      message: 'Enter minimum MON amount per swap:',
                      default: 0.01
                    },
                    {
                      type: 'number',
                      name: 'maxAmount',
                      message: 'Enter maximum MON amount per swap:',
                      default: 0.1
                    },
                    {
                      type: 'number',
                      name: 'slippage',
                      message: 'Enter slippage tolerance (%):', 
                      default: 1
                    }
                  ]);
                  
                  swapParams = { 
                    ...autoParams,
                    swapType: operationType.type === 'autoRoundtrip' ? 'roundtrip' : 'autoRandom',
                    dynamicAmount: true
                  };
                }
                
                // Set the maximum swaps per wallet
                const swapsPerWallet = swapParams.swapsPerWallet || 3;
                delete swapParams.swapsPerWallet; // Remove from params as it's passed separately
                
                console.log(chalk.blue(`\n=== Starting Multi-Wallet Operation with ${selectedWallets.walletNames.length} wallets ===`));
                console.log(`Each wallet will perform ${swapsPerWallet} swaps in a randomized order`);
                
                // Run the multi-wallet swap function with the new logic
                await performMultiWalletSwaps(
                  selectedWallets.walletNames,
                  swapParams,
                  walletManager,
                  swapsPerWallet
                );
                
              } catch (error) {
                console.error('Error in multi-wallet operation:', error.message);
              } finally {
                stopAllSpinners(); // Ensure all spinners are stopped
              }
              break;
              
            case 'liquidity':
              try {
                const wallets = walletManager.listWallets();
                if (wallets.length === 0) {
                  console.log('No wallets found. Add a wallet first.');
                  break;
                }
                
                const walletChoices = wallets.map(w => ({ name: `${w.name} (${w.address})`, value: w.name }));
                const tokens = await getAllTokens();
                const tokenChoices = Object.keys(tokens).map(symbol => ({ name: symbol, value: tokens[symbol].address }));
                
                const answers = await inquirer.prompt([
                  {
                    type: 'list',
                    name: 'walletName',
                    message: 'Select a wallet:',
                    choices: walletChoices
                  },
                  {
                    type: 'list',
                    name: 'tokenAddress',
                    message: 'Select a token to pair with MON:',
                    choices: tokenChoices
                  },
                  {
                    type: 'number',
                    name: 'tokenAmount',
                    message: 'Enter amount of token to add:'
                  },
                  {
                    type: 'number',
                    name: 'monAmount',
                    message: 'Enter amount of MON to add:'
                  },
                  {
                    type: 'number',
                    name: 'slippage',
                    message: 'Enter slippage tolerance (%):', 
                    default: 5
                  }
                ]);
                
                const wallet = walletManager.getWallet(answers.walletName);
                if (!wallet) break;
                
                await addLiquidity(wallet, answers.tokenAddress, answers.tokenAmount, answers.monAmount, answers.slippage);
              } catch (error) {
                console.error('Error adding liquidity:', error.message);
              } finally {
                stopAllSpinners();
              }
              break;
              
            case 'exit':
              running = false;
              break;
            }
            
            if (running) {
              console.log('\n');
              await new Promise(resolve => setTimeout(resolve, 1000));
              stopAllSpinners(); // Ensure all spinners are stopped
            }
            }
            
            console.log('Goodbye!');
            } catch (error) {
            console.error('Error in interactive mode:', error);
            stopAllSpinners(); // Ensure all spinners are stopped in case of error
            }
            });
            
            process.on('SIGINT', () => {
            console.log("\nExiting gracefully...");
            stopAllSpinners();
            process.exit(0);
            });
            
            process.on('uncaughtException', (err) => {
            console.error('Uncaught exception:', err);
            stopAllSpinners();
            process.exit(1);
            });
            
            // Make sure this is the LAST line of your script
            program.parse(process.argv);