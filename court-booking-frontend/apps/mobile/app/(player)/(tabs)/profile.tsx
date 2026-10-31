import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CircleHelp, FileText, Languages, LogOut, Pencil, ShieldCheck } from "lucide-react-native";
import { CITY_OPTIONS, formatDate, formatTime, pointsReasonLabel, type WaitlistEntry } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";

import { Avatar, Button, Card, IconButton, ListRow, Screen, Sheet, Text, useCopy, useLang, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { logoutNow } from "@/lib/logout";
import { usePlayerLang } from "@/lib/player-lang";
import { SUPPORT_WHATSAPP_NUMBER, openSupportWhatsApp } from "@/lib/support";
import { useFavorites } from "@/lib/use-favorites";
import { useUnreadNotifications } from "@/lib/use-unread-notifications";
import { openPrivacy, openTerms } from "@/lib/web-links";
import { PlayerOfflineBanner, sportLabel } from "../_components";

/** PAccount board frame 1: profile card, stats ONLY from the real counters on /auth/me, saved venues, menu, Logout. */
export default function PlayerProfileScreen() {
  const copy = useCopy();
  const lang = useLang();
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setLang = usePlayerLang((s) => s.setLang);
  const bell = useUnreadNotifications();
  const fav = useFavorites();
  const waitlistQuery = useQuery({ queryKey: ["waitlist-mine"], queryFn: () => api.waitlist.mine() });
  const activeEntries = (waitlistQuery.data ?? []).filter((e) => e.is_active);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const city = CITY_OPTIONS.find((c) => c.value === user?.city)?.label.replace(/\s*\(.*\)$/, "");

  async function leaveWaitlist(entryId: string) {
    try {
      await api.waitlist.leave(entryId);
      await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
    } catch (e) {
      toast.show({ message: friendlyErrorMessage(e), tone: "danger" });
    }
  }

  const stats = user
    ? [
        { n: user.total_bookings, l: copy("Bookings", "Bookings") },
        { n: user.total_no_shows, l: copy("No-show", "No-shows") },
        { n: user.total_rejections, l: copy("Reject hui", "Rejected") },
      ]
    : [];

  return (
    <Screen floatingBar="tabs" testID="profile-screen">
      <PlayerOfflineBanner />
      <Card variant="night" padding={5} radiusSize="cardL" style={{ gap: space[4] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
          {user?.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={{ width: 60, height: 60, borderRadius: 30 }} accessibilityLabel={copy("Aap ki tasveer", "Your photo")} />
          ) : (
            <Avatar name={user?.name ?? user?.phone ?? "?"} size={60} tone="orange" uri={user?.avatar_url} />
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" tone="onDark">
              {user?.name ?? copy("Player", "Player")}
            </Text>
            <Text variant="meta" tone="onDarkMuted">
              {[user?.phone, city].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <IconButton icon={Pencil} variant="onDark" accessibilityLabel={copy("Profile edit karein", "Edit profile")} onPress={() => router.push("/(player)/edit-profile")} testID="profile-edit" />
        </View>
        <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
          {stats.map((s) => (
            <View key={s.l} style={{ flexGrow: 1, flexBasis: 80, borderRadius: radius.input, backgroundColor: palette.ground, paddingVertical: space[3], paddingHorizontal: space[3], gap: 2 }} accessibilityLabel={`${s.l}: ${s.n}`}>
              <Text variant="h3">{String(s.n)}</Text>
              <Text variant="caption" weight="bold" tone="muted">
                {s.l}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <PointsCard />

      {fav.enabled ? (
        <View style={{ gap: space[2] }}>
          <Text variant="title" accessibilityRole="header">
            {copy("Saved venues", "Saved venues")}
          </Text>
          {fav.venues.length === 0 ? (
            <Text variant="meta" tone="muted">
              {copy("Kisi bhi venue par dil dabayein, wo yahan aa jayega.", "Tap the heart on any venue to keep it here.")}
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }} testID="profile-saved">
              {fav.venues.map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => router.push({ pathname: "/(player)/venue/[slug]", params: { slug: v.slug } })}
                  accessibilityRole="button"
                  accessibilityLabel={v.name}
                  style={({ pressed }) => ({ width: 160, minHeight: 96, borderRadius: radius.tile, backgroundColor: palette.white, overflow: "hidden", opacity: pressed ? 0.85 : 1 })}
                >
                  {v.photo_urls?.[0] ? <Image source={{ uri: v.photo_urls[0] }} style={{ width: 160, height: 56 }} contentFit="cover" /> : <View style={{ height: 56, backgroundColor: palette.teal }} />}
                  <View style={{ padding: space[2], gap: 1 }}>
                    {v.sports[0] ? (
                      <Text variant="caption" tone="muted">
                        {sportLabel(v.sports[0])}
                      </Text>
                    ) : null}
                    <Text variant="bodyBold">{v.name}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      {activeEntries.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Text variant="title" accessibilityRole="header">
            {copy("Meri waitlist", "My waitlist")}
          </Text>
          {activeEntries.map((e) => (
            <WaitlistRow key={e.id} entry={e} onLeave={() => leaveWaitlist(e.id)} />
          ))}
        </View>
      ) : null}

      <View style={{ backgroundColor: palette.white, borderRadius: radius.card, overflow: "hidden" }}>
        <ListRow icon={Bell} title={copy("Notifications", "Notifications")} subtitle={bell.unread ? copy(`${bell.label} nayi`, `${bell.label} new`) : undefined} onPress={() => router.push("/(player)/notifications")} divider />
        <ListRow icon={Pencil} title={copy("Profile edit karein", "Edit profile")} subtitle={copy("Naam, email, shehar, tasveer", "Name, email, city, photo")} onPress={() => router.push("/(player)/edit-profile")} divider />
        <ListRow
          icon={Languages}
          title={copy("Zabaan", "Language")}
          subtitle={lang === "en" ? "English" : "Roman Urdu"}
          onPress={() => setLang(lang === "en" ? "ru" : "en")}
          accessibilityLabel={copy("Zabaan badlein, abhi Roman Urdu", "Change language, now English")}
          divider
        />
        <ListRow icon={CircleHelp} title={copy("Madad (WhatsApp)", "Help (WhatsApp)")} subtitle={SUPPORT_WHATSAPP_NUMBER} onPress={() => openSupportWhatsApp()} divider />
        <ListRow icon={FileText} title={copy("Terms", "Terms")} onPress={openTerms} divider />
        <ListRow icon={ShieldCheck} title={copy("Privacy", "Privacy")} onPress={openPrivacy} />
      </View>

      <Button label={copy("Logout", "Log out")} variant="danger" block icon={<LogOut size={18} color={palette.danger} />} onPress={() => setLogoutOpen(true)} testID="profile-logout" />

      <Sheet
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title={copy("Logout karein?", "Log out?")}
        footer={
          <View style={{ gap: space[3] }}>
            <Button
              label={copy("Haan, logout", "Yes, log out")}
              variant="dangerSolid"
              block
              loading={loggingOut}
              onPress={async () => {
                setLoggingOut(true);
                await logoutNow();
              }}
              testID="profile-logout-confirm"
            />
            <Button label={copy("Nahi", "No")} variant="soft" size="md" block onPress={() => setLogoutOpen(false)} />
          </View>
        }
      >
        <Text variant="body">{copy("Dobara login ke liye mobile number aur password chahiye hoga.", "You'll need your mobile number and password to log in again.")}</Text>
      </Sheet>
    </Screen>
  );
}

function WaitlistRow({ entry, onLeave }: { entry: WaitlistEntry; onLeave: () => void }) {
  const copy = useCopy();
  const lang = useLang();
  return (
    <Card padding={4} radiusSize="tile" style={{ flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
      <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
        <Text variant="bodyBold">{`${entry.venue_name} · ${entry.court_name}`}</Text>
        <Text variant="meta" tone="muted">
          {`${formatDate(entry.slot_starts_at, new Date(), lang)} · ${formatTime(entry.slot_starts_at)} · ${copy(`line mein #${entry.position}`, `#${entry.position} in line`)}`}
        </Text>
      </View>
      <Button label={copy("Chhorein", "Leave")} variant="danger" size="sm" onPress={onLeave} />
    </Card>
  );
}

/** audit 2026-10-28 Phase 3 item 3 (flag player_points): the player's points, the rule, the last few lines. */
function PointsCard() {
  const query = useQuery({ queryKey: ["my-points"], queryFn: () => api.phase3.myPoints() });
  const data = query.data;
  if (!data?.enabled) return null;
  return (
    <Card padding={4} radiusSize="cardL" style={{ gap: space[2] }} testID="profile-points">
      <Text variant="title" accessibilityRole="header">{`Points: ${data.balance}`}</Text>
      <Text variant="meta" tone="muted">{data.rule_text_ru}</Text>
      {data.entries.slice(0, 5).map((e) => (
        <View key={e.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
          <Text variant="body" style={{ flex: 1 }}>{`${pointsReasonLabel(e.reason, "ru")}${e.code ? ` · ${e.code}` : ""}`}</Text>
          <Text variant="bodyStrong" tone={e.delta < 0 ? "danger" : "primary"}>{e.delta > 0 ? `+${e.delta}` : String(e.delta)}</Text>
        </View>
      ))}
    </Card>
  );
}
