import type { Group } from '../domain/groups/types'
import { getBalances, getSettlements } from '../domain/ledger/calculations'
import { compareTransactions } from '../domain/ledger/transactions'

/** Remember a function's result for each input object: a refresh that leaves a group unchanged recomputes nothing. */
export function memoizeByObject<K extends object, V>(compute: (key: K) => V): (key: K) => V {
  const results = new WeakMap<K, V>()
  return key => {
    if (!results.has(key)) results.set(key, compute(key))
    return results.get(key) as V
  }
}

export const balancesOf = memoizeByObject(getBalances)
export const settlementsOf = memoizeByObject(getSettlements)
export const newestFirst = memoizeByObject((group: Group) => [...group.transactions].sort(compareTransactions))
