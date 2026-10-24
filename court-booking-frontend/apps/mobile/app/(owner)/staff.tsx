import { useMemo, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react-native";
import type { StaffMember, StaffPermissionCatalogItem } from "@court-booking/types";
import { isValidName, isValidPkMobile, toE164 } from "@court-booking/types";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { Avatar, Banner, Button, Chip, EmptyState, ErrorState, Input, Pill, Screen, SkeletonCard, Switch, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { NoAccess } from "@/components/no-access";
import { BottomSheet, DangerButton, OutlineButton, PrimaryButton } from "@/components/overview/ui";
import { OwnerHeader } from "./_fl";

/** OGrowthTeam frame 3 "Staff + permissions": the venue's team (GET /staff), each with permission switches from the
 * server's own catalog (GET /staff/permissions: a permission whose feature is off cannot be switched on). Owner only. */
export default function OwnerStaffScreen() {
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const { venues } = useOwnerVenues();
  const staffQuery = useQuery({ queryKey: ["owner-staff"], queryFn: () => api.staff.list(), enabled: isOwner });
  const catalogQuery = useQuery({ queryKey: ["staff-permission-catalog"], queryFn: () => api.staff.permissionCatalog(), enabled: isOwner });
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!isOwner) return <NoAccess what="Staff" />;
  const catalog = catalogQuery.data ?? [];
  const staff = staffQuery.data ?? [];

  return (
    <Screen testID="staff-screen">
      <OwnerHeader
        title="Staff"
        subtitle="Jo log venue chalane mein madad karte hain. Har ek ko sirf zaroori ijazat dein; woh isi phone + password se login karte hain."
        right={<Button label="+ Add" size="sm" onPress={() => setAdding(true)} testID="staff-add" />}
      />
      {staffQuery.isLoading || catalogQuery.isLoading ? (
        <View style={{ gap: space[3] }}>
          <SkeletonCard />
        </View>
      ) : staffQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(staffQuery.error)} onRetry={() => staffQuery.refetch()} />
      ) : staff.length === 0 ? (
        <EmptyState title="Abhi koi staff nahi" body="Pehla team member add karein: woh sirf woh kaam kar sakega jo aap chunein." icon={Users} actionLabel="Staff add karein" onAction={() => setAdding(true)} />
      ) : (
        staff.map((member) => <StaffCard key={member.id} member={member} catalog={catalog} open={openId === member.id} onToggleOpen={() => setOpenId(openId === member.id ? null : member.id)} />)
      )}
      {adding ? <AddStaffSheet venues={venues} catalog={catalog} onClose={() => setAdding(false)} /> : null}
    </Screen>
  );
}

function AddStaffSheet({ venues, catalog, onClose }: { venues: { id: string; name: string }[]; catalog: StaffPermissionCatalogItem[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const effectiveVenueId = venueId || venues[0]?.id || "";
  const valid = isValidName(name) && isValidPkMobile(phone) && password.length >= 8 && !!effectiveVenueId;

  const create = useMutation({
    mutationFn: () => api.staff.create({ venue_id: effectiveVenueId, name: name.trim(), phone: toE164(phone), password, permissions: [...selected] }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner-staff"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-staff-count"] });
      onClose();
    },
    onError: (e) => setError(friendlyErrorMessage(e)),
  });

  return (
    <BottomSheet
      title="Naya staff member"
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Cancel" onPress={onClose} />
          <PrimaryButton flex label={create.isPending ? "Add ho raha hai" : "Staff add karein"} disabled={!valid || create.isPending} onPress={() => create.mutate()} />
        </View>
      }
    >
      {venues.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {venues.map((v) => (
            <Chip key={v.id} label={v.name} selected={effectiveVenueId === v.id} onPress={() => setVenueId(v.id)} />
          ))}
        </View>
      ) : null}
      <Input label="Poora naam" value={name} onChangeText={setName} placeholder="Bilal Raza" />
      <Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0300 1234567" error={phone && !isValidPkMobile(phone) ? "Sahi mobile number likhein" : null} />
      <Input label="Password (kam se kam 8 harf)" value={password} onChangeText={setPassword} secureToggle />
      <Text variant="label">Kya kar sakta hai</Text>
      <PermissionSwitches catalog={catalog} selected={selected} onChange={setSelected} />
      {error ? <Banner tone="danger" body={error} /> : null}
    </BottomSheet>
  );
}

