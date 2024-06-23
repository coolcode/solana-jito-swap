import { Connection, PublicKey, VersionedTransaction, TransactionMessage, BlockhashWithExpiryBlockHeight } from '@solana/web3.js'
import {
  Liquidity,
  LiquidityPoolKeys,
  jsonInfo2PoolKeys,
  LiquidityPoolJsonInfo,
  Token,
  TokenAmount,
  TOKEN_PROGRAM_ID,
  Percent,
  SPL_ACCOUNT_LAYOUT,
} from '@raydium-io/raydium-sdk'

import { readFileSync } from 'fs'
import { logger } from './log'

/**
 * Class representing a Raydium Swap operation.
 */
export class RaydiumSwap {
  allPoolKeysJson: LiquidityPoolJsonInfo[]

  constructor(
    private readonly connection: Connection,
    private readonly walletPublicKey: PublicKey) {

    // https://api.raydium.io/v2/sdk/liquidity/mainnet.json
    // this.loadPoolKeys('./markets/raydium.json')
  }

  async loadPoolKeys(liquidityFile: string) {
    const liquidityJson = JSON.parse(readFileSync(liquidityFile, 'utf-8'),) as { official: []; unOfficial: [] }

    logger.debug(
      `Raydium: Found ${liquidityJson.official.length} official pools and ${liquidityJson.unOfficial.length} unofficial pools`,
    )

    this.allPoolKeysJson = [...liquidityJson.official, ...liquidityJson.unOfficial]
  }


  findPoolInfo(mintA: string, mintB: string) {
    const poolData = this.allPoolKeysJson.find(
      (i) => (i.baseMint === mintA && i.quoteMint === mintB) || (i.baseMint === mintB && i.quoteMint === mintA)
    )

    if (!poolData) return null

    logger.debug(JSON.stringify(poolData))

    return jsonInfo2PoolKeys(poolData) as LiquidityPoolKeys
  }

  async getOwnerTokenAccounts() {
    const walletTokenAccount = await this.connection.getTokenAccountsByOwner(this.walletPublicKey, {
      programId: TOKEN_PROGRAM_ID,
    })

    return walletTokenAccount.value.map((i) => ({
      pubkey: i.pubkey,
      programId: i.account.owner,
      accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }))
  }

  async getSwapTransaction(
    toToken: string,
    // fromToken: string,
    amount: number,
    slippage: number,
    lp: LiquidityPoolKeys | { id: string },
    maxLamports: number = 100000,
    fixedSide: 'in' | 'out' = 'in',
    recentBlockhashForSwap: BlockhashWithExpiryBlockHeight
  ): Promise<VersionedTransaction> {
    const poolKeys = (typeof lp.id !== 'string' ? lp : jsonInfo2PoolKeys(lp)) as LiquidityPoolKeys
    const directionIn = poolKeys.quoteMint.toString() == toToken
    const slippagePercent = new Percent(slippage, 100) // slippage % 
    const { minAmountOut, amountIn } = await this.calcAmountOut(poolKeys, amount, slippagePercent, directionIn)
    logger.debug("amountIn:     %s, %s", amountIn.toFixed(), amountIn.token.symbol || '')
    logger.debug("minAmountOut: %s, %s", minAmountOut.toFixed(), minAmountOut.currency.symbol || '')
    const userTokenAccounts = await this.getOwnerTokenAccounts()
    const swapTransaction = await Liquidity.makeSwapInstructionSimple({
      connection: this.connection,
      makeTxVersion: 0,
      poolKeys: {
        ...poolKeys,
      },
      userKeys: {
        tokenAccounts: userTokenAccounts,
        owner: this.walletPublicKey,
      },
      amountIn: amountIn,
      amountOut: minAmountOut,
      fixedSide: fixedSide,
      config: {
        bypassAssociatedCheck: false,
      },
      computeBudgetConfig: {
        microLamports: maxLamports,
      },
    })

    const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean)

    const versionedTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: this.walletPublicKey,
        recentBlockhash: recentBlockhashForSwap.blockhash,
        instructions: instructions,
      }).compileToV0Message()
    )

    return versionedTransaction
  }

  async simulateTransaction(tx: VersionedTransaction) {
    return await this.connection.simulateTransaction(tx)
  }

  async calcAmountOut(poolKeys: LiquidityPoolKeys, rawAmountIn: number, slippage: Percent, swapInDirection: boolean) {
    const poolInfo = await Liquidity.fetchInfo({ connection: this.connection, poolKeys })

    let currencyInMint = poolKeys.baseMint
    let currencyInDecimals = poolInfo.baseDecimals
    let currencyOutMint = poolKeys.quoteMint
    let currencyOutDecimals = poolInfo.quoteDecimals

    if (!swapInDirection) {
      currencyInMint = poolKeys.quoteMint
      currencyInDecimals = poolInfo.quoteDecimals
      currencyOutMint = poolKeys.baseMint
      currencyOutDecimals = poolInfo.baseDecimals
    }

    const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
    const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
    const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)

    const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut,
      slippage,
    })

    return {
      amountIn,
      amountOut,
      minAmountOut,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
    }
  }
}
