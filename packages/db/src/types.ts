import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type * as s from "./schema/index.ts";

/** Row types (`X`) and insert types (`NewX`) for every table. */

export type User = InferSelectModel<typeof s.user>;
export type NewUser = InferInsertModel<typeof s.user>;
export type Session = InferSelectModel<typeof s.session>;
export type NewSession = InferInsertModel<typeof s.session>;
export type Account = InferSelectModel<typeof s.account>;
export type NewAccount = InferInsertModel<typeof s.account>;
export type Verification = InferSelectModel<typeof s.verification>;
export type NewVerification = InferInsertModel<typeof s.verification>;
export type RateLimit = InferSelectModel<typeof s.rateLimit>;
export type NewRateLimit = InferInsertModel<typeof s.rateLimit>;

export type Profile = InferSelectModel<typeof s.profiles>;
export type NewProfile = InferInsertModel<typeof s.profiles>;
export type Address = InferSelectModel<typeof s.addresses>;
export type NewAddress = InferInsertModel<typeof s.addresses>;

export type Business = InferSelectModel<typeof s.businesses>;
export type NewBusiness = InferInsertModel<typeof s.businesses>;
export type BusinessMember = InferSelectModel<typeof s.businessMembers>;
export type NewBusinessMember = InferInsertModel<typeof s.businessMembers>;
export type BusinessInvite = InferSelectModel<typeof s.businessInvites>;
export type NewBusinessInvite = InferInsertModel<typeof s.businessInvites>;
export type InsuranceDocument = InferSelectModel<typeof s.insuranceDocuments>;
export type NewInsuranceDocument = InferInsertModel<typeof s.insuranceDocuments>;
export type ServiceArea = InferSelectModel<typeof s.serviceAreas>;
export type NewServiceArea = InferInsertModel<typeof s.serviceAreas>;

export type ServiceCategory = InferSelectModel<typeof s.serviceCategories>;
export type NewServiceCategory = InferInsertModel<typeof s.serviceCategories>;
export type CategoryRequest = InferSelectModel<typeof s.categoryRequests>;
export type NewCategoryRequest = InferInsertModel<typeof s.categoryRequests>;
export type Service = InferSelectModel<typeof s.services>;
export type NewService = InferInsertModel<typeof s.services>;

export type AvailabilityRule = InferSelectModel<typeof s.availabilityRules>;
export type NewAvailabilityRule = InferInsertModel<typeof s.availabilityRules>;
export type ArrivalWindowRow = InferSelectModel<typeof s.arrivalWindows>;
export type TimeOff = InferSelectModel<typeof s.timeOff>;
export type NewTimeOff = InferInsertModel<typeof s.timeOff>;

export type QuoteRequestGroup = InferSelectModel<typeof s.quoteRequestGroups>;
export type NewQuoteRequestGroup = InferInsertModel<typeof s.quoteRequestGroups>;
export type QuoteRequest = InferSelectModel<typeof s.quoteRequests>;
export type NewQuoteRequest = InferInsertModel<typeof s.quoteRequests>;
export type Quote = InferSelectModel<typeof s.quotes>;
export type NewQuote = InferInsertModel<typeof s.quotes>;

export type Booking = InferSelectModel<typeof s.bookings>;
export type NewBooking = InferInsertModel<typeof s.bookings>;
export type RecurringSeries = InferSelectModel<typeof s.recurringSeries>;
export type NewRecurringSeries = InferInsertModel<typeof s.recurringSeries>;
export type SnowContract = InferSelectModel<typeof s.snowContracts>;
export type NewSnowContract = InferInsertModel<typeof s.snowContracts>;
export type BookingCheckout = InferSelectModel<typeof s.bookingCheckouts>;
export type NewBookingCheckout = InferInsertModel<typeof s.bookingCheckouts>;
export type Visit = InferSelectModel<typeof s.visits>;
export type NewVisit = InferInsertModel<typeof s.visits>;
export type VisitPhoto = InferSelectModel<typeof s.visitPhotos>;
export type NewVisitPhoto = InferInsertModel<typeof s.visitPhotos>;
export type Agreement = InferSelectModel<typeof s.agreements>;
export type NewAgreement = InferInsertModel<typeof s.agreements>;

export type Dispute = InferSelectModel<typeof s.disputes>;
export type NewDispute = InferInsertModel<typeof s.disputes>;
export type Payout = InferSelectModel<typeof s.payouts>;
export type NewPayout = InferInsertModel<typeof s.payouts>;
export type Payment = InferSelectModel<typeof s.payments>;
export type NewPayment = InferInsertModel<typeof s.payments>;
export type Refund = InferSelectModel<typeof s.refunds>;
export type NewRefund = InferInsertModel<typeof s.refunds>;
export type Tip = InferSelectModel<typeof s.tips>;
export type NewTip = InferInsertModel<typeof s.tips>;

export type Review = InferSelectModel<typeof s.reviews>;
export type NewReview = InferInsertModel<typeof s.reviews>;

export type Conversation = InferSelectModel<typeof s.conversations>;
export type NewConversation = InferInsertModel<typeof s.conversations>;
export type Message = InferSelectModel<typeof s.messages>;
export type NewMessage = InferInsertModel<typeof s.messages>;
export type PrivatePhoto = InferSelectModel<typeof s.privatePhotos>;
export type NewPrivatePhoto = InferInsertModel<typeof s.privatePhotos>;
export type Notification = InferSelectModel<typeof s.notifications>;
export type NewNotification = InferInsertModel<typeof s.notifications>;
export type PushToken = InferSelectModel<typeof s.pushTokens>;
export type NewPushToken = InferInsertModel<typeof s.pushTokens>;

export type Subscription = InferSelectModel<typeof s.subscriptions>;
export type NewSubscription = InferInsertModel<typeof s.subscriptions>;
export type PlanPrice = InferSelectModel<typeof s.planPrices>;
export type NewPlanPrice = InferInsertModel<typeof s.planPrices>;

export type CommunityPartner = InferSelectModel<typeof s.communityPartners>;
export type NewCommunityPartner = InferInsertModel<typeof s.communityPartners>;
export type CommunityPartnerMember = InferSelectModel<typeof s.communityPartnerMembers>;
export type NewCommunityPartnerMember = InferInsertModel<typeof s.communityPartnerMembers>;
export type CommunityReferral = InferSelectModel<typeof s.communityReferrals>;
export type NewCommunityReferral = InferInsertModel<typeof s.communityReferrals>;
export type Donation = InferSelectModel<typeof s.donations>;
export type NewDonation = InferInsertModel<typeof s.donations>;
export type CommunityFundLedgerEntry = InferSelectModel<typeof s.communityFundLedger>;
export type NewCommunityFundLedgerEntry = InferInsertModel<typeof s.communityFundLedger>;

export type AuditLogEntry = InferSelectModel<typeof s.auditLog>;
export type NewAuditLogEntry = InferInsertModel<typeof s.auditLog>;
