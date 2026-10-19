/**
 * useMainnetDeploy — deploys BreachSLA.sol to Arc Mainnet via the user's connected wallet.
 *
 * Flow:
 *  1. Switch to Arc Mainnet (chain 5042) if not already on it.
 *  2. Call walletClient.deployContract with the compiled ABI + bytecode.
 *  3. Wait for receipt, extract contractAddress.
 *  4. Persist address in localStorage so the whole app picks it up immediately.
 */

import { useState, useCallback } from 'react'
import { useWalletClient, usePublicClient, useSwitchChain } from 'wagmi'
import { BREACH_SLA_BYTECODE } from '../breach-bytecode'
import { BREACH_SLA_ABI, ARC_MAINNET_CHAIN_ID, setMainnetAddress } from '../breach-contract'

export type DeployState =
  | { status: 'idle' }
  | { status: 'switching' }
  | { status: 'deploying' }
  | { status: 'confirming'; txHash: `0x${string}` }
  | { status: 'success'; txHash: `0x${string}`; contractAddress: `0x${string}` }
  | { status: 'error'; message: string }

export function useMainnetDeploy() {
  const [state, setState] = useState<DeployState>({ status: 'idle' })
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID })
  const { switchChainAsync } = useSwitchChain()

  const deploy = useCallback(async () => {
    if (!walletClient) { setState({ status: 'error', message: 'No wallet connected.' }); return }

    try {
      // Step 1: ensure we are on Arc Mainnet
      if (walletClient.chain.id !== ARC_MAINNET_CHAIN_ID) {
        setState({ status: 'switching' })
        await switchChainAsync({ chainId: ARC_MAINNET_CHAIN_ID })
      }

      // Step 2: send deployment transaction
      setState({ status: 'deploying' })
      const txHash = await walletClient.deployContract({
        abi: BREACH_SLA_ABI,
        bytecode: BREACH_SLA_BYTECODE,
        chain: walletClient.chain,
        account: walletClient.account,
      })

      // Step 3: wait for receipt
      setState({ status: 'confirming', txHash })
      if (!publicClient) throw new Error('Public client unavailable.')
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

      if (!receipt.contractAddress) throw new Error('Receipt missing contractAddress.')

      // Step 4: persist and update state
      const deployed = receipt.contractAddress
      setMainnetAddress(deployed)
      setState({ status: 'success', txHash, contractAddress: deployed })

    } catch (err) {
      const msg = (err as { message?: string })?.message ?? ''
      if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('user denied')) {
        setState({ status: 'error', message: 'Transaction cancelled.' })
      } else {
        setState({ status: 'error', message: msg.slice(0, 120) || 'Deployment failed.' })
      }
    }
  }, [walletClient, publicClient, switchChainAsync])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, deploy, reset }
}
