type FactorScoreLike = {
  symbol: string
  rank: number | null
  composite_z: number | null
  hard_filter_pass: boolean
}

type EntrySignalLike = {
  symbol: string
  actionable: boolean
}

function actionableSort<T extends FactorScoreLike>(left: T, right: T) {
  const leftComposite = left.composite_z ?? Number.NEGATIVE_INFINITY
  const rightComposite = right.composite_z ?? Number.NEGATIVE_INFINITY
  if (leftComposite !== rightComposite) {
    return rightComposite - leftComposite
  }

  const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER
  const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  return left.symbol.localeCompare(right.symbol)
}

export function buildActionableShortlistRows<T extends FactorScoreLike>(
  factorRows: T[],
  entryRows: EntrySignalLike[],
  shortlistSize: number,
): Array<T & { shortlistRank: number }> {
  const actionableSymbols = new Set(
    entryRows.filter((row) => row.actionable).map((row) => row.symbol),
  )

  return factorRows
    .filter(
      (row) =>
        row.hard_filter_pass &&
        row.rank != null &&
        actionableSymbols.has(row.symbol),
    )
    .sort(actionableSort)
    .slice(0, shortlistSize)
    .map((row, index) => ({
      ...row,
      shortlistRank: index + 1,
    }))
}
