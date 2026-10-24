export type DirectoryIdentity = {
  email: string;
  dn: string;
  groups: string[];
};

export type DirectoryAuthenticator = {
  authenticate(
    email: string,
    password: string,
  ): Promise<
    | { status: "authenticated"; identity: DirectoryIdentity }
    | { status: "invalid" }
    | { status: "not-found" }
    | { status: "unavailable" }
  >;
};
