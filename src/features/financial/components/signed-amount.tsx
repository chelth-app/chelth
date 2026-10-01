import { formatSignedMoney, invoiceDirectionLabel, payDeltaLabel } from "@/lib/domain/financial";

/**
 * A signed adjustment amount with a text label, so the meaning never depends
 * on colour: "+$11.32 Increase", "−$61.75 Credit".
 */
export function SignedAmount({
  minor,
  currency,
  side,
  direction,
}: {
  minor: number;
  currency: string;
  side: "pay" | "bill";
  direction?: string;
}) {
  const label =
    side === "pay"
      ? payDeltaLabel(minor)
      : invoiceDirectionLabel(
          direction ?? (minor > 0 ? "additional_charge" : minor < 0 ? "credit" : "no_net_change"),
        );
  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-medium tabular-nums">{formatSignedMoney(minor, currency)}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}
