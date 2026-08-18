import { BigCheckIcon } from "../../../components/theme/icons";
import { PrimaryButton, SecondaryButton } from "../../../components/theme/ui";

interface Props {
  onStart: () => void;
  onSkip: () => void;
}

export function WelcomeStep({ onStart, onSkip }: Props) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center text-center">
      <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
        <span className="pulse-ring absolute inset-0 rounded-full bg-onboard-accent-soft" />
        <span className="absolute inset-3 rounded-full bg-onboard-accent-soft" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-onboard-accent text-white">
          <BigCheckIcon />
        </span>
      </div>

      <span className="inline-flex items-center gap-2 rounded-full border border-onboard-accent/40 bg-onboard-accent/10 px-4 py-1.5 text-sm font-medium text-onboard-accent-hover">
        <span className="h-1.5 w-1.5 rounded-full bg-onboard-accent" />
        Installation Complete
      </span>

      <h1 className="mt-6 text-4xl font-bold tracking-tight text-onboard-ink">
        Ripple is installed and ready.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-onboard-muted">
        Hold Shift+Space and speak — cleaned-up text appears in whatever
        field you were typing in.
      </p>

      <div className="mt-8 flex w-full flex-col gap-3">
        <PrimaryButton withArrow onClick={onStart} className="w-full py-3.5">
          Set up your account
        </PrimaryButton>
        <SecondaryButton onClick={onSkip} className="w-full py-3.5">
          Skip setup - Explore first
        </SecondaryButton>
      </div>

      <p className="mt-6 text-xs text-onboard-subtle">
        You can complete setup any time from Settings.
      </p>
    </div>
  );
}
