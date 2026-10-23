import { MARKETING_CONSENT_SENDER, MARKETING_CONSENT_STATEMENT } from "@nevile/core";
import { Checkbox } from "@/components/ui/field.tsx";

/**
 * Optional CASL marketing consent (SPEC §17). Always starts unticked; the server records
 * the consent text version and time only when the box is ticked.
 */
export function MarketingConsent({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      name="marketingConsent"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      label={`${MARKETING_CONSENT_STATEMENT} (optional)`}
      description={MARKETING_CONSENT_SENDER}
    />
  );
}
