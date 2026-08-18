import { useState } from "react";
import {
  BriefcaseIcon,
  BuildingIcon,
  LockIcon,
  MailIcon,
  PersonIcon,
  UsersIcon,
} from "../../../components/theme/icons";
import { Card, Field, PrimaryButton, Select, SecondaryButton, StepBadge, TextInput } from "../../../components/theme/ui";

export interface AccountDetails {
  fullName: string;
  email: string;
  organisation: string;
  role: string;
  teamSize: string;
}

interface Props {
  totalSteps: number;
  initialEmail: string;
  onContinue: (details: AccountDetails) => void;
  onSkip: () => void;
}

const ROLES = [
  "Founder / Executive",
  "Product / Design",
  "Engineering",
  "Operations",
  "Sales / Marketing",
  "Other",
];

const TEAM_SIZES = ["Just me", "2-10", "11-50", "51-200", "200+"];

export function AccountStep({ totalSteps, initialEmail, onContinue, onSkip }: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [organisation, setOrganisation] = useState("");
  const [role, setRole] = useState("");
  const [teamSize, setTeamSize] = useState("");

  return (
    <div className="mx-auto max-w-xl">
      <StepBadge step={1} total={totalSteps} label="Your account" />
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-onboard-ink">
        Let's get your account set up.
      </h1>
      <p className="mt-2 text-base text-onboard-muted">
        Just the basics. You can add more detail later.
      </p>

      <Card className="mt-8">
        <div className="flex flex-col gap-5">
          <Field label="Full Name">
            <TextInput
              icon={<PersonIcon />}
              placeholder="Your full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
          </Field>

          <Field label="Email Address">
            <TextInput
              icon={<MailIcon />}
              type="email"
              placeholder="Your work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Organisation / Company">
            <TextInput
              icon={<BuildingIcon />}
              placeholder="Your organisation or team name"
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Role">
              <Select
                icon={<BriefcaseIcon />}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">Select role...</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Team Size">
              <Select
                icon={<UsersIcon />}
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
              >
                <option value="">Select size...</option>
                {TEAM_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-onboard-border-soft pt-6">
          <SecondaryButton onClick={onSkip}>Skip for Now</SecondaryButton>
          <PrimaryButton
            withArrow
            onClick={() =>
              onContinue({ fullName, email, organisation, role, teamSize })
            }
          >
            Continue
          </PrimaryButton>
        </div>
      </Card>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-onboard-subtle">
        <LockIcon />
        This information stays on your device. It's used to personalise your
        experience — not shared externally.
      </p>
    </div>
  );
}
