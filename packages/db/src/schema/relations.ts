import { relations } from "drizzle-orm";
import { account, session, user } from "./auth.ts";
import { planPrices, subscriptions } from "./billing.ts";
import {
  agreements,
  bookings,
  recurringSeries,
  snowContracts,
  visitPhotos,
  visits,
} from "./bookings.ts";
import {
  businesses,
  businessInvites,
  businessMembers,
  insuranceDocuments,
  serviceAreas,
} from "./businesses.ts";
import { categoryRequests, serviceCategories, services } from "./catalog.ts";
import { addresses, profiles } from "./customers.ts";
import { disputes } from "./disputes.ts";
import { conversations, messages } from "./messaging.ts";
import { notifications, pushTokens } from "./notifications.ts";
import { payments, payouts, refunds, tips } from "./payments.ts";
import { quoteRequests, quotes } from "./quotes.ts";
import { reviews } from "./reviews.ts";
import { availabilityRules, timeOff } from "./scheduling.ts";

/**
 * Relational-query (`db.query.*`) metadata. `user.sessions` / `user.accounts` are the
 * keys Better Auth's drizzle adapter uses for joins. Tables with two foreign keys to
 * the same table name both sides with `relationName`.
 */

// ── Auth ───────────────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  profile: one(profiles),
  addresses: many(addresses),
  ownedBusinesses: many(businesses),
  memberships: many(businessMembers),
  bookings: many(bookings),
  quoteRequests: many(quoteRequests),
  notifications: many(notifications),
  pushTokens: many(pushTokens),
  reviewsGiven: many(reviews, { relationName: "reviewRater" }),
  reviewsReceived: many(reviews, { relationName: "reviewRatee" }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ── Customers ──────────────────────────────────────────────────────────────────

export const profileRelations = relations(profiles, ({ one }) => ({
  user: one(user, { fields: [profiles.userId], references: [user.id] }),
  defaultAddress: one(addresses, {
    fields: [profiles.defaultAddressId],
    references: [addresses.id],
  }),
}));

export const addressRelations = relations(addresses, ({ one, many }) => ({
  user: one(user, { fields: [addresses.userId], references: [user.id] }),
  bookings: many(bookings),
}));

// ── Businesses ─────────────────────────────────────────────────────────────────

export const businessRelations = relations(businesses, ({ one, many }) => ({
  owner: one(user, { fields: [businesses.ownerUserId], references: [user.id] }),
  members: many(businessMembers),
  invites: many(businessInvites),
  insuranceDocuments: many(insuranceDocuments),
  serviceAreas: many(serviceAreas),
  services: many(services),
  categoryRequests: many(categoryRequests),
  quoteRequests: many(quoteRequests),
  bookings: many(bookings),
  conversations: many(conversations),
  reviews: many(reviews),
  payouts: many(payouts),
  tips: many(tips),
  subscriptions: many(subscriptions),
}));

export const businessMemberRelations = relations(businessMembers, ({ one, many }) => ({
  business: one(businesses, {
    fields: [businessMembers.businessId],
    references: [businesses.id],
  }),
  user: one(user, { fields: [businessMembers.userId], references: [user.id] }),
  availabilityRules: many(availabilityRules),
  timeOff: many(timeOff),
  visits: many(visits),
}));

export const businessInviteRelations = relations(businessInvites, ({ one }) => ({
  business: one(businesses, {
    fields: [businessInvites.businessId],
    references: [businesses.id],
  }),
  invitedBy: one(user, { fields: [businessInvites.invitedByUserId], references: [user.id] }),
  acceptedBy: one(user, { fields: [businessInvites.acceptedByUserId], references: [user.id] }),
}));

export const insuranceDocumentRelations = relations(insuranceDocuments, ({ one }) => ({
  business: one(businesses, {
    fields: [insuranceDocuments.businessId],
    references: [businesses.id],
  }),
  uploadedBy: one(user, {
    fields: [insuranceDocuments.uploadedByUserId],
    references: [user.id],
  }),
  reviewedBy: one(user, {
    fields: [insuranceDocuments.reviewedByUserId],
    references: [user.id],
  }),
}));

export const serviceAreaRelations = relations(serviceAreas, ({ one }) => ({
  business: one(businesses, { fields: [serviceAreas.businessId], references: [businesses.id] }),
}));

// ── Catalog ────────────────────────────────────────────────────────────────────

export const serviceCategoryRelations = relations(serviceCategories, ({ many }) => ({
  services: many(services),
  categoryRequests: many(categoryRequests),
}));

export const categoryRequestRelations = relations(categoryRequests, ({ one }) => ({
  business: one(businesses, {
    fields: [categoryRequests.businessId],
    references: [businesses.id],
  }),
  requestedBy: one(user, {
    fields: [categoryRequests.requestedByUserId],
    references: [user.id],
  }),
  reviewedBy: one(user, { fields: [categoryRequests.reviewedByUserId], references: [user.id] }),
  category: one(serviceCategories, {
    fields: [categoryRequests.categoryId],
    references: [serviceCategories.id],
  }),
}));

export const serviceRelations = relations(services, ({ one, many }) => ({
  business: one(businesses, { fields: [services.businessId], references: [businesses.id] }),
  category: one(serviceCategories, {
    fields: [services.categoryId],
    references: [serviceCategories.id],
  }),
  quoteRequests: many(quoteRequests),
  bookings: many(bookings),
}));

// ── Scheduling ─────────────────────────────────────────────────────────────────

export const availabilityRuleRelations = relations(availabilityRules, ({ one }) => ({
  member: one(businessMembers, {
    fields: [availabilityRules.memberId],
    references: [businessMembers.id],
  }),
}));

export const timeOffRelations = relations(timeOff, ({ one }) => ({
  member: one(businessMembers, { fields: [timeOff.memberId], references: [businessMembers.id] }),
}));

// ── Quotes ─────────────────────────────────────────────────────────────────────

export const quoteRequestRelations = relations(quoteRequests, ({ one, many }) => ({
  customer: one(user, { fields: [quoteRequests.customerId], references: [user.id] }),
  business: one(businesses, { fields: [quoteRequests.businessId], references: [businesses.id] }),
  service: one(services, { fields: [quoteRequests.serviceId], references: [services.id] }),
  address: one(addresses, { fields: [quoteRequests.addressId], references: [addresses.id] }),
  quotes: many(quotes),
  conversation: one(conversations),
}));

export const quoteRelations = relations(quotes, ({ one }) => ({
  quoteRequest: one(quoteRequests, {
    fields: [quotes.quoteRequestId],
    references: [quoteRequests.id],
  }),
  createdBy: one(user, { fields: [quotes.createdByUserId], references: [user.id] }),
  booking: one(bookings),
}));

// ── Bookings & visits ──────────────────────────────────────────────────────────

export const bookingRelations = relations(bookings, ({ one, many }) => ({
  customer: one(user, { fields: [bookings.customerId], references: [user.id] }),
  business: one(businesses, { fields: [bookings.businessId], references: [businesses.id] }),
  service: one(services, { fields: [bookings.serviceId], references: [services.id] }),
  address: one(addresses, { fields: [bookings.addressId], references: [addresses.id] }),
  quote: one(quotes, { fields: [bookings.quoteId], references: [quotes.id] }),
  assignedMember: one(businessMembers, {
    fields: [bookings.assignedMemberId],
    references: [businessMembers.id],
  }),
  recurringSeries: one(recurringSeries),
  snowContract: one(snowContracts),
  visits: many(visits),
  payments: many(payments),
  agreements: many(agreements),
  reviews: many(reviews),
  conversation: one(conversations),
}));

export const recurringSeriesRelations = relations(recurringSeries, ({ one }) => ({
  booking: one(bookings, { fields: [recurringSeries.bookingId], references: [bookings.id] }),
}));

export const snowContractRelations = relations(snowContracts, ({ one }) => ({
  booking: one(bookings, { fields: [snowContracts.bookingId], references: [bookings.id] }),
}));

export const visitRelations = relations(visits, ({ one, many }) => ({
  booking: one(bookings, { fields: [visits.bookingId], references: [bookings.id] }),
  assignedMember: one(businessMembers, {
    fields: [visits.assignedMemberId],
    references: [businessMembers.id],
  }),
  completedBy: one(user, { fields: [visits.completedByUserId], references: [user.id] }),
  photos: many(visitPhotos),
  payments: many(payments),
  tips: many(tips),
  reviews: many(reviews),
  disputes: many(disputes, { relationName: "disputeVisit" }),
  fixFor: many(disputes, { relationName: "disputeFixVisit" }),
}));

export const visitPhotoRelations = relations(visitPhotos, ({ one }) => ({
  visit: one(visits, { fields: [visitPhotos.visitId], references: [visits.id] }),
  uploadedBy: one(user, { fields: [visitPhotos.uploadedByUserId], references: [user.id] }),
}));

export const agreementRelations = relations(agreements, ({ one }) => ({
  booking: one(bookings, { fields: [agreements.bookingId], references: [bookings.id] }),
  acceptedByBusinessUser: one(user, {
    fields: [agreements.acceptedByBusinessUserId],
    references: [user.id],
  }),
}));

// ── Disputes & money ───────────────────────────────────────────────────────────

export const disputeRelations = relations(disputes, ({ one, many }) => ({
  visit: one(visits, {
    fields: [disputes.visitId],
    references: [visits.id],
    relationName: "disputeVisit",
  }),
  fixVisit: one(visits, {
    fields: [disputes.fixVisitId],
    references: [visits.id],
    relationName: "disputeFixVisit",
  }),
  openedBy: one(user, { fields: [disputes.openedByUserId], references: [user.id] }),
  resolvedBy: one(user, { fields: [disputes.resolvedByUserId], references: [user.id] }),
  refunds: many(refunds),
}));

export const payoutRelations = relations(payouts, ({ one, many }) => ({
  business: one(businesses, { fields: [payouts.businessId], references: [businesses.id] }),
  payments: many(payments),
  tips: many(tips),
}));

export const paymentRelations = relations(payments, ({ one, many }) => ({
  booking: one(bookings, { fields: [payments.bookingId], references: [bookings.id] }),
  visit: one(visits, { fields: [payments.visitId], references: [visits.id] }),
  payout: one(payouts, { fields: [payments.payoutId], references: [payouts.id] }),
  refunds: many(refunds),
}));

export const refundRelations = relations(refunds, ({ one }) => ({
  payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }),
  dispute: one(disputes, { fields: [refunds.disputeId], references: [disputes.id] }),
  initiatedBy: one(user, { fields: [refunds.initiatedByUserId], references: [user.id] }),
}));

