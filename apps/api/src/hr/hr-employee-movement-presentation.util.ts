type HistoricalMovement = Readonly<{ sourceReference: string; description: string | null }>;

/**
 * Employee files must be readable even when a legacy movement cannot be
 * joined back to every modern financial relation. Noorix descriptions retain
 * the human-facing document number, so use it for display without adding a
 * second database lookup to the employee-detail request.
 */
export function employeeMovementReference(movement: HistoricalMovement): string {
  const documentNumber = movement.description?.match(/\b([A-Z]{2,}(?:-[A-Z0-9]{2,}){1,})\b/i)?.[1];
  return documentNumber ?? movement.sourceReference;
}
