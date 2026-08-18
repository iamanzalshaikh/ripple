import { Card, Divider, PrimaryButton, SecondaryButton, StepBadge } from "../../../components/theme/ui";

interface Props {
  totalSteps: number;
  onContinue: () => void;
  onExplore: () => void;
}

export function FirstCommandStep({ totalSteps, onContinue, onExplore }: Props) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="text-center">
        <StepBadge step={4} total={totalSteps} label="Your first dictation" />
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-onboard-ink">
          Click a text field, then hold Shift+Space.
        </h1>
        <p className="mt-2 text-base text-onboard-muted">
          Speak a sentence. Release the keys. Ripple types it for you — WhatsApp,
          Chrome, Notepad, Cursor.
        </p>

        <div className="mt-8 rounded-2xl border border-onboard-border bg-onboard-surface px-6 py-5 text-left text-sm text-onboard-ink">
          <p className="font-medium">Try this once setup finishes:</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-onboard-muted">
            <li>Open Notepad or a chat box.</li>
            <li>
              Hold{" "}
              <kbd className="rounded border border-onboard-border px-1.5 py-0.5 text-xs">
                Shift
              </kbd>{" "}
              +{" "}
              <kbd className="rounded border border-onboard-border px-1.5 py-0.5 text-xs">
                Space
              </kbd>
            </li>
            <li>Say “Hello, how are you?” and release.</li>
          </ol>
        </div>

        <Divider />

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <PrimaryButton withArrow onClick={onContinue}>
            Continue setup
          </PrimaryButton>
          <SecondaryButton onClick={onExplore}>
            I&apos;ll explore from here
          </SecondaryButton>
        </div>
      </Card>
    </div>
  );
}
