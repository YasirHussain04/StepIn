// Browser tokens live only in the current tab's session storage.
export const authStorage = {
  async getItem(key: string) {
    return typeof sessionStorage === "undefined"
      ? null
      : sessionStorage.getItem(key);
  },
  async setItem(key: string, value: string) {
    sessionStorage.setItem(key, value);
  },
  async removeItem(key: string) {
    sessionStorage.removeItem(key);
  },
};
