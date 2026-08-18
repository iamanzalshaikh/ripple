import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { ArrowRightIcon, BackArrowIcon, ChevronDownIcon, KebabIcon, LogoMarkIcon, ShieldIcon } from "./icons";

export function RippleWordmark({ size = "text-xl" }: { size?: string }) {
  return (
    <div className="flex items-center gap-2 text-onboard-ink">
      <LogoMarkIcon />
      <span
        className={`${size} italic`}
        style={{ fontFamily: "var(--font-onboard-serif)" }}
      >
        Ripple
      </span>
    </div>
  );
}

export function TopBar({ right }: { right?: ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-onboard-border-soft px-6">
      <RippleWordmark />
      <div className="flex items-center gap-4 text-onboard-ink">
        {right ?? (
          <>
            <ShieldIcon />
            <KebabIcon />
          </>
        )}
      </div>
    </header>
  );
}

export const OnboardingHeader = TopBar;

/** Full-width app page shell (dashboard, settings pages) — top-aligned and scrollable, unlike the onboarding PageShell which centers a single card. */
export function AppShell({
  children,
  headerRight,
}: {
  children: ReactNode;
  headerRight?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-onboard-bg">
      <TopBar right={headerRight} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

export function BackLink({
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 text-sm font-medium text-onboard-accent-hover transition hover:underline ${className}`}
      {...rest}
    >
      <BackArrowIcon />
      {children}
    </button>
  );
}

export function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-onboard-border-soft px-8 py-6">
      <div>
        {onBack ? (
          <BackLink onClick={onBack} className="mb-2">
            {backLabel}
          </BackLink>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-onboard-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-onboard-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function NavPill({
  active,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-onboard-accent bg-onboard-accent/10 text-onboard-accent-hover"
          : "border-onboard-border bg-onboard-surface text-onboard-ink hover:border-onboard-accent/40"
      } ${className}`}
      {...rest}
    />
  );
}

export function StatusDot({
  tone = "neutral",
  pulse = false,
}: {
  tone?: "ok" | "warn" | "err" | "neutral";
  pulse?: boolean;
}) {
  const color =
    tone === "ok"
      ? "bg-onboard-success"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "err"
          ? "bg-red-500"
          : "bg-onboard-subtle";
  return (
    <span
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`}
    />
  );
}

export function StepBadge({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-onboard-accent/40 bg-onboard-accent/10 px-4 py-1.5 text-sm font-medium text-onboard-accent-hover">
      <span className="h-1.5 w-1.5 rounded-full bg-onboard-accent" />
      Step {step} of {total} - {label}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-onboard-border bg-onboard-card p-8 ${className}`}
    >
      {children}
    </div>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  withArrow?: boolean;
}

export function PrimaryButton({ children, withArrow, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-onboard-accent px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-onboard-accent/20 transition hover:bg-onboard-accent-hover disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
      {withArrow ? <ArrowRightIcon /> : null}
    </button>
  );
}

export function SecondaryButton({ children, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-onboard-border bg-onboard-surface px-6 py-3 text-sm font-medium text-onboard-ink transition hover:border-onboard-accent/40 hover:bg-onboard-card-soft disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostLink({ children, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`text-sm text-onboard-muted underline-offset-4 transition hover:text-onboard-ink hover:underline ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
}

export function Field({ label, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-onboard-ink">
      {label}
      {children}
    </label>
  );
}

export function TextInput({
  icon,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-onboard-subtle">
          {icon}
        </span>
      ) : null}
      <input
        className={`w-full rounded-xl border border-onboard-border bg-onboard-surface py-3 text-sm text-onboard-ink placeholder:text-onboard-subtle outline-none transition focus:border-onboard-accent focus:ring-2 focus:ring-onboard-accent/20 ${icon ? "pl-10 pr-3" : "px-3"} ${className}`}
        {...rest}
      />
    </div>
  );
}

export function Select({
  icon,
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { icon?: ReactNode }) {
  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-onboard-subtle">
          {icon}
        </span>
      ) : null}
      <select
        className={`w-full appearance-none rounded-xl border border-onboard-border bg-onboard-surface py-3 pr-9 text-sm text-onboard-ink outline-none transition focus:border-onboard-accent focus:ring-2 focus:ring-onboard-accent/20 ${icon ? "pl-10" : "px-3"} ${className}`}
        {...rest}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-onboard-subtle">
        <ChevronDownIcon />
      </span>
    </div>
  );
}

export function Divider() {
  return <div className="my-6 border-t border-onboard-border-soft" />;
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
        checked ? "bg-onboard-accent" : "bg-onboard-border"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-onboard-bg">
      <OnboardingHeader />
      <main className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}
