const iconUrls = import.meta.glob("../assets/browser-icons/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const iconByKey: Record<string, string> = {};
for (const [path, url] of Object.entries(iconUrls)) {
  const match = path.match(/([^/]+)\.(?:svg|png)$/);
  if (match) iconByKey[match[1]] = url;
}

interface BrowserIconProps {
  iconKey?: string | null;
  name: string;
}

export function BrowserIcon({ iconKey, name }: BrowserIconProps) {
  const src = iconKey ? iconByKey[iconKey] : undefined;

  if (src) {
    return <img className="browser-icon" src={src} alt="" aria-hidden="true" width={18} height={18} />;
  }

  return (
    <svg
      className="browser-icon"
      viewBox="0 0 18 18"
      width={18}
      height={18}
      aria-hidden="true"
      role="img"
      aria-label={name}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      style={{ color: "var(--dim)" }}
    >
      <rect x="1.5" y="2.5" width="15" height="13" rx="2" />
      <line x1="1.5" y1="6" x2="16.5" y2="6" />
    </svg>
  );
}
