import type { Role } from "../lib/roles.js";
import type { AppUser } from "./user-types.js";

export type CreatedInvitation = {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
};

export type CreateInvitationResult =
  | { status: "exists" }
  | { status: "created"; invitation: CreatedInvitation };

export type AcceptInvitationResult =
  | { status: "invalid" }
  | { status: "exists" }
  | { status: "ok"; user: AppUser };

export type InvitationStore = {
  createInvitation(input: {
    email: string;
    role: Role;
    tokenHash: string;
    expiresAt: Date;
    invitedBy: string;
  }): Promise<CreateInvitationResult>;
  acceptInvitation(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<AcceptInvitationResult>;
};
