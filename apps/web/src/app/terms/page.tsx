import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page.tsx";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for using Nevile as a customer or a business.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These terms explain how Nevile works for customers and businesses. By creating an account
          you agree to them.
        </p>
      }
    >
      <LegalSection title="What Nevile is">
        <p>
          Nevile is a marketplace. We help customers find, book and pay independent local
          businesses, and we help businesses manage bookings and get paid. The businesses perform
          the work and are responsible for it; Nevile is not the service provider.
        </p>
      </LegalSection>

      <LegalSection title="Accounts">
        <LegalList
          items={[
            "Nevile is available in Nova Scotia only for now. You need a Nova Scotia postal code to sign up.",
            "Keep your details accurate and your sign-in secure. One person per account.",
            "You need a confirmed email or a verified phone number before you book, pay, message a pro or use business tools.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Prices, fees and payment">
        <LegalList
          items={[
            "Prices are in Canadian dollars. Customers pay the job price, a service fee shown at checkout, and HST where it applies.",
            "Businesses pay a 3% fee on each job, deducted from their payout. Payouts are made weekly, every Monday.",
            "One-off jobs are charged when you book. Recurring visits are charged 3 days before each visit. Per-visit snow contracts are charged after you confirm each visit.",
            "Tips are optional and go 100% to the business.",
            "All payments for jobs found on Nevile must go through Nevile.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Cancellations and refunds">
        <p>Each business picks one of three cancellation policies, shown before you book:</p>
        <LegalList
          items={[
            "Flexible: free until 24 hours before the job; after that, a 50% refund.",
            "Moderate: free until 48 hours before; after that, a 50% refund.",
            "Strict: free until 7 days before; after that, no refund.",
          ]}
        />
        <p>
          When you cancel, the service fee isn&apos;t refunded. When a business cancels, you get a
          full refund.
        </p>
      </LegalSection>

      <LegalSection title="Completing jobs and problems">
        <p>
          When a business marks a job complete, you have 48 hours to confirm it or report a problem.
          If you report a problem, the payment is held and the business has 3 days to fix it. If
          it&apos;s still not resolved, Nevile decides the outcome.
        </p>
      </LegalSection>

      <LegalSection title="Reviews">
        <p>
          Customers and businesses can rate each other after a completed job. Reviews must be honest
          and about the job. We may remove reviews that are abusive or break these terms.
        </p>
      </LegalSection>

      <LegalSection title="Nevile Neighbours donations">
        <p>
          Donations at checkout are optional. A 2.9% card fee is deducted from each donation; the
          rest goes to the program. A donation is refunded only if its booking is refunded in full.
          See{" "}
          <Link href="/neighbours" className="font-semibold text-primary">
            Nevile Neighbours
          </Link>{" "}
          for details.
        </p>
      </LegalSection>

      <LegalSection title="Things you can't do">
        <LegalList
          items={[
            "Arrange to pay outside Nevile for jobs found on Nevile.",
            "Harass, threaten or discriminate against anyone.",
            "Post false information, fake reviews or someone else's personal details.",
            "Try to break, overload or get around the security of the service.",
          ]}
        />
        <p>We may suspend accounts that break these rules.</p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          The businesses on Nevile are independent, and they&apos;re responsible for their work.
          Nevile&apos;s responsibility is limited to the extent the law allows; the final wording of
          this section will be set during legal review.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>These terms are governed by the laws of Nova Scotia and Canada.</p>
      </LegalSection>
    </LegalPage>
  );
}
