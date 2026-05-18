import keytar from "keytar";

const SERVICE = "ripple-desktop";
const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

export async function getAccessToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, REFRESH_KEY);
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCESS_KEY, access);
  await keytar.setPassword(SERVICE, REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCESS_KEY);
  await keytar.deletePassword(SERVICE, REFRESH_KEY);
}

export async function hasTokens(): Promise<boolean> {
  const access = await getAccessToken();
  return Boolean(access);
}
