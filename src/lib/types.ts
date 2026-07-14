/** Shared domain types. Extend as the tool grows. */

export interface Token {
  address: string
  symbol: string
  price: number
  mcap: number
  volume5m: number
  change5m: number
}
