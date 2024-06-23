# Solana JITO Swap

This project is dedicated to protecting Solana transactions from MEV bots.

## Setup

1. Download raydium's liqudity file:

```sh
mkdir markets
curl https://api.raydium.io/v2/sdk/liquidity/mainnet.json -o ./markets/raydium.json
```

2. Create .env file

- `PRIVATE_KEY` - Your wallet's private key.

## Run

```sh
pnpm run start
```