function PermissionSwitches({ catalog, selected, onChange }: { catalog: StaffPermissionCatalogItem[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  return (
    <View style={{ gap: space[1] }}>
      {catalog.map((item) => (
        <Switch
          key={item.key}
          label={item.label}
          hint={item.available ? undefined : "Ye feature abhi band hai"}
          value={selected.has(item.key)}
          disabled={!item.available}
          onChange={(on) => {
            const next = new Set(selected);
            if (on) next.add(item.key);
            else next.delete(item.key);
            onChange(next);
          }}
          testID={`perm-${item.key}`}
        />
      ))}
    </View>
  );
}

function StaffCard({ member, catalog, open, onToggleOpen }: { member: StaffMember; catalog: StaffPermissionCatalogItem[]; open: boolean; onToggleOpen: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set(member.permissions));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelFor = useMemo(() => {
    const m = new Map(catalog.map((c) => [c.key, c.label]));
    return (k: string) => m.get(k) ?? k;
  }, [catalog]);

  const savePerms = useMutation({
    mutationFn: () => api.staff.setPermissions(member.id, [...selected]),
    onSuccess: async () => {
      setError(null);
      onToggleOpen();
      await queryClient.invalidateQueries({ queryKey: ["owner-staff"] });
    },
    onError: (e) => setError(friendlyErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: () => api.staff.setActive(member.id, !member.is_active),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["owner-staff"] });
    },
    onError: (e) => setError(friendlyErrorMessage(e)),
  });

  return (
    <View testID="staff-card" style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3], boxShadow: shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <Avatar name={member.name ?? "Staff"} size={44} tone={member.is_active ? "info" : "neutral"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{member.name ?? "Staff"}</Text>
          <Text variant="meta" tone="muted">{`${member.phone} · ${member.venue_name}`}</Text>
        </View>
        {!member.is_active ? <Pill size="sm" tone="danger" label="Band" /> : null}
      </View>
      {open ? (
        <View style={{ gap: space[2] }}>
          <Text variant="label">{`${member.name ?? "Staff"} ki permissions`}</Text>
          <PermissionSwitches catalog={catalog} selected={selected} onChange={setSelected} />
          <Button label={savePerms.isPending ? "Save ho raha hai" : "Permissions save karein"} size="md" block onPress={() => savePerms.mutate()} disabled={savePerms.isPending} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {member.permissions.length === 0 ? (
            <Text variant="caption" tone="muted">
              Abhi koi permission nahi
            </Text>
          ) : (
            member.permissions.map((p) => <Pill key={p} size="sm" tone="info" label={labelFor(p)} />)
          )}
        </View>
      )}
      {error ? <Banner tone="danger" body={error} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Button
          label={open ? "Cancel" : "Permissions badlein"}
          variant="soft"
          size="sm"
          onPress={() => {
            setSelected(new Set(member.permissions));
            onToggleOpen();
          }}
        />
        <Button label={member.is_active ? "Staff hatayein" : "Wapas chalu karein"} variant={member.is_active ? "danger" : "soft"} size="sm" onPress={() => (member.is_active ? setConfirming(true) : toggleActive.mutate())} disabled={toggleActive.isPending} />
      </View>
      {confirming ? (
        <BottomSheet
          title={`${member.name ?? "Staff"} ko band karein?`}
          subtitle="Woh foran log out ho jayenge. Baad mein wapas chalu kar sakte hain."
          onClose={() => setConfirming(false)}
          footer={
            <View style={{ flexDirection: "row", gap: space[3] }}>
              <OutlineButton flex label="Wapas" onPress={() => setConfirming(false)} />
              <DangerButton flex label={toggleActive.isPending ? "Ho raha hai" : "Haan, band karein"} onPress={() => toggleActive.mutate()} disabled={toggleActive.isPending} />
            </View>
          }
        >
          <Text variant="body" tone="muted">
            Unki bookings aur record waise hi rahenge.
          </Text>
        </BottomSheet>
      ) : null}
    </View>
  );
}

