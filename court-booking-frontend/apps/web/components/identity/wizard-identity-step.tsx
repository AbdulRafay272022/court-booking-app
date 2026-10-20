"use client";

import type { OwnerIdentity } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import { SectionCard, SectionLabel } from "@/components/setup/ui";
import { CnicFields, identityDraftReady } from "./cnic-fields";
import { IdentityStatusChip } from "./identity-card";
import { useIdentityDraftStore } from "./identity-draft-store";

/**
 * The wizard's CNIC step (before "Send for review"). The number and both photos live in the in-memory identity draft
 * store only and are POSTed right after the venue is created. An owner who already has a CNIC on file sees a short note.
 */
export function WizardIdentityStep({ identity }: { identity: OwnerIdentity | null }) {
  const t = useT();
  const draft = useIdentityDraftStore();
  const onFile = identity && identity.status !== "missing";
  return (
    <SectionCard>
      <div data-testid="wizard-cnic" className="flex flex-col gap-4">
        <SectionLabel>{t("cnic.wizard.title")}</SectionLabel>
        {onFile ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <IdentityStatusChip status={identity.status} />
            <p className="text-[13px] text-owner-ink-muted" data-testid="wizard-cnic-on-file">
              {t("cnic.wizard.already", { masked: identity.masked ?? "" })}
            </p>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-owner-ink-muted">{t("cnic.wizard.help")}</p>
            <CnicFields value={draft} onChange={draft.set} />
            {!identityDraftReady(draft) ? (
              <p aria-live="polite" data-testid="wizard-cnic-needed" className="text-[12.5px] font-medium text-owner-warn">
                <span aria-hidden="true">! </span>
                {t("cnic.wizard.needed")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </SectionCard>
  );
}
