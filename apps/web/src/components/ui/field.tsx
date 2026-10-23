import {
  Children,
  cloneElement,
  type InputHTMLAttributes,
  isValidElement,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
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

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(control, "h-auto min-h-28 resize-y px-3.5 py-3 leading-relaxed", className)}
      {...rest}
    />
  );
}

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  error?: ReactNode;
};

/**
 * Checkbox with its label as one large tap target (at least 44px tall). Never pass
 * `defaultChecked` for consent boxes: CASL consent must be an active choice (SPEC §17).
 */
export function Checkbox({ label, description, error, className, id, ...rest }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `checkbox-${generated}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-input py-1.5 text-[15px] leading-snug"
      >
        <input
          id={inputId}
          type="checkbox"
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-5 flex-none cursor-pointer rounded-[6px] accent-primary"
          {...rest}
        />
        <span>
          <span className="block text-ink">{label}</span>
          {description ? (
            <span id={descriptionId} className="mt-0.5 block text-sm text-muted">
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p id={errorId} className="mt-1 ml-8 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
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
