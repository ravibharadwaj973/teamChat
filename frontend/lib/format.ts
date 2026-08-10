// Deterministic avatar hue from a name
export function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function initials(name = "?"): string {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

export const ROLE_TONE: Record<string, string> = {
  owner: "text-warn border-warn/30 bg-warn/10",
  admin: "text-accent-300 border-accent-500/30 bg-accent-500/10",
  manager: "text-ok border-ok/30 bg-ok/10",
  employee: "text-mist-500 border-line-strong bg-ink-700/60",
};

// Deadline label + tone for task cards
export function dueLabel(
  iso: string | null | undefined,
  done: boolean
): { text: string; tone: "danger" | "warn" | "muted" } | null {
  if (!iso) return null;
  const due = new Date(iso);
  const now = new Date();
  const label = due.toLocaleDateString([], { month: "short", day: "numeric" });
  if (done) return { text: `Due ${label}`, tone: "muted" };
  if (due.getTime() < now.getTime() && due.toDateString() !== now.toDateString()) {
    return { text: `Overdue · ${label}`, tone: "danger" };
  }
  if (due.toDateString() === now.toDateString()) {
    return { text: "Due today", tone: "warn" };
  }
  return { text: `Due ${label}`, tone: "muted" };
}

export function prettyBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function prettyIndustry(v?: string | null): string {
  if (!v) return "";
  return v
    .toLowerCase()
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}
