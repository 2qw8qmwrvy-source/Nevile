import {
  emailSchema,
  launchPostalCodeSchema,
  MARKETING_CONSENT_SENDER,
  MARKETING_CONSENT_STATEMENT,
  normalizeCanadianPhone,
} from "@nevile/core";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, type TextInputInstance, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Text } from "@/components/text.tsx";
import {
  authClient,
  authErrorMessage,
  callAuth,
  formatPhone,
  isPostalCodeError,
  OTP_EXPIRES_IN_MINUTES,
  OTP_LENGTH,
  useSession,
} from "@/lib/auth.ts";
import {
  AuthScreen,
  Checkbox,
  closeAuthFlow,
  FormAlert,
  type FormAlertTone,
  formIcons,
  PasswordField,
  SegmentedTabs,
  SwitchPrompt,
  TextField,
} from "@/lib/auth-ui.tsx";
import { fontFamily, space } from "@/theme";

type Method = "email" | "phone";
type Message = { tone: FormAlertTone; text: string };

const METHODS = [
  { value: "email", label: "Email", icon: formIcons.mail },
  { value: "phone", label: "Phone code", icon: formIcons.phone },
] as const;

const RESEND_AFTER_SECONDS = 30;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Waits for the new session to load, then leaves the flow so the app shows the signed-in state. */
function useFinishSignIn() {
  const { refetch } = useSession();
  return async () => {
    await refetch();
    closeAuthFlow();
  };
}

function EmailSignInForm({ initialEmail }: { initialEmail: string }) {
  const finish = useFinishSignIn();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, setPending] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  async function onSubmit() {
    if (pending) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success || !password) {
      setMessage({ tone: "error", text: "Enter your email and password." });
      return;
    }
    setPending(true);
    setMessage(null);
    const { error } = await callAuth(() =>
      authClient.signIn.email({ email: parsed.data, password }),
    );
    if (error) {
      setPending(false);
      setPassword("");
      setMessage({ tone: "error", text: authErrorMessage(error) });
      return;
    }
    await finish();
  }

  return (
    <View style={styles.form}>
      {message ? <FormAlert tone={message.tone} message={message.text} /> : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        editable={!pending}
      />
      <PasswordField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        editable={!pending}
      />
      <Button label="Sign in" fullWidth loading={pending} onPress={onSubmit} />
    </View>
  );
}

type VerifyBody = Parameters<typeof authClient.phoneNumber.verify>[0] & {
  postalCode?: string;
  marketingConsent?: boolean;
};

/**
 * Phone sign-in and sign-up in one: request a code, then enter it. For a number with no
 * account yet the server asks for a Nova Scotia postal code (SPEC §2) without using up the
 * code, so the person adds it and the same code creates the account.
 */
