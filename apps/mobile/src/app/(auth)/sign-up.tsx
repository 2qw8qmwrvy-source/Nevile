import {
  emailSchema,
  launchPostalCodeSchema,
  MARKETING_CONSENT_SENDER,
  MARKETING_CONSENT_STATEMENT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@nevile/core";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, type TextInputInstance, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Text } from "@/components/text.tsx";
import {
  authClient,
  authErrorMessage,
  callAuth,
  isEmailTakenError,
  isPostalCodeError,
  NAME_MAX_LENGTH,
} from "@/lib/auth.ts";
import {
  AuthScreen,
  Checkbox,
  FormAlert,
  PasswordField,
  SwitchPrompt,
  TextField,
} from "@/lib/auth-ui.tsx";
import { space } from "@/theme";

type Fields = {
  name: string;
  email: string;
  postalCode: string;
  password: string;
  confirm: string;
};
type FieldErrors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { name: "", email: "", postalCode: "", password: "", confirm: "" };
const FIELD_ORDER: readonly (keyof Fields)[] = [
  "name",
  "email",
  "postalCode",
  "password",
  "confirm",
];

/** Client-side hint for the postal code (SPEC §2); the server has the final say. */
function postalCodeProblem(value: string): string | undefined {
  if (!value.trim()) return "Enter your postal code.";
  const result = launchPostalCodeSchema.safeParse(value);
  return result.success
    ? undefined
    : (result.error.issues[0]?.message ?? "Enter a valid postal code.");
}

function validate(fields: Fields): FieldErrors {
  const errors: FieldErrors = {};
  const name = fields.name.trim();
  if (!name) errors.name = "Enter your name.";
  else if (name.length > NAME_MAX_LENGTH)
    errors.name = `Use at most ${NAME_MAX_LENGTH} characters.`;
  if (!emailSchema.safeParse(fields.email).success) errors.email = "Enter a valid email address.";
  const postal = postalCodeProblem(fields.postalCode);
  if (postal) errors.postalCode = postal;
  if (fields.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (fields.password.length > PASSWORD_MAX_LENGTH) {
    errors.password = `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!errors.password && fields.confirm !== fields.password) {
    errors.confirm = "The passwords don't match.";
  }
  return errors;
}

/**
 * Email sign-up. Nova Scotia postal codes only (SPEC §2). The new account is signed in
 * straight away and goes to the optional welcome; the emailed link unlocks booking and
 * messaging (SPEC §1).
 */
export default function SignUpRoute() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const refs = {
    name: useRef<TextInputInstance>(null),
    email: useRef<TextInputInstance>(null),
    postalCode: useRef<TextInputInstance>(null),
    password: useRef<TextInputInstance>(null),
    confirm: useRef<TextInputInstance>(null),
  };

  function update(key: keyof Fields) {
    return (value: string) => {
      setFields((current) => ({ ...current, [key]: value }));
      if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
    };
  }

  async function onSubmit() {
    if (pending) return;
    setFormError(null);
    const found = validate(fields);
    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((key) => found[key]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }
    setPending(true);
    const email = emailSchema.parse(fields.email);
    const { error } = await callAuth(() =>
      authClient.signUp.email({
        name: fields.name.trim(),
        email,
        password: fields.password,
        postalCode: launchPostalCodeSchema.parse(fields.postalCode),
        marketingConsent,
      }),
    );
    setPending(false);
    if (error) {
      const message = authErrorMessage(error, "We couldn't create your account. Please try again.");
      if (isPostalCodeError(error)) {
        setErrors({ postalCode: message });
        refs.postalCode.current?.focus();
      } else if (isEmailTakenError(error)) {
        setErrors({ email: message });
        refs.email.current?.focus();
      } else {
        setFormError(message);
      }
      return;
    }
    // Signed in: on to the optional welcome (SPEC §16).
    router.replace("/welcome");
  }

  return (
    <AuthScreen
      title="Create your account"
      subtitle="Book local pros across Nova Scotia, or switch to business mode to take bookings."
    >
      <View style={styles.body}>
        <View style={styles.form}>
          {formError ? <FormAlert tone="error" message={formError} /> : null}
          <TextField
            ref={refs.name}
            label="Your name"
            value={fields.name}
            onChangeText={update("name")}
            error={errors.name}
            maxLength={NAME_MAX_LENGTH}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refs.email.current?.focus()}
            editable={!pending}
          />
          <TextField
            ref={refs.email}
            label="Email"
            value={fields.email}
            onChangeText={update("email")}
            error={errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refs.postalCode.current?.focus()}
            editable={!pending}
          />
          <TextField
            ref={refs.postalCode}
            label="Postal code"
            hint="Nevile is only in Nova Scotia for now (postal codes start with B)."
            value={fields.postalCode}
            onChangeText={update("postalCode")}
            error={errors.postalCode}
            placeholder="B3H 1A1"
            maxLength={7}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="postal-code"
            textContentType="postalCode"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refs.password.current?.focus()}
            editable={!pending}
          />
          <PasswordField
            ref={refs.password}
            label="Password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`}
            value={fields.password}
            onChangeText={update("password")}
            error={errors.password}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            textContentType="newPassword"
            passwordRules={`minlength: ${PASSWORD_MIN_LENGTH};`}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refs.confirm.current?.focus()}
            editable={!pending}
          />
          <PasswordField
            ref={refs.confirm}
            label="Confirm password"
            value={fields.confirm}
            onChangeText={update("confirm")}
            error={errors.confirm}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            editable={!pending}
          />
          <Checkbox
            checked={marketingConsent}
            onChange={setMarketingConsent}
            label={`${MARKETING_CONSENT_STATEMENT} (optional)`}
            description={MARKETING_CONSENT_SENDER}
            disabled={pending}
          />
          <Button label="Create account" fullWidth loading={pending} onPress={onSubmit} />
          <Text variant="small" tone="muted">
            You'll be signed in right away. We'll email you a link to confirm your address before
            you book or message a pro. By creating an account you agree to our Terms and Privacy
            Policy.
          </Text>
        </View>
        <SwitchPrompt
          prompt="Prefer a text code?"
          action="Use your phone"
          onPress={() => router.replace({ pathname: "/sign-in", params: { method: "phone" } })}
        />
        <SwitchPrompt
          prompt="Already have an account?"
          action="Sign in"
          onPress={() => router.replace("/sign-in")}
        />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  form: { gap: space.md },
});
