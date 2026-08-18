import { BigCheckIcon } from "../../../components/theme/icons";
import { PrimaryButton } from "../../../components/theme/ui";

interface Props {
  onOpen: () => void;
}

export function FinishStep({ onOpen }: Props) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center text-center">
      <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
        <span className="pulse-ring absolute inset-0 rounded-full bg-onboard-success-soft" />
        <span className="absolute inset-3 rounded-full bg-onboard-success-soft" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-onboard-success text-white">
          <BigCheckIcon />
        </span>
      </div>

      <span className="inline-flex items-center gap-2 rounded-full border border-onboard-success/40 bg-onboard-success/10 px-4 py-1.5 text-sm font-medium text-onboard-success">
        <span className="h-1.5 w-1.5 rounded-full bg-onboard-success" />
        Setup Complete
      </span>

      <h1 className="mt-6 text-4xl font-bold tracking-tight text-onboard-ink">
        You're all set, ready to go.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-onboard-muted">
        Hold Shift+Space anywhere to dictate. F9 rewrites selected text. Open
        Ripple from the tray for notes, snippets, and dictionary.
      </p>

      <PrimaryButton withArrow onClick={onOpen} className="mt-8 w-full py-3.5">
        Open Ripple
      </PrimaryButton>
    </div>
  );
}
