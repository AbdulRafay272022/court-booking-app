import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { CITY_OPTIONS, GENDER_OPTIONS, validateProfile, type City, type Gender } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { space } from "@court-booking/ui-tokens";

import { Avatar, Banner, Button, Card, Chip, Header, Input, Screen, SegmentedToggle, Sheet, Text, useCopy, useLang, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePlayerLang, type PlayerLang } from "@/lib/player-lang";
import { safeBack } from "@/lib/safe-back";
import { PLAYER_HOME_HREF } from "@/lib/safe-back-rules";
import { SelectSheetField } from "../(auth)/_fl";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** PAccount board frame 3: photo, name / email / city / gender (PATCH /auth/me), Zabaan toggle, phone + password rows. */
export default function PlayerEditProfileScreen() {
  const copy = useCopy();
  const lang = useLang();
  const toast = useToast();
  const setLang = usePlayerLang((s) => s.setLang);
  const user = useAuthStore((s) => s.user)!;
  const [f, setF] = useState({ name: user.name ?? "", email: user.email ?? "", city: user.city ?? "", gender: user.gender ?? "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);

  const errors = validateProfile(f);
  const valid = Object.keys(errors).length === 0;
  const dirty = f.name.trim() !== (user.name ?? "") || f.email.trim().toLowerCase() !== (user.email ?? "").toLowerCase() || f.city !== (user.city ?? "") || f.gender !== (user.gender ?? "");
  const set = (key: keyof typeof f, value: string) => {
    setF((p) => ({ ...p, [key]: value }));
    if (key === "email") setEmailTaken(false);
  };
  const touch = (key: string) => setTouched((p) => ({ ...p, [key]: true }));

  async function pickAvatar() {
    setAvatarError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setAvatarError(copy("Photos ki ijazat dein (phone Settings).", "Allow photo access in your phone Settings."));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = asset.mimeType ?? "image/jpeg";
    if (!AVATAR_MIME_ALLOWED.has(mime)) return setAvatarError(copy("JPEG, PNG ya WebP tasveer chunein.", "Pick a JPEG, PNG or WebP image."));
    if (typeof asset.fileSize === "number" && asset.fileSize > AVATAR_MAX_BYTES) return setAvatarError(copy("Tasveer 5 MB se bari hai.", "That image is over 5 MB."));
    setPreview(asset.uri);
    setAvatarBusy(true);
    try {
      const updated = await api.users.uploadAvatar(asset.uri, asset.fileName ?? "avatar.jpg", mime);
      useAuthStore.getState().setUser(updated, useAuthStore.getState().session ?? undefined);
    } catch (e) {
      setAvatarError(friendlyErrorMessage(e));
      setPreview(null);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function save() {
    if (!valid || !dirty || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.auth.updateMe({ name: f.name.trim(), email: f.email.trim(), city: f.city as City, gender: f.gender as Gender });
      useAuthStore.getState().setUser(updated, useAuthStore.getState().session ?? undefined);
      setF({ name: updated.name ?? "", email: updated.email ?? "", city: updated.city ?? "", gender: updated.gender ?? "" });
      toast.show({ message: copy("Profile save ho gaya", "Profile saved"), tone: "success" });
    } catch (e) {
      if (e instanceof ApiError && e.code === "EMAIL_ALREADY_IN_USE") setEmailTaken(true);
      else setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const uri = preview ?? user.avatar_url ?? null;
  return (
    <Screen keyboard testID="edit-profile-screen">
      <Header title={copy("Profile", "Profile")} onBack={() => safeBack(PLAYER_HOME_HREF)} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[4], flexWrap: "wrap" }}>
        {uri ? <Image source={{ uri }} style={{ width: 72, height: 72, borderRadius: 36 }} accessibilityLabel={copy("Aap ki tasveer", "Your photo")} /> : <Avatar name={user.name ?? user.phone} size={72} tone="orange" />}
        <View style={{ gap: space[1], flexShrink: 1 }}>
          <Button label={uri ? copy("Tasveer badlein", "Change photo") : copy("Tasveer lagayein", "Add a photo")} variant="soft" size="sm" loading={avatarBusy} onPress={pickAvatar} />
          <Text variant="caption" tone="muted">
            JPEG, PNG, WebP · 5 MB
          </Text>
        </View>
      </View>
      {avatarError ? <Banner tone="danger" body={avatarError} /> : null}

      <Input label={copy("Poora naam", "Full name")} value={f.name} onChangeText={(v) => set("name", v)} onBlur={() => touch("name")} error={touched.name ? errors.name : null} autoCapitalize="words" testID="profile-name" />
      <Input
        label={copy("Email", "Email address")}
        value={f.email}
        onChangeText={(v) => set("email", v)}
        onBlur={() => touch("email")}
        error={emailTaken ? copy("Ye email pehle se istemal mein hai.", "That email address is already in use.") : touched.email ? errors.email : null}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <SelectSheetField label={copy("Shehar", "City")} value={f.city as City | ""} options={CITY_OPTIONS} placeholder={copy("Shehar chunein", "Select your city")} error={touched.city ? errors.city : null} onChange={(v) => { set("city", v); touch("city"); }} />
      <View style={{ gap: space[2] }}>
        <Text variant="label">{copy("Gender", "Gender")}</Text>
        <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
          {GENDER_OPTIONS.map((g) => (
            <Chip key={g.value} label={g.label} selected={f.gender === g.value} onPress={() => { set("gender", g.value); touch("gender"); }} />
          ))}
        </View>
      </View>

      <View style={{ gap: space[2] }}>
        <Text variant="bodyBold" weight="black">
          {copy("Zabaan", "Language")}
        </Text>
        <SegmentedToggle<PlayerLang>
          accessibilityLabel={copy("Zabaan", "Language")}
          value={lang}
          onChange={setLang}
          options={[
            { value: "ru", label: "Roman Urdu" },
            { value: "en", label: "English" },
          ]}
          testID="profile-lang"
        />
      </View>

      {error ? <Banner tone="danger" body={error} /> : null}
      <Button label={copy("Save karein", "Save")} block loading={busy} disabled={!valid || !dirty} onPress={save} testID="profile-save" />

      <Card padding={4} radiusSize="tile" style={{ gap: space[2] }}>
        <Text variant="caption" weight="bold" tone="muted">
          {copy("Mobile number", "Mobile number")}
        </Text>
        <Text variant="bodyStrong">{user.phone}</Text>
        <Text variant="meta" tone="muted">
          {copy("Badalne ke liye password aur naye number par code chahiye.", "Changing it needs your password and a code on the new number.")}
        </Text>
        <Button label={copy("Number badlein", "Change number")} variant="soft" size="sm" onPress={() => router.push("/(player)/change-phone")} />
      </Card>
      <Card padding={4} radiusSize="tile" style={{ gap: space[2] }}>
        <Text variant="caption" weight="bold" tone="muted">
          {copy("Password", "Password")}
        </Text>
        <Text variant="meta" tone="muted">
          {copy("\"Password bhool gaye\" wala WhatsApp reset istemal hota hai.", "Uses the same WhatsApp reset as \"Forgot password\".")}
        </Text>
        <Button label={copy("Password badlein", "Change password")} variant="soft" size="sm" onPress={() => setPwOpen(true)} />
      </Card>

      <Sheet
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={copy("Password badlein?", "Change password?")}
        footer={
          <View style={{ gap: space[3] }}>
            <Button
              label={copy("Aage barhein", "Continue")}
              block
              onPress={() => {
                void useAuthStore.getState().signOut();
                setTimeout(() => router.replace({ pathname: "/(auth)/forgot-password", params: { phone: user.phone } }), 60);
              }}
            />
            <Button label={copy("Nahi", "No")} variant="soft" size="md" block onPress={() => setPwOpen(false)} />
          </View>
        }
      >
        <Text variant="body">
          {copy(
            "Hum aap ko logout karke WhatsApp par code bhejenge taake naya password chun sakein. Ye har device se logout karta hai.",
            "We'll log you out and send a code on WhatsApp so you can choose a new password. It logs you out on every device.",
          )}
        </Text>
      </Sheet>
    </Screen>
  );
}
