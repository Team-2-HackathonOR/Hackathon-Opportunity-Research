import type { InvitationStore } from "../src/db/invitations.js";
import type { AppUser, UserStore } from "../src/db/users.js";

type StoredInvitation = {
  id: string;
  email: string;
  role: AppUser["role"];
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
};

export function createMemoryAccounts(initial: AppUser[] = []) {
  const users = [...initial];
  const invitations: StoredInvitation[] = [];
  let chain = Promise.resolve();

  function exclusive<T>(work: () => T): Promise<T> {
    const result = chain.then(work, work);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  const userStore: UserStore = {
    async findByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
    },
    async findById(id) {
      return users.find((user) => user.id === id) ?? null;
    },
  };

  const invitationStore: InvitationStore = {
    createInvitation(input) {
      return exclusive(() => {
        if (users.some((user) => user.email === input.email)) {
          return { status: "exists" as const };
        }

        const now = new Date().toISOString();
        for (const invitation of invitations) {
          if (invitation.email === input.email && invitation.usedAt === null) {
            invitation.usedAt = now;
          }
        }

        const invitation: StoredInvitation = {
          id: crypto.randomUUID(),
          email: input.email,
          role: input.role,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt.toISOString(),
          usedAt: null,
        };
        invitations.push(invitation);
        return {
          status: "created" as const,
          invitation: {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expiresAt,
          },
        };
      });
    },
    acceptInvitation(input) {
      return exclusive(() => {
        const invitation = invitations.find((item) => item.tokenHash === input.tokenHash);
        if (!invitation || invitation.usedAt || new Date(invitation.expiresAt).getTime() <= input.now.getTime()) {
          return { status: "invalid" as const };
        }
        if (users.some((user) => user.email === invitation.email)) {
          return { status: "exists" as const };
        }

        const user: AppUser = {
          id: crypto.randomUUID(),
          email: invitation.email,
          passwordHash: input.passwordHash,
          role: invitation.role,
          authSource: "local",
          ldapDn: null,
        };
        users.push(user);
        invitation.usedAt = input.now.toISOString();
        return { status: "ok" as const, user };
      });
    },
  };

  return { userStore, invitationStore, invitations, users };
}
