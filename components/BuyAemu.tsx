import { Button } from "./ui";
import { SOLANA, tokenLaunched } from "@/lib/solana";

/** Buy CTA that respects launch state: real pump.fun link only once live. */
export function BuyAemu({
  variant = "primary",
  label = "Get $AEMU",
}: {
  variant?: "primary" | "default";
  label?: string;
}) {
  if (!tokenLaunched()) {
    return (
      <Button variant="default" disabled>
        {label} · coming soon
      </Button>
    );
  }
  return (
    <a href={SOLANA.pumpUrl} target="_blank" rel="noopener noreferrer">
      <Button variant={variant}>{label} →</Button>
    </a>
  );
}
