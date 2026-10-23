import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page.tsx";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Nevile collects, uses and protects your personal information.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          Nevile connects people in Nova Scotia with local home-service businesses. We collect only
          what we need to run the service, we explain why, and you stay in control. This policy
          follows Canada&apos;s federal privacy law for businesses (PIPEDA).
        </p>
      }
    >
      <LegalSection title="What we collect">
        <LegalList
          items={[
            <>
              <strong>Account details:</strong> your name, email address and/or mobile number, and a
              password (stored only as a one-way hash).
            </>,
            <>
              <strong>Your postal code</strong>, to confirm you&apos;re in Nova Scotia and to show
              pros who serve your area. You can add your interests and whether you need help at home
              or run a business.
            </>,
            <>
              <strong>Bookings and messages</strong> once booking opens: addresses for jobs,
              schedules, photos of completed work, reviews and chat messages.
            </>,
            <>
              <strong>Payments</strong> are handled by Stripe. Nevile never sees or stores your full
              card number.
            </>,
            <>
              <strong>Technical information</strong> such as your IP address and browser, used to
              keep accounts secure (for example, limiting repeated sign-in attempts).
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="How we use it">
        <LegalList
          items={[
            "To create and secure your account, including sign-in codes and email confirmation.",
            "To show you local pros, and to share job details with the business you book.",
            "To process payments, refunds and payouts, and to keep the records the law requires.",
            "To send service messages about your account and bookings.",
            "To send tips and seasonal reminders only if you tick the optional box. You can unsubscribe at any time.",
          ]}
        />
        <p>We don&apos;t sell personal information, and we don&apos;t show third-party ads.</p>
      </LegalSection>

      <LegalSection title="Nevile Neighbours referrals">
        <p>
          Partner organizations may refer a neighbour who needs help, with that person&apos;s
          consent. We collect only what&apos;s needed to do the job: a first name, how to reach them
          through the partner, the address, the service needed and any practical notes. We ask
          partners not to share health, disability, age or income details, and we show only totals
          by region on our public impact page.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <LegalList
          items={[
            "The business you book, so it can do the job. Phone numbers and emails stay hidden until a booking is paid.",
            "Service providers that help us run Nevile, such as payments (Stripe), email and text-message delivery, hosting and error monitoring. They may only use the information to provide their service to us.",
            "Authorities, when the law requires it.",
          ]}
        />
        <p>
          Some providers may store information outside Canada. Before launch we&apos;ll list where
          our providers keep data.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          We use a small number of essential cookies to keep you signed in and secure. We don&apos;t
          use advertising or tracking cookies.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          We keep account information while your account is open. Payment and tax records are kept
          as long as the law requires. When you close your account we delete or anonymize what we no
          longer need.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <LegalList
          items={[
            "See and correct your information on your account page, or ask us for a copy of what we hold.",
            <>
              Turn marketing emails on or off on your{" "}
              <Link href="/account" className="font-semibold text-primary">
                account page
              </Link>
              , or with the unsubscribe link in any marketing email.
            </>,
            "Withdraw consent or ask us to close your account. Some records must be kept by law.",
            "Complain to the Office of the Privacy Commissioner of Canada if you're not satisfied with our answer.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Our privacy officer will answer questions about this policy. Contact details will be
          published here before launch.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
