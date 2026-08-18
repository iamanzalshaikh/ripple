import { useState, type ReactNode } from "react";
import { KeyboardIcon, MinimizeIcon, PowerIcon, TrayIcon } from "../../../components/theme/icons";
import { Card, Divider, PrimaryButton, StepBadge, ToggleSwitch } from "../../../components/theme/ui";

interface Props {
  totalSteps: number;
  onFinish: () => void;
}

interface Pref {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
  defaultOn: boolean;
}

const PREFS: Pref[] = [
  {
    id: "startup",
    name: "Launch Ripple at startup",
    description: "Have Ripple ready as soon as you log in to Windows.",
    icon: <PowerIcon />,
    defaultOn: true,
  },
  {
    id: "hotkey",
    name: "Global hotkey",
    description: "Hold Shift + Space anywhere to start dictating.",
    icon: <KeyboardIcon />,
    defaultOn: true,
  },
  {
    id: "tray",
    name: "Show tray icon",
    description: "Keep quick access to Ripple in the system tray.",
    icon: <TrayIcon />,
    defaultOn: true,
  },
  {
    id: "minimized",
    name: "Start minimized",
    description: "Open straight to the tray instead of the main window.",
    icon: <MinimizeIcon />,
    defaultOn: false,
  },
];

export function PreferencesStep({ totalSteps, onFinish }: Props) {
  const [values, setValues] = useState<Record<string, boolean>>(
    Object.fromEntries(PREFS.map((p) => [p.id, p.defaultOn])),
  );

  return (
    <div className="mx-auto max-w-2xl">
      <StepBadge step={6} total={totalSteps} label="Preferences" />
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-onboard-ink">
        A couple of last preferences.
      </h1>
      <p className="mt-2 text-base text-onboard-muted">
        Sensible defaults are already on. Change anything you like — all of
        this lives in Settings too.
      </p>

      <Card className="mt-8">
        <div className="flex flex-col divide-y divide-onboard-border-soft">
          {PREFS.map((pref) => (
            <div key={pref.id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-onboard-surface text-onboard-ink">
                {pref.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-onboard-ink">
                  {pref.name}
                </p>
                <p className="text-sm text-onboard-muted">
                  {pref.description}
                </p>
              </div>
              <ToggleSwitch
                checked={values[pref.id] ?? false}
                onChange={(next) =>
                  setValues((prev) => ({ ...prev, [pref.id]: next }))
                }
                label={pref.name}
              />
            </div>
          ))}
        </div>

        <Divider />

        <div className="flex justify-end">
          <PrimaryButton withArrow onClick={onFinish}>
            Finish setup
          </PrimaryButton>
        </div>
      </Card>
    </div>
  );
}
