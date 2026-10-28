import { Fragment } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useIsFocused } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Crown,
  History,
  IdCard,
  LogOut,
  MessageCircle,
  Plus,
  Receipt,
  RotateCcw,
  ScanLine,
  Star,
  Store,
  TrendingUp,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import { palette, radius, shadow, size, space } from "@court-booking/ui-tokens";
import { Avatar, Badge, Hero, ListRow, Pill, SegmentedToggle, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { confirmLogout } from "@/lib/logout";
import { openSupportWhatsApp } from "@/lib/support";
import { moreItemAllowed, type MoreItemKey } from "@/lib/owner-access";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { useOwnerLang } from "@/lib/owner-lang";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useOwnerIdentity } from "@/components/identity-card";
import { useOwnerBadges } from "@/components/owner-tab-bar";
import { GroupCard, GroupLabel, IconTile } from "../_fl";

interface Item {
  key: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  tone?: "teal" | "open" | "waiting" | "danger" | "neutral";
  onPress: () => void;
  ownerOnly?: boolean;
  /** Staff see it only with the matching permission (lib/owner-access.ts). */
  gate?: MoreItemKey;
  /** Extra permission needed for an entry outside MORE_NEEDS (Ledger / Refunds). */
  perm?: "view_ledger" | "mark_refunds";
  /** Feature flag that hides the entry when explicitly off (unknown = shown; the server still enforces it). */
  flag?: string;
  badge?: { text: string; tone: "count" | "waiting" | "neutral" } | null;
}

/** OwnerMore board ("Aur"): grouped menu, real badges, feature-flag + permission gating, Zabaan, Help WhatsApp, Log out.
 * A staff member without view_ledger sees the OStaffView limited view at the top (Check-in / Walk-in only). */
