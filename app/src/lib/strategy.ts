function roundHalfUp(value: number) {
  return Math.floor(value + 0.5)
}

export function enterEligibleRankCutoff(regime: string, shortlistSize: number) {
  if (regime === 'risk_on') {
    return Math.max(1, roundHalfUp(shortlistSize * 0.1))
  }
  if (regime === 'risk_off') {
    return 3
  }
  return Math.max(1, roundHalfUp(shortlistSize * 0.05))
}
