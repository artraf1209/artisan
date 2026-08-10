export function enterEligibleRankCutoff(regime: string, shortlistSize: number) {
  if (regime === 'risk_on') {
    return Math.max(1, Math.round(shortlistSize * 0.1))
  }
  if (regime === 'risk_off') {
    return 3
  }
  return Math.max(1, Math.round(shortlistSize * 0.05))
}
