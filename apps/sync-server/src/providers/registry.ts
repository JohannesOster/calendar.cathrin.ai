import type { Provider } from "@cathrin/shared-types";
import type { CalendarProvider } from "./types.js";
import { GoogleCalendarProvider } from "./google/index.js";

const providers = new Map<Provider, CalendarProvider>();

/**
 * Get the CalendarProvider implementation for a given provider ID.
 * Providers are singletons — created once and cached.
 */
export function getProvider(providerId: Provider): CalendarProvider {
  let provider = providers.get(providerId);
  if (provider) return provider;

  switch (providerId) {
    case "google":
      provider = new GoogleCalendarProvider();
      break;
    default:
      throw new Error(`Unsupported calendar provider: "${providerId}"`);
  }

  providers.set(providerId, provider);
  return provider;
}
