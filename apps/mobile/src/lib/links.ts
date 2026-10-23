/**
 * Pages that live on the Nevile website (legal drafts, the accessibility statement) and
 * open in an in-app browser sheet, so the app and the site always show the same text.
 */
import * as WebBrowser from "expo-web-browser";
import { Alert, Linking } from "react-native";

import { colors } from "@/theme";

import { API_URL } from "./auth.ts";

/**
 * The website's origin. The web app serves both the site and the API, so this defaults to
 * `EXPO_PUBLIC_API_URL`; set `EXPO_PUBLIC_WEBSITE_URL` when they are split.
 */
function resolveWebsiteUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return API_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not http(s)");
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    console.error("[links] EXPO_PUBLIC_WEBSITE_URL is not a valid http(s) URL:", value);
    return API_URL;
  }
}

export const WEBSITE_URL = resolveWebsiteUrl(process.env.EXPO_PUBLIC_WEBSITE_URL);

/** Website paths of the SPEC §17 legal and accessibility pages. */
export const LEGAL_PAGES = {
  privacy: { path: "/privacy", title: "Privacy Policy" },
  terms: { path: "/terms", title: "Terms of Service" },
  accessibility: { path: "/accessibility", title: "Accessibility" },
} as const;
export type LegalPage = keyof typeof LEGAL_PAGES;

export function websiteUrl(path: string): string {
  return `${WEBSITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Opens a website page in the system browser sheet (SFSafariViewController / Custom Tabs). */
export async function openWebsitePage(path: string): Promise<void> {
  const url = websiteUrl(path);
  try {
    await WebBrowser.openBrowserAsync(url, {
      controlsColor: colors.primary,
      toolbarColor: colors.surface,
      dismissButtonStyle: "done",
      enableBarCollapsing: true,
    });
  } catch {
    // No browser that supports Custom Tabs (rare on Android): hand the link to the system.
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Couldn't open the page", `Visit ${url} in your browser.`);
    }
  }
}

export function openLegalPage(page: LegalPage): Promise<void> {
  return openWebsitePage(LEGAL_PAGES[page].path);
}
