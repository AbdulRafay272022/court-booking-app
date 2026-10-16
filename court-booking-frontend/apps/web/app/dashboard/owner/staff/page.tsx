"use client";

import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StaffMember, StaffPermissionCatalogItem } from "@court-booking/types";
import { api } from "@/lib/api";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { isValidPkMobile, isValidName, toE164 } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey, TFunction } from "@/lib/i18n";

/** The permission label in the visitor's language (by key), falling back to the server's English label for an unknown key. */
function permLabel(t: TFunction, key: string, fallback: string): string {
  const k = `odash.staff.perm.${key}` as MessageKey;
  const v = t(k);
  return v !== k ? v : fallback;
}

/** Permissions the form does not offer. Empty since the owner's Add booking page came back: the "Add walk-in bookings" (`walkin`) checkbox
 * is shown again in the form and the list. A new staff member still starts with ONLY `view_ledger` ticked. */
const HIDDEN_PERMISSIONS = new Set<string>();
/** A new staff member starts with the safest single permission ticked; everything else is the owner's choice. */
const DEFAULT_PERMISSIONS = ["view_ledger"];

export default function StaffPage() {
  const t = useT();
  const qc = useQueryClient();
  const { venues } = useOwnerVenues();
  const staffQuery = useQuery({ queryKey: ["owner-staff"], queryFn: () => api.staff.list() });
  const catalogQuery = useQuery({ queryKey: ["staff-permission-catalog"], queryFn: () => api.staff.permissionCatalog() });

  const [justAdded, setJustAdded] = useState(false);
  const catalog = catalogQuery.data ?? [];
  const staff = staffQuery.data ?? [];

  return (
    <div className="p-4 sm:p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("odash.staff.title")}</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          {t("odash.staff.intro")}
        </p>
      </div>

      <AddStaffCard
        venues={venues}
        catalog={catalog}
        onAdded={(created) => {
          // show the new member at once, then let the server list confirm it
          qc.setQueryData<StaffMember[]>(["owner-staff"], (old) => [created, ...(old ?? []).filter((m) => m.id !== created.id)]);
          void qc.invalidateQueries({ queryKey: ["owner-staff"] });
          setJustAdded(true);
        }}
      />
      {justAdded ? (
        <p role="status" aria-live="polite" className="text-[13px] font-semibold" style={{ color: "#1F7A52" }}>
          {t("odash.staff.added")}
        </p>
      ) : null}

      {staffQuery.isLoading ? (
        <p className="text-owner-ink-faint">{t("odash.staff.loading")}</p>
      ) : staffQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(staffQuery.error, t)} onRetry={() => staffQuery.refetch()} tone="owner" />
      ) : staff.length === 0 ? (
        <p className="text-owner-ink-faint">{t("odash.staff.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {staff.map((member) => (
            <StaffRow key={member.id} member={member} catalog={catalog} />
          ))}
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full h-11 px-3 rounded-lg border border-owner-border bg-white text-[14px] outline-none focus:border-owner-accent";

function PermissionChecklist({
  catalog, // i18n-ignore
  selected, // i18n-ignore
  onToggle, // i18n-ignore
}: {
  catalog: StaffPermissionCatalogItem[];
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="grid sm:grid-cols-2 gap-1.5">
      {catalog.filter((item) => !HIDDEN_PERMISSIONS.has(item.key)).map((item) => (
        <label
          key={item.key}
          className="flex min-h-11 items-center gap-2.5 text-[13.5px]"
          style={{ opacity: item.available ? 1 : 0.45 }}
          title={item.available ? undefined : t("odash.staff.featureOffTitle")}
        >
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0"
            checked={selected.has(item.key)}
            disabled={!item.available}
            onChange={(e) => onToggle(item.key, e.target.checked)}
          />
          <span>{permLabel(t, item.key, item.label)}{item.available ? "" : t("odash.staff.featureOff")}</span>
        </label>
      ))}
    </div>
  );
}

function AddStaffCard({
  venues, // i18n-ignore
  catalog, // i18n-ignore
  onAdded, // i18n-ignore
}: {
  venues: { id: string; name: string }[];
  catalog: StaffPermissionCatalogItem[];
  onAdded: (created: StaffMember) => void;
}) {
  const t = useT();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [venueId, setVenueId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_PERMISSIONS));
  const [touched, setTouched] = useState({ name: false, phone: false, password: false });
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const effectiveVenueId = venueId || venues[0]?.id || "";
  const nameOk = isValidName(name);
  const phoneOk = isValidPkMobile(phone);
  const passwordOk = password.length >= 8;
  const valid = nameOk && phoneOk && passwordOk && !!effectiveVenueId;

  const create = useMutation({
    mutationFn: () =>
      api.staff.create({
        venue_id: effectiveVenueId,
        name: name.trim(),
        phone: toE164(phone),
        password, // i18n-ignore
        permissions: [...selected],
      }),
    onSuccess: (created) => {
      setName("");
      setPhone("");
      setPassword("");
      setShowPassword(false);
      setSelected(new Set(DEFAULT_PERMISSIONS));
      setTouched({ name: false, phone: false, password: false });
      setPhoneTaken(false);
      setMessage(null);
      setOpen(false);
      onAdded(created);
    },
    onError: (e) => {
      // The backend uses the same code when the number belongs to ANY other account. On this form that means "pick another number", so it is
      // shown under the phone field in staff wording (the login and signup screens keep their own text).
      if ((e as { code?: string }).code === "PHONE_ALREADY_REGISTERED") {
        setPhoneTaken(true);
        setMessage(null);
      } else {
        setMessage(friendlyErrorMessage(e, t));
      }
    },
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="self-start min-h-11 px-4 py-2.5 rounded-lg bg-owner-accent text-white font-semibold text-sm">
        {t("odash.staff.add")}
      </button>
    );
  }

  const phoneErrorText = phoneTaken ? t("odash.staff.phoneTaken") : touched.phone && !phoneOk ? t("odash.staff.phoneInvalid") : null;
  const labelCls = "text-[13px] font-semibold text-owner-ink";
  const hintCls = "text-[12.5px] text-owner-ink-faint";

  return (
    <form
      noValidate
      className="bg-owner-surface border border-owner-border rounded-xl p-5 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched({ name: true, phone: true, password: true });
        if (valid && !create.isPending) create.mutate();
      }}
    >
      <h2 className="font-bold">{t("odash.staff.new")}</h2>
      {venues.length > 1 ? (
        <select aria-label={t("odash.staff.venueAria")} className={inputCls} value={effectiveVenueId} onChange={(e) => setVenueId(e.target.value)}>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-name`} className={labelCls}>
          {t("odash.staff.fullName")}
        </label>
        <input
          id={`${uid}-name`}
          className={inputCls}
          autoComplete="off"
          value={name}
          aria-invalid={touched.name && !nameOk}
          aria-describedby={touched.name && !nameOk ? `${uid}-name-err` : undefined}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched((x) => ({ ...x, name: true }))}
        />
        {touched.name && !nameOk ? (
          <p id={`${uid}-name-err`} role="alert" className="text-[12.5px] font-semibold text-owner-danger">
            {t("odash.staff.nameInvalid")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-phone`} className={labelCls}>
          {t("odash.staff.labelPhone")}
        </label>
        <input
          id={`${uid}-phone`}
          className={`${inputCls} ${phoneErrorText ? "border-owner-danger" : ""}`}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          placeholder="03XXXXXXXXX"
          value={phone}
          aria-invalid={!!phoneErrorText}
          aria-describedby={`${uid}-phone-hint ${uid}-phone-err`}
          onChange={(e) => {
            setPhone(e.target.value);
            setPhoneTaken(false);
          }}
          onBlur={() => setTouched((x) => ({ ...x, phone: true }))}
        />
        <p id={`${uid}-phone-hint`} className={hintCls}>
          {t("odash.staff.phoneHint")}
        </p>
        <p id={`${uid}-phone-err`} role="alert" aria-live="polite" data-testid="staff-phone-error" className="text-[12.5px] font-semibold text-owner-danger empty:hidden">
          {phoneErrorText}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-pw`} className={labelCls}>
          {t("odash.staff.labelPassword")}
        </label>
        <div className="relative">
          <input
            id={`${uid}-pw`}
            className={`${inputCls} pr-24`}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            aria-invalid={touched.password && !passwordOk}
            aria-describedby={`${uid}-pw-hint`}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((x) => ({ ...x, password: true }))}
          />
          <button
            type="button"
            aria-pressed={showPassword}
            aria-label={showPassword ? t("odash.staff.hidePasswordAria") : t("odash.staff.showPasswordAria")}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-0 top-0 h-11 min-w-11 cursor-pointer rounded-lg px-3 text-[13px] font-bold text-owner-accent"
          >
            <span aria-hidden="true">{showPassword ? t("odash.staff.hidePassword") : t("odash.staff.showPassword")}</span>
          </button>
        </div>
        <p id={`${uid}-pw-hint`} className={touched.password && !passwordOk ? "text-[12.5px] font-semibold text-owner-danger" : hintCls}>
          {touched.password && !passwordOk ? t("odash.staff.passwordShort") : t("odash.staff.passwordHint")}
        </p>
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="text-[11px] font-bold tracking-wider text-owner-ink-faint mb-1">{t("odash.staff.can")}</legend>
        <p className="mb-1.5 text-[12.5px] text-owner-ink-faint">{t("odash.staff.permHint")}</p>
        <PermissionChecklist
          catalog={catalog}
          selected={selected}
          onToggle={(key, on) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (on) next.add(key);
              else next.delete(key);
              return next;
            })
          }
        />
      </fieldset>

      {message ? (
        <p role="alert" className="text-[13px] font-semibold text-owner-danger">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!valid || create.isPending}
          aria-busy={create.isPending}
          className="min-h-11 px-4 py-2.5 rounded-lg font-semibold text-sm text-white disabled:cursor-not-allowed"
          style={{ background: valid && !create.isPending ? "#0E6274" : "#C6D2D7" }}
        >
          {create.isPending ? t("odash.staff.adding") : t("odash.staff.addBtn")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={create.isPending} className="min-h-11 px-4 py-2.5 rounded-lg font-semibold text-sm border border-owner-border">
          {t("odash.staff.cancel")}
        </button>
      </div>
    </form>
  );
}

function StaffRow({ member, catalog }: { member: StaffMember; catalog: StaffPermissionCatalogItem[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(member.permissions));

  const savePerms = useMutation({
    mutationFn: () => api.staff.setPermissions(member.id, [...selected]),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ["owner-staff"] }); },
  });
  const toggleActive = useMutation({
    mutationFn: () => api.staff.setActive(member.id, !member.is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-staff"] }),
  });

  const labelFor = useMemo(() => {
    const m = new Map(catalog.map((c) => [c.key, c.label]));
    return (k: string) => permLabel(t, k, m.get(k) ?? k);
  }, [catalog, t]);

  return (
    <div className="bg-owner-surface border border-owner-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm">
            {member.name ?? t("odash.staff.default")}{" "}
            {!member.is_active ? <span className="text-[11px] font-bold text-owner-danger">{t("odash.staff.inactive")}</span> : null}
          </p>
          <p className="text-xs text-owner-ink-faint">{member.phone} · {member.venue_name}</p>
        </div>
        <div className="flex shrink-0 gap-3">
          <button onClick={() => setEditing((v) => !v)} className="min-h-11 whitespace-nowrap text-[13px] font-semibold text-owner-accent">
            {editing ? t("odash.staff.cancel") : t("odash.staff.edit")}
          </button>
          <button
            onClick={() => {
              if (member.is_active && !window.confirm(t("odash.staff.confirmDeactivate", { name: member.name ?? t("odash.staff.thisMember") }))) return;
              toggleActive.mutate();
            }}
            disabled={toggleActive.isPending}
            className="min-h-11 whitespace-nowrap text-[13px] font-semibold"
            style={{ color: member.is_active ? "#B23B3B" : "#1F7A52" }}
          >
            {member.is_active ? t("odash.staff.deactivate") : t("odash.staff.reactivate")}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 flex flex-col gap-3">
          <PermissionChecklist
            catalog={catalog}
            selected={selected}
            onToggle={(key, on) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (on) next.add(key); else next.delete(key);
                return next;
              })
            }
          />
          <button
            onClick={() => savePerms.mutate()}
            disabled={savePerms.isPending}
            className="self-start px-4 py-2 rounded-lg bg-owner-accent text-white font-semibold text-sm"
          >
            {savePerms.isPending ? t("odash.staff.saving") : t("odash.staff.savePerms")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {member.permissions.filter((p) => !HIDDEN_PERMISSIONS.has(p)).length === 0 ? (
            <span className="text-[12px] text-owner-ink-faint">{t("odash.staff.noPerms")}</span>
          ) : (
            member.permissions.filter((p) => !HIDDEN_PERMISSIONS.has(p)).map((p) => (
              <span key={p} className="text-[11.5px] px-2 py-0.5 rounded-md bg-owner-bg text-owner-ink-muted">
                {labelFor(p)}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}
