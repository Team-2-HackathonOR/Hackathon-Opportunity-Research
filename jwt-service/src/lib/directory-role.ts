import type { Role } from "./roles.js";

export type DirectoryGroupMapping = {
  admin?: string;
  researcher?: string;
  viewer?: string;
};

const rank: Record<Role, number> = {
  viewer: 1,
  researcher: 2,
  admin: 3,
};

export function mapDirectoryRole(groups: string[], mapping: DirectoryGroupMapping): Role | null {
  const present = new Set(groups.map((group) => group.toLowerCase()));
  let selected: Role | null = null;
  const pairs: Array<[Role, string | undefined]> = [
    ["admin", mapping.admin],
    ["researcher", mapping.researcher],
    ["viewer", mapping.viewer],
  ];
  for (const [role, group] of pairs) {
    if (!group || !present.has(group.toLowerCase())) {
      continue;
    }
    if (!selected || rank[role] > rank[selected]) {
      selected = role;
    }
  }
  return selected;
}
