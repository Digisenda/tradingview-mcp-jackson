export function generateClientId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const suffix = Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return `LLC-${date}-${suffix}`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function maskSSN(ssn: string): string {
  if (!ssn || ssn.length < 4) return "***-**-****";
  return `***-**-${ssn.slice(-4)}`;
}
