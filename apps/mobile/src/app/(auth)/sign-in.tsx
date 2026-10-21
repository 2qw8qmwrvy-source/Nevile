import { emailSchema, normalizeCanadianPhone } from "@nevile/core";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, type TextInputInstance, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Text } from "@/components/text.tsx";
import {
  authClient,
  authErrorMessage,
  callAuth,
  EMAIL_LINK_EXPIRES_IN_HOURS,
  formatPhone,
  OTP_EXPIRES_IN_MINUTES,
  OTP_LENGTH,
  useSession,
} from "@/lib/auth.ts";
import {
  AuthScreen,
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
      setMessage(
        error.code === "EMAIL_NOT_VERIFIED"
          ? {
              tone: "info",
              text: `Confirm your email first. We've sent a new link to ${parsed.data}; it expires in ${EMAIL_LINK_EXPIRES_IN_HOURS} hour.`,
            }
          : { tone: "error", text: authErrorMessage(error) },
      );
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

/**
 * Phone sign-in and sign-up in one: request a code, then enter it. Verifying a code for a
 * new number creates the account.
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
  const codeRef = useRef<TextInputInstance>(null);

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
      setError("Enter a Canadian mobile number, like 416 555 0123.");
      return;
    }
    if (await sendCode(normalized)) {
      setPhone(normalized);
      setCode("");
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
    setPending(true);
    setError(null);
    const { error: verifyError } = await callAuth(() =>
      authClient.phoneNumber.verify({ phoneNumber: phone, code: digits }),
    );
    if (verifyError) {
      setPending(false);
      setCode("");
      setError(authErrorMessage(verifyError, "We couldn't check that code. Please try again."));
      codeRef.current?.focus();
      return;
    }
    await finish();
  }

  function onChangeCode(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(digits);
    // Autofilled or fully typed codes go straight through.
    if (digits.length === OTP_LENGTH && code.length < OTP_LENGTH) void verify(digits);
  }

  if (!phone) {
    return (
      <View style={styles.form}>
        {error ? <FormAlert tone="error" message={error} /> : null}
        <TextField
          label="Mobile number"
          hint="We'll text you a code. New to Nevile? This creates your account."
          placeholder="416 555 0123"
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
      <Button label="Sign in" fullWidth loading={pending} onPress={() => verify(code)} />
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
