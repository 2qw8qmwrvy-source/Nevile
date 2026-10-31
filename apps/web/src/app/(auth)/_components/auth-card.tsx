import type { ReactNode } from "react";
import { Card } from "@/components/ui/card.tsx";
import { Icon, type IconName } from "@/components/ui/icons.tsx";

type AuthCardProps = {
  eyebrow: string;
  icon?: IconName;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({
  eyebrow,
  icon = "leaf",
  title,
  description,
  children,
  footer,
}: AuthCardProps) {
  return (
    <>
      <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-[0.06em] text-season-ink uppercase">
        <Icon name={icon} size={18} />
        <span>{eyebrow}</span>
      </p>
      <h1 className="mt-2.5 font-display text-[32px] leading-[1.08] font-extrabold tracking-[-0.03em] text-balance sm:text-[38px]">
        {title}
      </h1>
      {description ? (
        <div className="mt-3 text-[16px] leading-[1.55] text-muted">{description}</div>
      ) : null}
      {children ? (
        <Card className="mt-6" padding="md">
          {children}
        </Card>
      ) : null}
      {footer ? <div className="mt-5 text-[15px] text-muted">{footer}</div> : null}
    </>
  );
}
