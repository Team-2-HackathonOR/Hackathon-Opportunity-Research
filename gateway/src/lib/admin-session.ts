export const ADMIN_COOKIE = "hackscout_admin";
export const ADMIN_COOKIE_PATH = "/api/hackscout/admin";
export const ADMIN_REQUEST_HEADER = "x-hackscout-admin";

export function adminCookieToken(cookie: string | undefined): string | undefined {
  const entries = cookie?.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${ADMIN_COOKIE}=`));
  if (entries?.length !== 1) return undefined;
  const token = entries[0]?.slice(ADMIN_COOKIE.length + 1);
  return token && /^[A-Za-z0-9._-]+$/.test(token) ? token : undefined;
}

export function adminSessionCookie(token: string, maxAge: number, secure: boolean): string {
  return `${ADMIN_COOKIE}=${token}; Path=${ADMIN_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