function PhoneSignInForm() {
  const finish = useFinishSignIn();
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [needsPostalCode, setNeedsPostalCode] = useState(false);
  const [postalCode, setPostalCode] = useState("");
  const [postalError, setPostalError] = useState<string | undefined>();
  const [marketingConsent, setMarketingConsent] = useState(false);
  const codeRef = useRef<TextInputInstance>(null);
  const postalRef = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(target: string): Promise<boolean> {
    setPending(true);
    setError(null);
    const { error: sendError } = await callAuth(() =>
      authClient.phoneNumber.sendOtp({ phoneNumber: target }),
    );
    setPending(false);
    if (sendError) {
      setError(authErrorMessage(sendError, "We couldn't send a code. Please try again."));
      return false;
    }
    setCooldown(RESEND_AFTER_SECONDS);
    return true;
  }

  async function onRequestCode() {
    if (pending) return;
    const normalized = normalizeCanadianPhone(phoneInput);
    if (!normalized) {
      setError("Enter a Canadian mobile number, like 902 555 0123.");
      return;
    }
    if (await sendCode(normalized)) {
      setPhone(normalized);
      setCode("");
      setNeedsPostalCode(false);
      setPostalError(undefined);
      setNotice(`We texted a ${OTP_LENGTH}-digit code to ${formatPhone(normalized)}.`);
      setTimeout(() => codeRef.current?.focus(), 50);
    }
  }

  async function verify(digits: string) {
    if (!phone || pending) return;
    if (digits.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code from the text message.`);
      return;
    }
    const body: VerifyBody = { phoneNumber: phone, code: digits };
    if (needsPostalCode) {
      const parsed = launchPostalCodeSchema.safeParse(postalCode);
      if (!parsed.success) {
        setPostalError(
          postalCode.trim()
            ? (parsed.error.issues[0]?.message ?? "Enter a valid postal code.")
            : "Enter your postal code.",
        );
        postalRef.current?.focus();
        return;
      }
      body.postalCode = parsed.data;
      body.marketingConsent = marketingConsent;
    }
    setPending(true);
    setError(null);
    setPostalError(undefined);
    const { error: verifyError } = await callAuth(() => authClient.phoneNumber.verify(body));
    if (verifyError) {
      setPending(false);
      if (verifyError.code === "POSTAL_CODE_REQUIRED") {
        // New number: the code still works; ask for the postal code, then resubmit it.
        setNeedsPostalCode(true);
        setNotice(null);
        setTimeout(() => postalRef.current?.focus(), 50);
        return;
      }
      if (isPostalCodeError(verifyError)) {
        setPostalError(authErrorMessage(verifyError));
        postalRef.current?.focus();
        return;
      }
      setCode("");
      setError(authErrorMessage(verifyError, "We couldn't check that code. Please try again."));
      codeRef.current?.focus();
      return;
    }
    if (body.postalCode) {
      // A brand-new account: on to the optional welcome (SPEC §16).
      router.replace("/welcome");
      return;
    }
    await finish();
  }

  function onChangeCode(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(digits);
    // Autofilled or fully typed codes go straight through (not while a postal code is needed).
    if (digits.length === OTP_LENGTH && code.length < OTP_LENGTH && !needsPostalCode) {
      void verify(digits);
    }
  }

  if (!phone) {
    return (
      <View style={styles.form}>
        {error ? <FormAlert tone="error" message={error} /> : null}
        <TextField
          label="Mobile number"
          hint="We'll text you a code. New to Nevile? This creates your account."
          placeholder="902 555 0123"
          value={phoneInput}
          onChangeText={setPhoneInput}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="send"
          onSubmitEditing={onRequestCode}
          editable={!pending}
        />
        <Button label="Text me a code" fullWidth loading={pending} onPress={onRequestCode} />
        <Text variant="small" tone="muted">
          Message and data rates may apply. We only use your number for sign-in codes.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.form}>
      {error ? (
        <FormAlert tone="error" message={error} />
      ) : notice ? (
        <FormAlert
          tone="info"
          message={`${notice} It expires in ${OTP_EXPIRES_IN_MINUTES} minutes.`}
        />
      ) : null}
      <TextField
        ref={codeRef}
        label="Code"
        value={code}
        onChangeText={onChangeCode}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={OTP_LENGTH}
        returnKeyType="go"
        onSubmitEditing={() => verify(code)}
        editable={!pending}
        inputStyle={styles.codeInput}
      />
      {needsPostalCode ? (
        <>
          <FormAlert
            tone="info"
            message="New to Nevile? Add your postal code to create your account. Your code still works."
          />
          <TextField
            ref={postalRef}
            label="Postal code"
            hint="Nevile is only in Nova Scotia for now (postal codes start with B)."
            placeholder="B3H 1A1"
            value={postalCode}
            onChangeText={(value) => {
              setPostalCode(value);
              if (postalError) setPostalError(undefined);
            }}
            error={postalError}
            maxLength={7}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="postal-code"
            textContentType="postalCode"
            returnKeyType="go"
            onSubmitEditing={() => verify(code)}
            editable={!pending}
          />
          <Checkbox
            checked={marketingConsent}
            onChange={setMarketingConsent}
            label={`${MARKETING_CONSENT_STATEMENT} (optional)`}
            description={MARKETING_CONSENT_SENDER}
            disabled={pending}
          />
        </>
      ) : null}
      <Button
        label={needsPostalCode ? "Create account" : "Sign in"}
        fullWidth
        loading={pending}
        onPress={() => verify(code)}
      />
      <View style={styles.codeActions}>
        <Button
          variant="ghost"
          size="sm"
          label={cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
          disabled={pending || cooldown > 0}
          onPress={async () => {
            if (await sendCode(phone)) {
              setCode("");
              setNotice(`We texted a new code to ${formatPhone(phone)}.`);
            }
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          label="Use a different number"
          disabled={pending}
          onPress={() => {
            setPhone(null);
            setCode("");
            setError(null);
            setNotice(null);
            setNeedsPostalCode(false);
            setPostalError(undefined);
          }}
        />
      </View>
    </View>
  );
}

export default function SignInRoute() {
  const params = useLocalSearchParams<{ method?: string; email?: string }>();
  const [method, setMethod] = useState<Method>(
    firstParam(params.method) === "phone" ? "phone" : "email",
  );

  return (
    <AuthScreen title="Sign in" subtitle="Welcome back. Use your email, or get a code by text.">
      <View style={styles.body}>
        <SegmentedTabs
          label="Sign-in method"
          options={METHODS}
          value={method}
          onChange={setMethod}
        />
        {/* Both stay mounted so switching tabs keeps what was typed. */}
        <View style={method === "email" ? null : styles.hidden}>
          <EmailSignInForm initialEmail={firstParam(params.email) ?? ""} />
        </View>
        <View style={method === "phone" ? null : styles.hidden}>
          <PhoneSignInForm />
        </View>
        <SwitchPrompt
          prompt="New to Nevile?"
          action="Create an account"
          onPress={() => router.replace("/sign-up")}
        />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  form: { gap: space.md },
  hidden: { display: "none" },
  codeInput: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: fontFamily.displayBold,
    letterSpacing: 8,
    textAlign: "center",
  },
  codeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: space.sm,
  },
});
