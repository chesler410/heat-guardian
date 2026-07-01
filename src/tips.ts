// "Support Heat Guardian" — optional tip jar. Native (iOS/Android) uses fixed price-point IAPs via
// RevenueCat (App Store/Play don't allow arbitrary amounts); the web PWA uses Ko-fi (any amount).
// The native purchase path is staged behind tipsConfigured() so we never ship non-functional
// purchase buttons to App Review — it turns on once VITE_REVENUECAT_KEY is set + the plugin added.
// Setup order + product IDs live in the monetization-plan memory.

export interface TipTier {
  id: string; // must match the product ID created in App Store Connect + Play Console + RevenueCat
  key: string; // i18n key for the (swim-pun) display name
  price: string; // display only; the store is the source of truth for actual price
  emoji: string;
}

export const TIP_TIERS: TipTier[] = [
  { id: "hg_tip_small", key: "tip_t1", price: "$1.99", emoji: "🥽" },
  { id: "hg_tip_medium", key: "tip_t2", price: "$4.99", emoji: "🌊" },
  { id: "hg_tip_large", key: "tip_t3", price: "$9.99", emoji: "🏆" },
];

// True once RevenueCat is wired (public API key present). Until then native tips stay hidden.
export function tipsConfigured(): boolean {
  return !!import.meta.env.VITE_REVENUECAT_KEY;
}

// Kick off a native purchase. Stubbed until RevenueCat is configured; returns a status to toast.
// When wiring: add @revenuecat/purchases-capacitor, then implement with a dynamic import so the web
// bundle stays clean:
//   const { Purchases } = await import("@revenuecat/purchases-capacitor");
//   await Purchases.configure({ apiKey: import.meta.env.VITE_REVENUECAT_KEY });
//   const offerings = await Purchases.getOfferings();
//   const p = offerings.current?.availablePackages.find(x => x.storeProduct.identifier === productId);
//   if (p) { await Purchases.purchasePackage({ aPackage: p }); return "ok"; }
export async function startTip(_productId: string): Promise<"ok" | "cancelled" | "unavailable"> {
  return "unavailable";
}
