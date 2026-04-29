export function resolvePaidUntilAfterDefaultEndDateChange(
  currentPaidUntilDate: string,
  nextDefaultEndDate: string,
) {
  return currentPaidUntilDate || nextDefaultEndDate;
}
