/** The refund "Paisa aa gaya - Refund banayein" queues, mirroring the backend (`PaymentService.acknowledge_payment`):
 * the amount the screenshot showed when OCR read one, otherwise the advance the player was asked for. Shown in the confirm
 * sheet so the owner sees exactly what will land in Refunds before it is created (docs/mobile-audit-2026-10.md P0-7). */
export function refundAmountFor(item: { ocr_amount: number | null; expected_amount: number }): number {
  return item.ocr_amount != null && item.ocr_amount > 0 ? item.ocr_amount : item.expected_amount;
}
