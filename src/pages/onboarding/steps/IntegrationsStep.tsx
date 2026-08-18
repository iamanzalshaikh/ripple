import { useState, type ReactNode } from "react";
import { GmailGlyph, NotionGlyph, SlackGlyph, WhatsAppGlyph } from "../../../components/theme/icons";
import { Card, Divider, GhostLink, PrimaryButton, StepBadge, ToggleSwitch } from "../../../components/theme/ui";

interface Props {
  totalSteps: number;
  onContinue: () => void;
  onSkip: () => void;
}

interface Tool {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
}

const TOOLS: Tool[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Draft, send, and search email by voice.",
    icon: <GmailGlyph />,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Post updates and catch up on channels.",
    icon: <SlackGlyph />,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Create and update pages hands-free.",
    icon: <NotionGlyph />,
  },
  {
    id: "whatsapp",
    name: "WhatsApp Web",
    description: "Send messages without touching your phone.",
    icon: <WhatsAppGlyph />,
  },
];

export function IntegrationsStep({ totalSteps, onContinue, onSkip }: Props) {
  const [connected, setConnected] = useState<Record<string, boolean>>({});

  return (
    <div className="mx-auto max-w-2xl">
      <StepBadge step={5} total={totalSteps} label="Connect your tools" />
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-onboard-ink">
        Connect the apps you work in.
      </h1>
      <p className="mt-2 text-base text-onboard-muted">
        Optional — Ripple can control these once you're signed in. You can
        add more anytime from Settings.
      </p>

      <Card className="mt-8">
        <div className="flex flex-col divide-y divide-onboard-border-soft">
          {TOOLS.map((tool) => (
            <div key={tool.id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-onboard-surface text-onboard-ink">
                {tool.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-onboard-ink">
                  {tool.name}
                </p>
                <p className="truncate text-sm text-onboard-muted">
                  {tool.description}
                </p>
              </div>
              <ToggleSwitch
                checked={connected[tool.id] ?? false}
                onChange={(next) =>
                  setConnected((prev) => ({ ...prev, [tool.id]: next }))
                }
                label={`Connect ${tool.name}`}
              />
            </div>
          ))}
        </div>

        <Divider />

        <div className="flex items-center justify-between">
          <GhostLink onClick={onSkip}>
            Skip — I'll connect these later
          </GhostLink>
          <PrimaryButton withArrow onClick={onContinue}>
            Continue
          </PrimaryButton>
        </div>
      </Card>
    </div>
  );
}
