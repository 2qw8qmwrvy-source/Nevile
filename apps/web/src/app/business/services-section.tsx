"use client";

import { FREQUENCY_LABELS, formatDurationMinutes } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { useTRPC } from "@/lib/trpc.ts";
import { ContractTerms } from "./contract-terms.tsx";
import type { SectionProps } from "./listing-dashboard.tsx";
import { ServiceForm, type ServiceFormValues } from "./service-form.tsx";
import { sectionTitleClass, useRefreshListing } from "./use-listing.ts";

type ServiceErrors = Partial<Record<keyof ServiceFormValues | "form", string>>;

function errorsOf(
  error: {
    message: string;
    data?: { zodError?: { fieldErrors?: Record<string, string[] | undefined> } | null } | null;
  } | null,
): ServiceErrors | undefined {
  if (!error) return undefined;
  const fields = error.data?.zodError?.fieldErrors ?? {};
  const mapped: ServiceErrors = {};
  for (const [key, messages] of Object.entries(fields)) {
    const field = key === "service" ? "form" : key;
    if (messages?.[0]) mapped[field as keyof ServiceErrors] = messages[0];
  }
  if (Object.keys(mapped).length === 0) mapped.form = error.message;
  return mapped;
}

/** The services customers can book or ask a quote for (SPEC §18). */
export function ServicesSection({ listing, businessId, onUnpublished }: SectionProps) {
  const trpc = useTRPC();
  const refresh = useRefreshListing(businessId);
  const { services, canEdit } = listing;
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const afterChange = async (result: { unpublished: boolean }) => {
    if (result.unpublished) onUnpublished();
    setEditing(null);
    setConfirmDelete(null);
    await refresh();
  };

  const create = useMutation(
    trpc.listing.createService.mutationOptions({ onSuccess: afterChange }),
  );
  const update = useMutation(
    trpc.listing.updateService.mutationOptions({ onSuccess: afterChange }),
  );
  const remove = useMutation(
    trpc.listing.deleteService.mutationOptions({ onSuccess: afterChange }),
  );
  const toggle = useMutation(
    trpc.listing.updateService.mutationOptions({ onSuccess: afterChange }),
  );

  return (
    <Card as="section" id="services" aria-labelledby="services-title" className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="services-title" className={sectionTitleClass}>
          Services
        </h2>
        {canEdit && editing !== "new" ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            Add a service
          </Button>
        ) : null}
      </div>
      <p className="mt-1.5 text-[15px] text-muted">
        Prices are what you charge per visit. Customers pay Nevile&apos;s fee on top, and you get
        your price minus 3%.
      </p>

      {editing === "new" ? (
        <div className="mt-5 rounded-card border border-primary/30 bg-ground p-4 sm:p-5">
          <h3 className="mb-3 text-[17px] font-semibold">New service</h3>
          <ServiceForm
            submitLabel="Add service"
            pending={create.isPending}
            errors={errorsOf(create.error)}
            onSubmit={(values) => create.mutate({ businessId, ...values })}
            onCancel={() => {
              create.reset();
              setEditing(null);
            }}
          />
        </div>
      ) : null}

      {services.length === 0 && editing !== "new" ? (
        <p className="mt-5 rounded-input border border-dashed border-field px-4 py-6 text-center text-[15px] text-muted">
          No services yet. Add what you offer, like mowing, snow clearing or cleaning.
        </p>
      ) : (
        <ul className="mt-5 grid gap-3">
          {services.map((service) => (
            <li key={service.id} className="rounded-card border border-border bg-surface p-4">
              {editing === service.id ? (
                <ServiceForm
                  initial={{
                    categorySlug: service.categorySlug as ServiceFormValues["categorySlug"],
                    title: service.title,
                    description: service.description,
                    pricingType: service.pricingType,
                    priceCents: service.priceCents,
                    fromPriceCents: service.fromPriceCents,
                    durationMinutes: service.durationMinutes,
                    instantBook: service.instantBook,
                    active: service.active,
                    recurrenceFrequencies: service.recurrenceFrequencies,
                  }}
                  contract={service.contract !== null}
                  submitLabel="Save service"
                  pending={update.isPending}
                  errors={errorsOf(update.error)}
                  onSubmit={(values) =>
                    update.mutate({ businessId, serviceId: service.id, service: values })
                  }
                  onCancel={() => {
                    update.reset();
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[17px] font-semibold">{service.title}</span>
                      {!service.active ? <Badge variant="neutral">Hidden</Badge> : null}
                      {service.instantBook && listing.business.instantBook ? (
                        <Badge variant="instant" />
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      {service.categoryName} · {service.priceText} · about{" "}
                      {formatDurationMinutes(service.durationMinutes)}
                      {service.recurrenceFrequencies.length > 0
                        ? ` · also ${service.recurrenceFrequencies
                            .map((frequency) => FREQUENCY_LABELS[frequency].toLowerCase())
                            .join(" or ")}`
                        : ""}
                    </p>
                    {service.categorySlug === "snow-ice-removal" ? (
                      <ContractTerms
                        businessId={businessId}
                        serviceId={service.id}
                        contract={service.contract}
                        canEdit={canEdit}
                        recurring={service.recurrenceFrequencies.length > 0}
                      />
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="-ml-2 flex flex-wrap gap-1.5 sm:ml-0">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(service.id)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={toggle.isPending}
                        onClick={() =>
                          toggle.mutate({
                            businessId,
                            serviceId: service.id,
                            service: {
                              categorySlug:
                                service.categorySlug as ServiceFormValues["categorySlug"],
                              title: service.title,
                              description: service.description,
                              pricingType: service.pricingType,
                              priceCents: service.priceCents,
                              fromPriceCents: service.fromPriceCents,
                              durationMinutes: service.durationMinutes,
                              instantBook: service.instantBook,
                              active: !service.active,
                              recurrenceFrequencies: service.recurrenceFrequencies,
                            },
                          })
                        }
                      >
                        {service.active ? "Hide" : "Show"}
                      </Button>
                      {confirmDelete === service.id ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:text-danger"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ businessId, serviceId: service.id })}
                        >
                          Confirm delete
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete(service.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {remove.error || toggle.error ? (
        <FormAlert tone="error" className="mt-3">
          {(remove.error ?? toggle.error)?.message}
        </FormAlert>
      ) : null}
    </Card>
  );
}
