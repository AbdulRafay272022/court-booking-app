"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StaffMember, StaffPermissionCatalogItem } from "@court-booking/types";
import { api } from "@/lib/api";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { isValidPkMobile, isValidName, toE164 } from "@court-booking/types";

export default function StaffPage() {
  const qc = useQueryClient();
  const { venues } = useOwnerVenues();
  const staffQuery = useQuery({ queryKey: ["owner-staff"], queryFn: () => api.staff.list() });
  const catalogQuery = useQuery({ queryKey: ["staff-permission-catalog"], queryFn: () => api.staff.permissionCatalog() });

  const catalog = catalogQuery.data ?? [];
  const staff = staffQuery.data ?? [];

  return (
    <div className="p-4 sm:p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Staff</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          Add people who help run your venue and choose exactly what each can do. Staff sign in with the
          phone number and password you set here.
        </p>
      </div>

      <AddStaffCard venues={venues} catalog={catalog} onAdded={() => qc.invalidateQueries({ queryKey: ["owner-staff"] })} />

      {staffQuery.isLoading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : staffQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(staffQuery.error)} onRetry={() => staffQuery.refetch()} tone="owner" />
      ) : staff.length === 0 ? (
        <p className="text-owner-ink-faint">No staff yet. Add your first team member above.</p>
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
  catalog,
  selected,
  onToggle,
}: {
  catalog: StaffPermissionCatalogItem[];
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-1.5">
      {catalog.map((item) => (
        <label
          key={item.key}
          className="flex items-center gap-2 text-[13.5px]"
          style={{ opacity: item.available ? 1 : 0.45 }}
          title={item.available ? undefined : "This feature is currently turned off by the admin"}
        >
          <input
            type="checkbox"
            checked={selected.has(item.key)}
            disabled={!item.available}
            onChange={(e) => onToggle(item.key, e.target.checked)}
          />
          <span>{item.label}{item.available ? "" : " (feature off)"}</span>
        </label>
      ))}
    </div>
  );
}

function AddStaffCard({
  venues,
  catalog,
  onAdded,
}: {
  venues: { id: string; name: string }[];
  catalog: StaffPermissionCatalogItem[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [venueId, setVenueId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const effectiveVenueId = venueId || venues[0]?.id || "";
  const valid = isValidName(name) && isValidPkMobile(phone) && password.length >= 8 && !!effectiveVenueId;

  const create = useMutation({
    mutationFn: () =>
      api.staff.create({
        venue_id: effectiveVenueId,
        name: name.trim(),
        phone: toE164(phone),
        password,
        permissions: [...selected],
      }),
    onSuccess: () => {
      setName(""); setPhone(""); setPassword(""); setSelected(new Set()); setMessage(null);
      setOpen(false);
      onAdded();
    },
    onError: (e) => setMessage(friendlyErrorMessage(e)),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start px-4 py-2.5 rounded-lg bg-owner-accent text-white font-semibold text-sm"
      >
        + Add staff member
      </button>
    );
  }

  return (
    <div className="bg-owner-surface border border-owner-border rounded-xl p-5 flex flex-col gap-3">
      <h2 className="font-bold">New staff member</h2>
      {venues.length > 1 ? (
        <select className={inputCls} value={effectiveVenueId} onChange={(e) => setVenueId(e.target.value)}>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      ) : null}
      <input className={inputCls} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className={inputCls} placeholder="Phone (03xx…)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input
        className={inputCls}
        type="password"
        placeholder="Temporary password (min 8 chars)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div>
        <p className="text-[11px] font-bold tracking-wider text-owner-ink-faint mb-1.5">WHAT THEY CAN DO</p>
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
      </div>
      {message ? <p role="alert" className="text-[13px] font-semibold text-owner-danger">{message}</p> : null}
      <div className="flex gap-2">
        <button
          disabled={!valid || create.isPending}
          onClick={() => create.mutate()}
          className="px-4 py-2.5 rounded-lg font-semibold text-sm text-white"
          style={{ background: valid ? "#0E6274" : "#C6D2D7" }}
        >
          {create.isPending ? "Adding…" : "Add staff"}
        </button>
        <button onClick={() => setOpen(false)} className="px-4 py-2.5 rounded-lg font-semibold text-sm border border-owner-border">
          Cancel
        </button>
      </div>
    </div>
  );
}

function StaffRow({ member, catalog }: { member: StaffMember; catalog: StaffPermissionCatalogItem[] }) {
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
    return (k: string) => m.get(k) ?? k;
  }, [catalog]);

  return (
    <div className="bg-owner-surface border border-owner-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">
            {member.name ?? "Staff"}{" "}
            {!member.is_active ? <span className="text-[11px] font-bold text-owner-danger">· INACTIVE</span> : null}
          </p>
          <p className="text-xs text-owner-ink-faint">{member.phone} · {member.venue_name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing((v) => !v)} className="text-[13px] font-semibold text-owner-accent">
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={() => {
              if (member.is_active && !window.confirm(`Deactivate ${member.name ?? "this staff member"}? They'll be logged out immediately.`)) return;
              toggleActive.mutate();
            }}
            disabled={toggleActive.isPending}
            className="text-[13px] font-semibold"
            style={{ color: member.is_active ? "#B23B3B" : "#1F7A52" }}
          >
            {member.is_active ? "Deactivate" : "Reactivate"}
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
            {savePerms.isPending ? "Saving…" : "Save permissions"}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {member.permissions.length === 0 ? (
            <span className="text-[12px] text-owner-ink-faint">No permissions yet</span>
          ) : (
            member.permissions.map((p) => (
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