export const tipRelations = relations(tips, ({ one }) => ({
  visit: one(visits, { fields: [tips.visitId], references: [visits.id] }),
  customer: one(user, { fields: [tips.customerId], references: [user.id] }),
  business: one(businesses, { fields: [tips.businessId], references: [businesses.id] }),
  payout: one(payouts, { fields: [tips.payoutId], references: [payouts.id] }),
}));

// ── Reviews ────────────────────────────────────────────────────────────────────

export const reviewRelations = relations(reviews, ({ one }) => ({
  visit: one(visits, { fields: [reviews.visitId], references: [visits.id] }),
  booking: one(bookings, { fields: [reviews.bookingId], references: [bookings.id] }),
  business: one(businesses, { fields: [reviews.businessId], references: [businesses.id] }),
  rater: one(user, {
    fields: [reviews.raterUserId],
    references: [user.id],
    relationName: "reviewRater",
  }),
  ratee: one(user, {
    fields: [reviews.rateeUserId],
    references: [user.id],
    relationName: "reviewRatee",
  }),
}));

// ── Messaging & notifications ──────────────────────────────────────────────────

export const conversationRelations = relations(conversations, ({ one, many }) => ({
  customer: one(user, { fields: [conversations.customerId], references: [user.id] }),
  business: one(businesses, { fields: [conversations.businessId], references: [businesses.id] }),
  quoteRequest: one(quoteRequests, {
    fields: [conversations.quoteRequestId],
    references: [quoteRequests.id],
  }),
  booking: one(bookings, { fields: [conversations.bookingId], references: [bookings.id] }),
  messages: many(messages),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(user, { fields: [messages.senderUserId], references: [user.id] }),
}));

export const notificationRelations = relations(notifications, ({ one }) => ({
  user: one(user, { fields: [notifications.userId], references: [user.id] }),
}));

export const pushTokenRelations = relations(pushTokens, ({ one }) => ({
  user: one(user, { fields: [pushTokens.userId], references: [user.id] }),
}));

// ── Billing ────────────────────────────────────────────────────────────────────

export const subscriptionRelations = relations(subscriptions, ({ one }) => ({
  business: one(businesses, { fields: [subscriptions.businessId], references: [businesses.id] }),
}));

export const planPriceRelations = relations(planPrices, ({ one }) => ({
  createdBy: one(user, { fields: [planPrices.createdByUserId], references: [user.id] }),
}));
