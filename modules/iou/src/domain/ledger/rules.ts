/** Limits shared by the ledger modules. supabase/schema.sql enforces the same values. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000
export const MAX_MEMBERS = 100
export const MAX_TRANSACTIONS = 5_000

export function fail(message: string): never {
  throw new Error(message)
}
