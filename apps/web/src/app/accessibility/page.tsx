import type { Metadata } from "next";
import { LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page.tsx";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "Nevile's commitment to an accessible website and app.",
};

export default function AccessibilityPage() {
  return (
    <LegalPage
      title="Accessibility"
      intro={
        <p>
          Everyone should be able to get help at home, including the people who need it most. We aim
          to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at level AA, in line with the
          goals of the Nova Scotia Accessibility Act.
        </p>
      }
    >
      <LegalSection title="What we do">
        <LegalList
          items={[
            "Every page and form works with a keyboard alone, with a visible focus outline.",
            "Form fields have labels, and errors are announced to screen readers.",
            "Text and controls meet AA colour-contrast levels, and buttons are large enough to tap easily.",
            "Animations are short and switch off when your device is set to reduce motion.",
            "Pages work on phones and at large text sizes without sideways scrolling.",
            "We run automated accessibility checks on key pages every time the site changes.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Known limitations">
        <p>
          Nevile is new and still growing. Some features, such as maps for choosing a service area,
          are still being built; we&apos;ll offer a text alternative for each of them.
        </p>
      </LegalSection>

      <LegalSection title="Tell us about a problem">
        <p>
          If something on Nevile is hard to use, or you need information in another format, please
          tell us. A dedicated accessibility contact will be published here before launch, and
          we&apos;ll aim to reply within 2 business days.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
