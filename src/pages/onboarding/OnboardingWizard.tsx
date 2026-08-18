import { useState } from "react";
import { PageShell } from "../../components/theme/ui";
import { WelcomeStep } from "./steps/WelcomeStep";
import { AccountStep } from "./steps/AccountStep";
import { MicrophoneStep } from "./steps/MicrophoneStep";
import { VoiceCalibrationStep } from "./steps/VoiceCalibrationStep";
import { FirstCommandStep } from "./steps/FirstCommandStep";
import { IntegrationsStep } from "./steps/IntegrationsStep";
import { PreferencesStep } from "./steps/PreferencesStep";
import { FinishStep } from "./steps/FinishStep";

type StepId =
  | "welcome"
  | "account"
  | "microphone"
  | "calibration"
  | "first-command"
  | "integrations"
  | "preferences"
  | "finish";

const TOTAL_NUMBERED_STEPS = 6;

interface Props {
  email: string;
  onDone: () => void;
}

export function OnboardingWizard({ email, onDone }: Props) {
  const [step, setStep] = useState<StepId>("welcome");

  return (
    <PageShell>
      {step === "welcome" ? (
        <WelcomeStep onStart={() => setStep("account")} onSkip={onDone} />
      ) : null}

      {step === "account" ? (
        <AccountStep
          totalSteps={TOTAL_NUMBERED_STEPS}
          initialEmail={email}
          onContinue={() => setStep("microphone")}
          onSkip={() => setStep("microphone")}
        />
      ) : null}

      {step === "microphone" ? (
        <MicrophoneStep
          totalSteps={TOTAL_NUMBERED_STEPS}
          onContinue={() => setStep("calibration")}
          onSkip={() => setStep("calibration")}
        />
      ) : null}

      {step === "calibration" ? (
        <VoiceCalibrationStep
          totalSteps={TOTAL_NUMBERED_STEPS}
          onContinue={() => setStep("first-command")}
          onSkip={() => setStep("first-command")}
        />
      ) : null}

      {step === "first-command" ? (
        <FirstCommandStep
          totalSteps={TOTAL_NUMBERED_STEPS}
          onContinue={() => setStep("integrations")}
          onExplore={() => setStep("integrations")}
        />
      ) : null}

      {step === "integrations" ? (
        <IntegrationsStep
          totalSteps={TOTAL_NUMBERED_STEPS}
          onContinue={() => setStep("preferences")}
          onSkip={() => setStep("preferences")}
        />
      ) : null}

      {step === "preferences" ? (
        <PreferencesStep
          totalSteps={TOTAL_NUMBERED_STEPS}
          onFinish={() => setStep("finish")}
        />
      ) : null}

      {step === "finish" ? <FinishStep onOpen={onDone} /> : null}
    </PageShell>
  );
}