export default function OwnerMoreScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === "owner";
  const staff = user?.role === "staff";
  const { can, settled } = useMyPermissions();
  const flags = useFeatureFlags();
  const { lang, setLang } = useOwnerLang();
  const { activeVenue } = useOwnerVenues();
  const focused = useIsFocused();
  const badges = useOwnerBadges(focused);
  const identity = useOwnerIdentity();
  const staffList = useQuery({ queryKey: ["owner-staff-count"], queryFn: () => api.staff.list(), enabled: isOwner, retry: false, staleTime: 60_000 });
  const go = (path: string) => () => router.push(path as never);
  const limited = staff && settled && !can("view_ledger");

  const groups: { title: string; items: Item[] }[] = [
    {
      title: "Bookings",
      items: [
        { key: "history", label: "Bookings history", sub: "Search, filters, CSV export", icon: History, gate: "history", onPress: go("/(owner)/history") },
        { key: "checkin", label: "Check-in", sub: "Player ka QR scan ya booking ID", icon: ScanLine, gate: "checkin", onPress: go("/(owner)/checkin") },
        { key: "walkin", label: "Add booking", sub: "Walk-in, phone ya regular", icon: Plus, gate: "walkin", onPress: go("/(owner)/walkin") },
      ],
    },
    {
      title: "Paisa",
      items: [
        { key: "ledger", label: "Ledger", sub: "Har payment ka hisaab", icon: Receipt, tone: "open", perm: "view_ledger", onPress: () => router.navigate("/(owner)/(tabs)/ledger") },
        {
          key: "refunds",
          label: "Refunds",
          sub: "Players ko wapas dene hain",
          icon: RotateCcw,
          tone: "danger",
          perm: "mark_refunds",
          badge: badges.refunds > 0 ? { text: String(badges.refunds), tone: "count" } : null,
          onPress: () => router.navigate("/(owner)/(tabs)/refunds"),
        },
        { key: "premium", label: "Premium", sub: "Features aur billing", icon: Crown, tone: "waiting", ownerOnly: true, onPress: go("/(owner)/premium") },
      ],
    },
    {
      title: "Venue",
      items: [
        { key: "venueSettings", label: "Venue settings", sub: "Tafseel, courts, qeemat, timers, photos", icon: Store, gate: "venueSettings", onPress: go("/(owner)/venue-settings") },
        {
          key: "cnic",
          label: "Shanakht (CNIC)",
          sub: "Payout ke liye zaroori",
          icon: IdCard,
          tone: identity.data?.status === "missing" ? "waiting" : "teal",
          ownerOnly: true,
          badge: identity.data?.status === "missing" ? { text: "Baqi", tone: "waiting" } : null,
          onPress: () => router.push({ pathname: "/(owner)/venue-settings", params: { section: "cnic" } }),
        },
      ],
    },
    {
      title: "Team aur growth",
      items: [
        {
          key: "staff",
          label: "Staff",
          sub: staffList.data ? `${staffList.data.length} ${staffList.data.length === 1 ? "member" : "members"} · permissions` : "Members aur permissions",
          icon: Users,
          ownerOnly: true,
          badge: staffList.data && staffList.data.length > 0 ? { text: String(staffList.data.length), tone: "neutral" } : null,
          onPress: go("/(owner)/staff"),
        },
        // audit 2026-10-28 item 16: what each person marked and recorded (owner only)
        { key: "staffActivity", label: "Staff ka kaam", sub: "No-show, cash, kam mila: kis ne kya kiya", icon: Users, ownerOnly: true, onPress: go("/(owner)/staff-activity") },
        { key: "growth", label: "Growth suggestions", sub: "Kam bharne wale ghante", icon: TrendingUp, tone: "open", gate: "growth", flag: "growth_suggestions", onPress: go("/(owner)/growth") },
        { key: "reviews", label: "Reviews", sub: "Players ki rai aur jawab", icon: Star, gate: "reviews", flag: "reviews", onPress: go("/(owner)/reviews") },
        { key: "notifications", label: "Notifications", sub: "Payments, bookings, refunds", icon: Bell, onPress: go("/(owner)/notifications") },
      ],
    },
    {
      title: "Account",
      items: [{ key: "account", label: "Account", sub: "Naam, phone, password", icon: UserRound, onPress: go("/(owner)/account") }],
    },
  ];

  const visible = (i: Item) =>
    (!i.ownerOnly || isOwner) &&
    // A staff member's list waits for the permissions answer, so a forbidden entry never flashes.
    (!i.gate || (staff && !settled ? false : moreItemAllowed(i.gate, can, staff))) &&
    (!i.perm || (staff && !settled ? false : can(i.perm))) &&
    (!i.flag || flags.on(i.flag));

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: size.tabBarOwner + 64 }}>
        <Hero topInset={insets.top} style={{ paddingBottom: space[8] + 28 }}>
          <Text variant="h1" tone="hero" accessibilityRole="header">
            Aur
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], backgroundColor: palette.white, borderRadius: 22, padding: space[3], boxShadow: shadow.card }}>
            <Avatar name={user?.name ?? "Owner"} size={48} tone="teal" uri={user?.avatar_url} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{user?.name ?? "Owner"}</Text>
              <Text variant="meta" tone="muted">{`${activeVenue?.name ?? "Venue"} · ${isOwner ? "Owner" : staff ? "Staff" : "Admin"}`}</Text>
            </View>
            <Pressable onPress={go("/(owner)/account")} accessibilityRole="button" accessibilityLabel="Profile kholein" style={{ minHeight: size.tap, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: palette.tealTint, justifyContent: "center" }}>
              <Text variant="bodyBold" tone="info">
                Profile
              </Text>
            </Pressable>
          </View>
        </Hero>

        <View style={{ marginTop: -28, backgroundColor: palette.ground, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space[4], paddingTop: space[5], gap: space[4] }}>
          {limited ? (
            <View testID="staff-limited" style={{ gap: space[3] }}>
              <Pill tone="info" label="Khelo Staff · Limited view" />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
                {can("check_in") ? <BigTile label="Check-in scan" icon={ScanLine} onPress={go("/(owner)/checkin-scan")} /> : null}
                {can("walkin") ? <BigTile label="Walk-in" icon={Plus} onPress={go("/(owner)/walkin")} /> : null}
              </View>
              <Text variant="meta" tone="muted">
                Paisa aur settings sirf owner dekh sakta hai. Zyada access ke liye owner se kahein.
              </Text>
            </View>
          ) : null}

          {groups.map((g) => {
            const items = g.items.filter(visible);
            if (items.length === 0) return null;
            return (
              <View key={g.title} style={{ gap: space[2] }}>
                <GroupLabel>{g.title}</GroupLabel>
                <GroupCard>
                  {items.map((i, idx) => (
                    <Fragment key={i.key}>
                      <ListRow
                        testID={`more-${i.key}`}
                        title={i.label}
                        subtitle={i.sub}
                        leading={<IconTile icon={i.icon} tone={i.tone ?? "teal"} />}
                        onPress={i.onPress}
                        divider={idx < items.length - 1}
                        accessibilityLabel={i.badge ? `${i.label}, ${i.badge.text}` : i.label}
                        trailing={
                          i.badge ? (
                            i.badge.tone === "count" ? (
                              <Badge count={Number(i.badge.text)} />
                            ) : (
                              <Pill size="sm" tone={i.badge.tone === "waiting" ? "waiting" : "neutral"} label={i.badge.text} />
                            )
                          ) : undefined
                        }
                      />
                    </Fragment>
                  ))}
                </GroupCard>
              </View>
            );
          })}

          <View style={{ gap: space[2] }}>
            <GroupLabel>Zabaan</GroupLabel>
            <SegmentedToggle
              testID="owner-lang"
              accessibilityLabel="Zabaan"
              value={lang}
              onChange={setLang}
              options={[
                { value: "ru", label: "Roman Urdu" },
                { value: "en", label: "English" },
              ]}
            />
            <Text variant="caption" tone="muted">
              {lang === "en" ? "English abhi buttons aur aam messages par lagta hai; baqi screens Roman Urdu mein hain." : "Roman Urdu chal raha hai."}
            </Text>
          </View>

          <GroupCard>
            <ListRow title="Madad · WhatsApp" subtitle="Koi masla ho to message karein" leading={<IconTile icon={MessageCircle} tone="open" />} onPress={() => openSupportWhatsApp()} divider />
            <ListRow title="Log out" leading={<IconTile icon={LogOut} tone="danger" />} danger onPress={() => confirmLogout()} />
          </GroupCard>
        </View>
      </ScrollView>
    </View>
  );
}

function BigTile({ label, icon: Icon, onPress }: { label: string; icon: LucideIcon; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flexGrow: 1, flexBasis: 130, minHeight: 104, borderRadius: radius.card, backgroundColor: palette.teal, padding: space[4], justifyContent: "space-between", gap: space[2] }}
    >
      <Icon size={26} color={palette.white} />
      <Text variant="bodyStrong" tone="onDark">
        {label}
      </Text>
    </Pressable>
  );
}
