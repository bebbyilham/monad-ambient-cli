# Monad Ambient CLI

A command-line tool for interacting with the Monad testnet and Ambient protocol. This CLI allows you to manage wallets, interact with smart contracts, and perform DeFi operations on the Monad testnet.

## Features
- Wallet management
- Interact with Monad testnet contracts
- DeFi operations via Ambient protocol

## Prerequisites
- Node.js (v14 or higher)
- npm
- GitHub CLI (for contributing)

## Installation
```
npm install
```

## Usage
```
node monad-ambient-cli.js [options]
```

You can also make the script executable and run it directly:
```
chmod +x monad-ambient-cli.js
./monad-ambient-cli.js [options]
```

## Security
- Do NOT commit your `wallets.json` or any private keys.
- All sensitive files are excluded via `.gitignore`.

## Contributing
1. Fork the repo
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

## License
ISC
