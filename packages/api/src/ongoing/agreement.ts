/**
 * The snow contract agreement (SPEC §21): plain-language sections the customer reads and
 * agrees to in the app, and the same text as a PDF both sides get by email and can
 * download from the booking.
 */
import { createHash } from "node:crypto";
import { formatCad } from "@nevile/core";
import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

export type AgreementInstalment = {
  /** "November 2026" or "November 15–30, 2026". */
  label: string;
  totalCents: number;
  /** "when the pro accepts" or "December 1". */
  charged: string;
};

export type AgreementFacts = {
  reference: string;
  /** "October 25, 2026". */
  agreedOn: string;
  businessName: string;
  customerName: string;
  addressLines: string[];
  serviceTitle: string;
  serviceDescription: string;
  notes: string | null;
  triggerCm: number;
  /** "November 15, 2026" and "March 31, 2027". */
  seasonStart: string;
  seasonEnd: string;
  cardLabel: string | null;
  price:
    | { pricing: "per_visit"; priceCents: number; totalCents: number }
    | {
        pricing: "season";
        priceCents: number;
        totalCents: number;
        payment: "upfront" | "monthly";
        instalments: AgreementInstalment[];
      };
};

export type AgreementSection = { heading: string; paragraphs: string[] };

/** The agreement's text, section by section. */
export function agreementSections(facts: AgreementFacts): AgreementSection[] {
  const { price } = facts;
  const card = facts.cardLabel ? `your saved card (${facts.cardLabel})` : "your saved card";
  const charges =
    price.pricing === "per_visit"
      ? [
          `${formatCad(price.priceCents)} per visit, ${formatCad(price.totalCents)} with Nevile's service fee and HST.`,
          `Each visit is charged to ${card} once you confirm it, or 48 hours after the pro logs it if you don't answer.`,
        ]
      : [
          `${formatCad(price.priceCents)} for the season, ${formatCad(price.totalCents)} with Nevile's service fee and HST.`,
          price.payment === "upfront"
            ? `It's charged to ${card} in full when the pro accepts.`
            : `It's charged to ${card} in ${price.instalments.length} monthly payments:`,
          ...(price.payment === "monthly"
            ? price.instalments.map(
                (instalment) =>
                  `• ${instalment.label}: ${formatCad(instalment.totalCents)}, charged ${instalment.charged}`,
              )
            : []),
          "The pro is paid each month's share after that month ends.",
        ];
  return [
    {
      heading: "Who",
      paragraphs: [
        `${facts.businessName} (“the pro”) and ${facts.customerName} (“you”), booked through Nevile.`,
      ],
    },
    {
      heading: "Where",
      paragraphs: [
        facts.addressLines.join(", "),
        ...(facts.notes ? [`Your notes: ${facts.notes}`] : []),
      ],
    },
    {
      heading: "What",
      paragraphs: [
        `${facts.serviceTitle}${facts.serviceDescription ? `: ${facts.serviceDescription}` : ""}`,
        `The pro clears snow and ice whenever snowfall reaches ${facts.triggerCm} cm, from ${facts.seasonStart} to ${facts.seasonEnd}.`,
      ],
    },
    { heading: "Price and charges", paragraphs: charges },
    {
      heading: "Visits",
      paragraphs: [
        "After each clearing the pro logs a visit, sometimes with a photo. You have 48 hours to confirm it or report a problem; after that it confirms by itself. If you report a problem, the pro has 3 days to put it right.",
        "Nevile doesn't check weather data: the visit log and your confirmation are the record.",
      ],
    },
    {
      heading: "Ending the contract",
      paragraphs:
        price.pricing === "per_visit"
          ? ["Either of you can end it at any time. Visits already done are still owed."]
          : [
              "Either of you can end it at any time.",
              price.payment === "upfront"
                ? "If you end it, the current month is kept and later months are refunded. If the pro ends it, the rest of the current month is refunded day by day and later months are refunded."
                : "If you end it, you pay for the current month and later months aren't charged. If the pro ends it, the rest of the current month is refunded day by day and later months aren't charged.",
            ],
    },
    {
      heading: "If a payment fails",
      paragraphs: [
        "We try again once a day for 3 days and tell you right away. If it still fails, the contract pauses (no visits or charges) until you update your card. Unpaid amounts stay owed.",
      ],
    },
    {
      heading: "Agreement",
      paragraphs: [
        `You agreed to these terms on ${facts.agreedOn}. The pro's listed terms are their acceptance: the contract starts when they accept your request.`,
        `Reference: ${facts.reference}`,
      ],
    },
  ];
}

export const AGREEMENT_TITLE = "Snow & ice clearing agreement";

/** Characters the PDF's standard font can't draw become "?" (names, addresses). */
function drawable(font: PDFFont, text: string): string {
  let out = "";
  for (const char of text) {
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += "?";
    }
  }
  return out;
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The agreement as a PDF (Letter size), and its SHA-256 for the record. */
export async function renderAgreementPdf(
  facts: AgreementFacts,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${AGREEMENT_TITLE}: ${facts.businessName}`);
  pdf.setAuthor("Nevile");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 56;
  const pageSize: [number, number] = [612, 792];
  const width = pageSize[0] - margin * 2;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;
  const ink = rgb(0.12, 0.12, 0.12);

  const write = (text: string, font: PDFFont, size: number, gapAfter: number) => {
    for (const line of wrap(font, size, drawable(font, text), width)) {
      if (y - size < margin) {
        page = pdf.addPage(pageSize);
        y = pageSize[1] - margin;
      }
      y -= size;
      page.drawText(line, { x: margin, y, size, font, color: ink });
      y -= size * 0.35;
    }
    y -= gapAfter;
  };

  write(AGREEMENT_TITLE, bold, 18, 4);
  write(`${facts.businessName} · ${facts.serviceTitle}`, regular, 11, 14);
  for (const section of agreementSections(facts)) {
    write(section.heading, bold, 12, 4);
    for (const paragraph of section.paragraphs) write(paragraph, regular, 10.5, 6);
    y -= 6;
  }
  const bytes = await pdf.save();
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
