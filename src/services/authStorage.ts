import * as SecureStore from "expo-secure-store";
// Supabase sessions can exceed one Keychain item's size. Commit a pointer only
// after every bounded chunk is written, then remove the previous generation.
export const authStorage = {
  async getItem(key: string) {
    const pointer = await SecureStore.getItemAsync(`${key}.pointer`);
    if (!pointer) return null;
    const { version, count } = JSON.parse(pointer) as {
      version: string;
      count: number;
    };
    if (!Number.isInteger(count) || count < 1 || count > 100) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.${version}.${i}`),
      ),
    );
    return parts.some((v) => v === null) ? null : parts.join("");
  },
  async setItem(key: string, value: string) {
    if (value.length > 50_000)
      throw new Error("Account session is too large for secure storage");
    const old = await SecureStore.getItemAsync(`${key}.pointer`);
    const version = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const count = Math.max(1, Math.ceil(value.length / 500));
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.setItemAsync(
          `${key}.${version}.${i}`,
          value.slice(i * 500, (i + 1) * 500),
        ),
      ),
    );
    await SecureStore.setItemAsync(
      `${key}.pointer`,
      JSON.stringify({ version, count }),
    );
    if (old) {
      const p = JSON.parse(old) as { version: string; count: number };
      await Promise.all(
        Array.from({ length: Math.min(100, p.count) }, (_, i) =>
          SecureStore.deleteItemAsync(`${key}.${p.version}.${i}`),
        ),
      );
    }
  },
  async removeItem(key: string) {
    const old = await SecureStore.getItemAsync(`${key}.pointer`);
    await SecureStore.deleteItemAsync(`${key}.pointer`);
    if (old) {
      const p = JSON.parse(old) as { version: string; count: number };
      await Promise.all(
        Array.from({ length: Math.min(100, p.count) }, (_, i) =>
          SecureStore.deleteItemAsync(`${key}.${p.version}.${i}`),
        ),
      );
    }
  },
};
