/**
 * Push notifications (SPEC §20). The app registers this phone's Expo push token for the
 * signed-in person and opens the matching screen when a notification is tapped. Permission
 * is asked right after something that gets replies (a quote request, a booking, a message),
 * never at launch.
 */
import type { AppRouter } from "@nevile/api";
import type { TRPCClient } from "@trpc/client";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

type Client = TRPCClient<AppRouter>;

// Shown while the app is open too; the chat and inbox refresh themselves.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** The EAS project id Expo push tokens are issued for (`eas init` sets it in app config). */
function projectId(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return fromEnv || Constants.easConfig?.projectId || extra?.eas?.projectId || null;
}

/** This phone's Expo push token, or null (simulator, no permission, not configured). */
async function pushToken(ask: boolean): Promise<string | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Messages and updates",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && ask && current.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return null;
  const id = projectId();
  if (!id) {
    if (__DEV__) console.info("[push] set EXPO_PUBLIC_EAS_PROJECT_ID to receive pushes");
    return null;
  }
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch (error) {
    console.warn("[push] could not get a push token", error);
    return null;
  }
}

let registered: string | null = null;
let askedThisSession = false;

async function register(client: Client, ask: boolean): Promise<void> {
  try {
    const token = await pushToken(ask);
    // Always sent: the server moves the token to whoever is signed in now.
    if (!token) return;
    await client.push.register.mutate({
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
    });
    registered = token;
  } catch (error) {
    console.warn("[push] could not register this phone", error);
  }
}

/** On launch and sign-in: registers silently if the person already allowed notifications. */
export function refreshPushRegistration(client: Client): Promise<void> {
  return register(client, false);
}

/** After a quote request, booking or message: asks once per app session, then registers. */
export function askForPush(client: Client): Promise<void> {
  if (askedThisSession) return register(client, false);
  askedThisSession = true;
  return register(client, true);
}

/** Before signing out, so this phone stops getting the person's notifications. */
export async function unregisterPush(client: Client): Promise<void> {
  const token = registered;
  if (!token) return;
  registered = null;
  try {
    await client.push.unregister.mutate({ token });
  } catch (error) {
    console.warn("[push] could not unregister this phone", error);
  }
}

/** The website path a tapped notification should open (set by the API as `data.path`). */
export function pathOf(response: Notifications.NotificationResponse | null): string | null {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return null;
  }
  const path = response.notification.request.content.data?.path;
  return typeof path === "string" && path.startsWith("/") ? path : null;
}
