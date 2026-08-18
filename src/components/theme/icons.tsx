import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function LogoMarkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} {...base} {...props}>
      <path d="M4 18v-4M9 18V9M14 18v-7M19 18V6" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
    </svg>
  );
}

export function KebabIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="currentColor"
      {...props}
    >
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} {...base} {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3M9 21h6" />
    </svg>
  );
}

export function MicOffIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} {...base} {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" opacity={0.5} />
      <path d="M5 11a7 7 0 0 0 11.9 5" opacity={0.5} />
      <path d="M12 18v3M9 21h6" opacity={0.5} />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <rect x="5" y="3.5" width="10" height="17" rx="1" />
      <path d="M9 8h2M9 11.5h2M9 15h2M16 11h3v9.5h-3z" />
    </svg>
  );
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <rect x="3.5" y="7.5" width="17" height="11.5" rx="2" />
      <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
      <path d="M3.5 12.5h17" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M15.3 14.2c2 .2 3.5 1.8 4.2 4.8" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} {...base} {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} {...base} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} {...base} {...props}>
      <rect x="5" y="10.5" width="14" height="9" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} {...base} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function BigCheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={44} height={44} {...base} strokeWidth={2.2} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function WaveformIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} {...base} {...props}>
      <path d="M3 12v0M6.5 8v8M10 4v16M13.5 8v8M17 6v12M20.5 10v4" />
    </svg>
  );
}

export function HelpCircleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.3.9-1.3 1.8v.3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function ArrowExternalIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} {...base} {...props}>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function GmailGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} {...base} {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
    </svg>
  );
}

export function SlackGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} {...base} {...props}>
      <rect x="9" y="3" width="3" height="7" rx="1.5" />
      <rect x="12" y="14" width="3" height="7" rx="1.5" />
      <rect x="14" y="9" width="7" height="3" rx="1.5" />
      <rect x="3" y="12" width="7" height="3" rx="1.5" />
    </svg>
  );
}

export function NotionGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} {...base} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M8 8v8M8 8l7 8V8" />
    </svg>
  );
}

export function WhatsAppGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} {...base} {...props}>
      <path d="M6 19l-1.4 3.1L8 20.6A8.5 8.5 0 1 0 4.5 17L6 19z" />
      <path d="M8.5 8.7c.3-.6 1.5-.6 1.8 0 .3.6.9 1.9.6 2.4-.3.5-1 .8-.7 1.4.4.8 1.7 2 2.6 2.4.6.3.9-.4 1.4-.7.5-.3 1.8.3 2.4.6.6.3.6 1.5 0 1.8-1.4.8-3.3.3-5.4-1.8-2.1-2.1-2.6-4-1.7-6.1z" />
    </svg>
  );
}

export function PowerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <path d="M12 3v8" />
      <path d="M6.5 6.5a8 8 0 1 0 11 0" />
    </svg>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h10" />
    </svg>
  );
}

export function TrayIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 14h4l1.5 2.5h6L16.5 14h4" />
    </svg>
  );
}

export function BackArrowIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} {...base} {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} {...base} {...props}>
      <path d="M20 11a8 8 0 1 0-2.6 6.1" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} {...base} {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

export function MinimizeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} {...base} {...props}>
      <path d="M8 3v4a1 1 0 0 1-1 1H3M16 3v4a1 1 0 0 0 1 1h4M8 21v-4a1 1 0 0 0-1-1H3M16 21v-4a1 1 0 0 1 1-1h4" />
    </svg>
  );
}
