export const SESSION_COOKIE = "__Host-sda_session";
const base = "Path=/; HttpOnly; Secure; SameSite=Lax";
export const sessionCookie = (token: string, expires: Date) => `${SESSION_COOKIE}=${token}; ${base}; Expires=${expires.toUTCString()}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; ${base}; Max-Age=0`;
