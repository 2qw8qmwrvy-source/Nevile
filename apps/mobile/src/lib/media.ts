import { API_URL } from "./auth.ts";

/**
 * Absolute URL for business media. The API returns either a public bucket URL or a path
 * on the web app (`/api/media/...`), which the app has to load from the API's origin.
 */
export function mediaUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${API_URL}${url.startsWith("/") ? url : `/${url}`}`;
}
