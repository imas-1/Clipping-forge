import { BrandKit } from "../api/client";

const KEY = "clipforge.brandKit";

export function loadBrandKit(): BrandKit | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBrandKit(kit: BrandKit) {
  localStorage.setItem(KEY, JSON.stringify(kit));
}

export function clearBrandKit() {
  localStorage.removeItem(KEY);
}
