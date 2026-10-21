import { emailSchema, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nevile/core";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, type TextInputInstance, View } from "react-native";

import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Icon } from "@/components/icon.tsx";
import { Text } from "@/components/text.tsx";
import {
  authClient,
  authErrorMessage,
  callAuth,
  EMAIL_LINK_EXPIRES_IN_HOURS,
  NAME_MAX_LENGTH,
} from "@/lib/auth.ts";
import {
  AuthScreen,
  FormAlert,
  formIcons,
  PasswordField,
  SwitchPrompt,
  TextField,
} from "@/lib/auth-ui.tsx";
import { colors, space } from "@/theme";

type Fields = { name: string; email: string; password: string; confirm: string };
type FieldErrors = Partial<Record<keyof Fields, string>>;

const EMPTY: Fields = { name: "", email: "", password: "", confirm: "" };

function validate(fields: Fields): FieldErrors {
  const errors: FieldErrors = {};
  const name = fields.name.trim();
  if (!name) errors.name = "Enter your name.";
  else if (name.length > NAME_MAX_LENGTH)
    errors.name = `Use at most ${NAME_MAX_LENGTH} characters.`;
  if (!emailSchema.safeParse(fields.email).success) errors.email = "Enter a valid email address.";
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

/** Shown after sign-up: the account only works once the emailed link is opened. */
function CheckEmail({
  email,
  onUseDifferentEmail,
}: {
  email: string;
  onUseDifferentEmail: () => void;
}) {
  return (
    <View style={styles.body}>
      <Card style={styles.sentCard}>
        <View style={styles.sentIcon}>
          <Icon name={formIcons.mail} size={28} color={colors.primary} />
        </View>
        <Text variant="title">Check your email</Text>
        <Text tone="muted">
          We sent a confirmation link to{" "}
          <Text variant="bodyStrong" accessibilityRole="text">
            {email}
          </Text>
          . It expires in {EMAIL_LINK_EXPIRES_IN_HOURS} hour. After you confirm, sign in with your
          email and password.
        </Text>
      </Card>
      <Button
        label="Go to sign in"
        fullWidth
        onPress={() => router.replace({ pathname: "/sign-in", params: { email } })}
      />
      <Button
        variant="ghost"
        label="Use a different email"
        fullWidth
        onPress={onUseDifferentEmail}
      />
    </View>
  );
}

export default function SignUpRoute() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const refs = {
    name: useRef<TextInputInstance>(null),
    email: useRef<TextInputInstance>(null),
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
    const firstInvalid = (Object.keys(found) as (keyof Fields)[])[0];
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }
    setPending(true);
    const email = emailSchema.parse(fields.email);
    const { error } = await callAuth(() =>
      authClient.signUp.email({ name: fields.name.trim(), email, password: fields.password }),
    );
    setPending(false);
    if (error) {
      setFormError(authErrorMessage(error, "We couldn't create your account. Please try again."));
      return;
    }
    // The same answer whether or not the address already had an account.
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <AuthScreen title="Almost there">
        <CheckEmail
          email={sentTo}
          onUseDifferentEmail={() => {
            setSentTo(null);
            setFields((current) => ({ ...current, email: "", password: "", confirm: "" }));
          }}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Create your account"
      subtitle="Book local pros for your home, or switch to business mode to take bookings."
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
          <Button label="Create account" fullWidth loading={pending} onPress={onSubmit} />
          <Text variant="small" tone="muted">
            We'll email you a link to confirm your address before you can sign in.
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
  sentCard: { gap: space.sm, alignItems: "flex-start" },
  sentIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.tabPill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
});
