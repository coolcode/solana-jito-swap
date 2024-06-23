import { Keypair, Connection } from '@solana/web3.js'
import bs58 from 'bs58'
import dotenv from 'dotenv'
dotenv.config()
import { logger } from './transactions/log'
import { RaydiumSwap } from './transactions/raydium'
import { DefaultTransactionExecutor } from './transactions/default-executor'
import { JitoTransactionExecutor } from './transactions/jito-executor'
import { jsonInfo2PoolKeys } from '@raydium-io/raydium-sdk'


const RPC_ENDPOINT = "https://api.mainnet-beta.solana.com"
const RPC_WEBSOCKET_ENDPOINT = "wss://api.mainnet-beta.solana.com"
const COMMITMENT_LEVEL = "confirmed"

const swap = async (config: any) => {
  logger.info('starting...')


  const connection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
    commitment: COMMITMENT_LEVEL,
  })

  const wallet = Keypair.fromSecretKey(bs58.decode((config.walletPrivateKey)))

  const raydiumSwap = new RaydiumSwap(connection, wallet.publicKey)
  logger.info(`Swapping ${config.tokenAAmount} of ${config.tokenAAddress} for ${config.tokenBAddress}...`)

  // const poolInfo = raydiumSwap.findPoolInfo(config.tokenAAddress, config.tokenBAddress)
  // if (!poolInfo) {
  //   logger.error('Pool info not found')
  //   return
  // }

  // logger.info('Found pool info: %s', poolInfo.programId.toBase58())
  const poolInfo =  { "id": "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", "baseMint": "So11111111111111111111111111111111111111112", "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "lpMint": "8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu", "baseDecimals": 9, "quoteDecimals": 6, "lpDecimals": 9, "version": 4, "programId": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "authority": "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", "openOrders": "HmiHHzq4Fym9e1D4qzLS6LDDM3tNsCTBPDWHTLZ763jY", "targetOrders": "CZza3Ej4Mc58MnxWA385itCC9jCo3L1D7zc3LKy1bZMR", "baseVault": "DQyrAcCrDXQ7NeoqGgDCZwBvWDcYmFCjSb9JtteuvPpz", "quoteVault": "HLmqeL62xR1QoZ1HKKbXRrdN1p3phKpxRMb2VVopvBBz", "withdrawQueue": "11111111111111111111111111111111", "lpVault": "11111111111111111111111111111111", "marketVersion": 4, "marketProgramId": "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX", "marketId": "8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6", "marketAuthority": "CTz5UMLQm2SRWHzQnU62Pi4yJqbNGjgRBHqqp6oDHfF7", "marketBaseVault": "CKxTHwM9fPMRRvZmFnFoqKNd9pQR21c5Aq9bh5h9oghX", "marketQuoteVault": "6A5NHCj1yF6urc9wZNe6Bcjj4LVszQNj5DwAWG97yzMu", "marketBids": "5jWUncPNBMZJ3sTHKmMLszypVkoRK6bfEQMQUHweeQnh", "marketAsks": "EaXdHx7x3mdGA38j5RSmKYSXMzAFzzUXCLNBEDXDn1d5", "marketEventQueue": "8CvwxZ9Db6XbLD46NZwwmVDZZRDy7eydFcAGkXKh9axa", "lookupTableAccount": "3q8sZGGpPESLxurJjNmr7s7wcKS5RPCCHMagbuHP9U2W" }

  const latestBlockhash = await connection.getLatestBlockhash('processed')

  logger.debug("latest block, height: %s hash: %s", latestBlockhash.lastValidBlockHeight, latestBlockhash.blockhash)

  // Prepare the swap transaction with the given parameters. 
  const tx = await raydiumSwap.getSwapTransaction(
    config.tokenBAddress,
    config.tokenAAmount,
    config.slippage,
    poolInfo,
    config.maxLamports,
    config.direction,
    latestBlockhash
  )
  tx.sign([wallet])
  // logger.debug(tx, 'tx:')

  // Depending on the configuration, execute or simulate the swap.
  switch (config.mode) {
    case "simulate":
      const simRes = await raydiumSwap.simulateTransaction(tx)
      logger.info(simRes, "simulated.")
      break

    case "send":
    case "jito":
      logger.debug("executor: %s", config.mode)
      const executor = config.mode == "send" ?
        new DefaultTransactionExecutor(connection) :
        new JitoTransactionExecutor(config.jitoTips, connection)

      logger.info("executing and confirming...")
      const { confirmed, signature } = await executor.executeAndConfirm(tx, wallet, latestBlockhash)
      logger.info(`confirmed: ${confirmed}`)
      if (confirmed) {
        logger.info(`https://solscan.io/tx/${signature}`)
      }
      break

    default:
      break
  }
}


async function main() {
  logger.level = 'trace'
  const walletPrivateKey = (process.env.PRIVATE_KEY || '').trim()
  if (!walletPrivateKey) {
    logger.error("PRIVATE_KEY is empty")
    return
  }

  const config = {
    walletPrivateKey,
    mode: 'jito' as "simulate" | "send" | "jito", // simulate, send, jito sendBundle
    tokenAAmount: 0.1, // Swap 0.1 SOL for USDC in this example
    tokenAAddress: "So11111111111111111111111111111111111111112", // Token to swap for the other, SOL in this case
    tokenBAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC address
    slippage: 5, // 5% slippage
    maxLamports: 1500000, // Micro lamports for priority fee
    direction: "in" as "in" | "out", // Swap direction: 'in' or 'out'
    jitoTips: 0.00001, // SOL. jito's tips.
    maxRetries: 20,
  }

  await swap(config)

}

main().catch(logger.error)