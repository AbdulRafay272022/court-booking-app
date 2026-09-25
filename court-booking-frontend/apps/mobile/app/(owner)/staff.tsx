import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StaffMember, StaffPermissionCatalogItem } from "@court-booking/types";
import { isValidName, isValidPkMobile, toE164 } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ChevronLeftIcon, CheckIcon, PlusIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";

export default function OwnerStaffScreen() {
  const { venues } = useOwnerVenues();
  const staffQuery = useQuery({ queryKey: ["owner-staff"], queryFn: () => api.staff.list() });
  const catalogQuery = useQuery({
    queryKey: ["staff-permission-catalog"],
    queryFn: () => api.staff.permissionCatalog(),
  });
  const [adding, setAdding] = useState(false);

  const catalog = catalogQuery.data ?? [];
  const staff = staffQuery.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px] flex-1">Staff</Text>
      </View>

      {staffQuery.isLoading || catalogQuery.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : staffQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(staffQuery.error)} onRetry={() => staffQuery.refetch()} tone="owner" />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 pb-8 gap-3.5">
          <Text className="font-plex-medium text-owner-ink-faint text-[13px] leading-[18px]">
            Add people who help run your venue and choose exactly what each can do. Staff sign in with the
            phone number and password you set here.
          </Text>

          {adding ? (
            <AddStaffForm
              venues={venues}
              catalog={catalog}
              onCancel={() => setAdding(false)}
              onAdded={() => setAdding(false)}
            />
          ) : (
            <Pressable
              onPress={() => setAdding(true)}
              className="self-start px-4 h-11 rounded-[10px] bg-owner-accent flex-row items-center justify-center gap-2"
            >
              <PlusIcon />
              <Text className="font-plex-bold text-white text-[14px]">Add staff member</Text>
            </Pressable>
          )}

          {staff.length === 0 ? (
            <Text className="font-plex-medium text-owner-ink-faint text-center pt-8">
              No staff yet. Add your first team member above.
            </Text>
          ) : (
            staff.map((member) => <StaffCard key={member.id} member={member} catalog={catalog} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const inputCls =
  "h-11 px-3 rounded-[10px] border border-owner-border bg-white font-plex-medium text-owner-ink text-[14px]";

function PermissionRow({
  item,
  checked,
  onToggle,
}: {
  item: StaffPermissionCatalogItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const disabled = !item.available;
  return (
    <Pressable
      onPress={disabled ? undefined : onToggle}
      className="flex-row items-center gap-2.5 py-1.5"
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <View
        className="w-5 h-5 rounded-[5px] items-center justify-center border"
        style={{ backgroundColor: checked ? "#0E6274" : "#FFFFFF", borderColor: checked ? "#0E6274" : "#C6D2D7" }}
      >
        {checked ? <CheckIcon size={13} color="#FFFFFF" /> : null}
      </View>
      <Text className="font-plex-medium text-owner-ink text-[13.5px] flex-1">
        {item.label}
        {disabled ? " (feature off)" : ""}
      </Text>
    </Pressable>
  );
}

function AddStaffForm({
  venues,
  catalog,
  onCancel,
  onAdded,
}: {
  venues: { id: string; name: string }[];
  catalog: StaffPermissionCatalogItem[];
  onCancel: () => void;
  onAdded: () => void;
}) {
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
    mutationFn: () =>
      api.staff.create({
        venue_id: effectiveVenueId,
        name: name.trim(),
        phone: toE164(phone),
        password,
        permissions: [...selected],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner-staff"] });
      onAdded();
    },
    onError: (e) => setError(friendlyErrorMessage(e)),
  });

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <View className="bg-owner-surface border border-owner-border rounded-xl p-4 gap-3">
      <Text className="font-plex-bold text-owner-ink text-[15px]">New staff member</Text>
      {venues.length > 1 ? (
        <View className="flex-row flex-wrap gap-2">
          {venues.map((v) => (
            <Pressable
              key={v.id}
              onPress={() => setVenueId(v.id)}
              className="px-3 h-9 rounded-full items-center justify-center"
              style={{ backgroundColor: effectiveVenueId === v.id ? "#0E6274" : "#F4F6F7" }}
            >
              <Text
                className="font-plex-semibold text-[12.5px]"
                style={{ color: effectiveVenueId === v.id ? "#FFFFFF" : "#5B7079" }}
              >
                {v.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput className={inputCls} placeholder="Full name" placeholderTextColor="#8399A1" value={name} onChangeText={setName} />
      <TextInput
        className={inputCls}
        placeholder="Phone (03xx…)"
        placeholderTextColor="#8399A1"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />
      <TextInput
        className={inputCls}
        placeholder="Temporary password (min 8 chars)"
        placeholderTextColor="#8399A1"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <View>
        <Text className="font-plex-bold text-owner-ink-faint text-[11px] tracking-[0.6px] mb-1">WHAT THEY CAN DO</Text>
        {catalog.map((item) => (
          <PermissionRow key={item.key} item={item} checked={selected.has(item.key)} onToggle={() => toggle(item.key)} />
        ))}
      </View>
      {error ? <Text className="font-plex-semibold text-owner-danger text-[12.5px]">{error}</Text> : null}
      <View className="flex-row gap-2.5">
        <Pressable onPress={onCancel} className="flex-1 h-11 rounded-[10px] border border-owner-border items-center justify-center">
          <Text className="font-plex-semibold text-owner-ink text-[13.5px]">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => create.mutate()}
          disabled={!valid || create.isPending}
          className="flex-1 h-11 rounded-[10px] items-center justify-center bg-owner-accent"
          style={{ opacity: !valid || create.isPending ? 0.5 : 1 }}
        >
          <Text className="font-plex-bold text-white text-[13.5px]">{create.isPending ? "Adding…" : "Add staff"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StaffCard({ member, catalog }: { member: StaffMember; catalog: StaffPermissionCatalogItem[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(member.permissions));

  const labelFor = useMemo(() => {
    const m = new Map(catalog.map((c) => [c.key, c.label]));
    return (k: string) => m.get(k) ?? k;
  }, [catalog]);

  const savePerms = useMutation({
    mutationFn: () => api.staff.setPermissions(member.id, [...selected]),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["owner-staff"] });
    },
    onError: (e) => Alert.alert("Couldn't save", friendlyErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: () => api.staff.setActive(member.id, !member.is_active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["owner-staff"] }),
    onError: (e) => Alert.alert("Couldn't update", friendlyErrorMessage(e)),
  });

  function confirmToggleActive() {
    if (member.is_active) {
      Alert.alert(
        "Deactivate staff member?",
        `${member.name ?? "This staff member"} will be logged out immediately.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Deactivate", style: "destructive", onPress: () => toggleActive.mutate() },
        ],
      );
    } else {
      toggleActive.mutate();
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <View className="bg-owner-surface border border-owner-border rounded-xl p-4 gap-2">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text className="font-plex-bold text-owner-ink text-[14px]">
            {member.name ?? "Staff"}
            {!member.is_active ? <Text className="font-plex-bold text-owner-danger text-[11px]">  · INACTIVE</Text> : null}
          </Text>
          <Text className="font-mono-medium text-owner-ink-faint text-[11.5px]">
            {member.phone} · {member.venue_name}
          </Text>
        </View>
      </View>

      {editing ? (
        <View className="gap-2">
          {catalog.map((item) => (
            <PermissionRow key={item.key} item={item} checked={selected.has(item.key)} onToggle={() => toggle(item.key)} />
          ))}
          <Pressable
            onPress={() => savePerms.mutate()}
            disabled={savePerms.isPending}
            className="self-start px-4 h-10 rounded-[10px] bg-owner-accent items-center justify-center"
            style={{ opacity: savePerms.isPending ? 0.5 : 1 }}
          >
            <Text className="font-plex-bold text-white text-[13px]">{savePerms.isPending ? "Saving…" : "Save permissions"}</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-1.5">
          {member.permissions.length === 0 ? (
            <Text className="font-plex-medium text-owner-ink-faint text-[12px]">No permissions yet</Text>
          ) : (
            member.permissions.map((p) => (
              <View key={p} className="px-2 py-0.5 rounded-md bg-owner-bg">
                <Text className="font-plex-medium text-owner-ink-muted text-[11.5px]">{labelFor(p)}</Text>
              </View>
            ))
          )}
        </View>
      )}

      <View className="flex-row gap-4 pt-1">
        <Pressable onPress={() => setEditing((v) => !v)}>
          <Text className="font-plex-bold text-owner-accent text-[13px]">{editing ? "Cancel" : "Edit permissions"}</Text>
        </Pressable>
        <Pressable onPress={confirmToggleActive} disabled={toggleActive.isPending}>
          <Text className="font-plex-bold text-[13px]" style={{ color: member.is_active ? "#B23B3B" : "#1F7A52" }}>
            {member.is_active ? "Deactivate" : "Reactivate"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
