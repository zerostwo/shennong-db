export type SettingsSection = "general" | "models" | "skills" | "memory" | "agent-data" | "security" | "tokens" | "account";

const routeNames: Record<SettingsSection, string> = {
  general: "General",
  models: "Models",
  skills: "Skills",
  memory: "Memory",
  "agent-data": "AgentAndData",
  security: "Security",
  tokens: "ApiTokens",
  account: "Account",
};

const sectionNames = new Map(Object.entries(routeNames).map(([section, route]) => [route.toLowerCase(), section as SettingsSection]));

export function settingsHash(section: SettingsSection): string {
  return `#settings/${routeNames[section]}`;
}

export function settingsSectionFromHash(hash: string): SettingsSection | null {
  const match = /^#settings\/([^/?#]+)$/i.exec(hash.trim());
  if (!match) return null;
  let route = match[1];
  try { route = decodeURIComponent(route); } catch { return null; }
  return sectionNames.get(route.toLowerCase()) ?? null;
}
