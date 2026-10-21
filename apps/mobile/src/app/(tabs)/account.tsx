import { Alert } from "react-native";

import { AccountScreen } from "@/screens/account-screen.tsx";

function comingSoon(feature: string) {
  Alert.alert(feature, "This will be available once sign-in is connected.");
}

/**
 * Account tab. Session handling is wired by the auth layer later; until then this
 * renders the signed-out state with placeholder actions.
 */
export default function AccountRoute() {
  return (
    <AccountScreen
      session={null}
      mode="customer"
      onSignIn={() => comingSoon("Sign in")}
      onOpenProfile={() => comingSoon("Profile")}
      onOpenPaymentMethods={() => comingSoon("Payment methods")}
      onSwitchMode={() => comingSoon("Business mode")}
      onSignOut={() => comingSoon("Sign out")}
    />
  );
}
