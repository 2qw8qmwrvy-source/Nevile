import {
  Children,
  cloneElement,
  type InputHTMLAttributes,
  isValidElement,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  useId,
} from "react";
import { cn } from "@/lib/cn.ts";
import { ChevronDownIcon, Icon, type IconName } from "./icons.tsx";

const control =
  "block w-full h-12 rounded-input border border-field bg-surface text-ink text-[15px] " +
  "transition-colors duration-150 hover:border-ink focus:border-primary " +
  "disabled:cursor-not-allowed disabled:bg-ground disabled:text-muted " +
  "aria-invalid:border-danger";

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor via rest props.
    <label
      className={cn("mb-1.5 ml-0.5 block text-[13px] font-semibold text-ink", className)}
      {...rest}
    >
      {children}
    </label>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Decorative leading icon. */
  icon?: IconName;
};

export function Input({ className, icon, type = "text", ...rest }: InputProps) {
  if (!icon) {
    return <input type={type} className={cn(control, "px-3.5", className)} {...rest} />;
  }
  return (
    <div className="relative">
      <Icon
        name={icon}
        size={18}
        className="pointer-events-none absolute top-[15px] left-3.5 text-muted"
      />
      <input type={type} className={cn(control, "pr-3.5 pl-10", className)} {...rest} />
    </div>
  );
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { icon?: IconName };

export function Select({ className, icon, children, ...rest }: SelectProps) {
  return (
    <div className="relative">
      {icon ? (
        <Icon
          name={icon}
          size={18}
          className="pointer-events-none absolute top-[15px] left-3.5 text-muted"
        />
      ) : null}
      <select
        className={cn(
          control,
          "cursor-pointer appearance-none pr-10 font-medium",
          icon ? "pl-10" : "pl-3.5",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDownIcon
        size={18}
        className="pointer-events-none absolute top-[15px] right-3.5 text-muted"
      />
    </div>
  );
}

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  required?: boolean;
};

export type FieldProps = {
  label: ReactNode;
  /** A single Input, Select or textarea element; it receives id and ARIA wiring. */
  children: ReactElement<ControlProps>;
  hint?: ReactNode;
  error?: ReactNode;
  /** Explicit id for the control; generated when omitted. */
  id?: string;
  className?: string;
};

/**
 * Label + control + hint/error. Wires `id`, `aria-describedby` and `aria-invalid` onto the
 * child control so screen readers announce the hint and error with the field.
 */
export function Field({ label, children, hint, error, id, className }: FieldProps) {
  const generated = useId();
  const child = Children.only(children);
  const controlId = id ?? child.props.id ?? `field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [child.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(child)
    ? cloneElement(child, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : child.props["aria-invalid"],
      })
    : child;

  return (
    <div className={className}>
      <Label htmlFor={controlId}>{label}</Label>
      {control}
      {hint ? (
        <p id={hintId} className="mt-1.5 ml-0.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 ml-0.5 flex items-start gap-1.5 text-sm font-medium text-danger"
        >
          <Icon name="warning" size={16} className="mt-0.5 flex-none" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
