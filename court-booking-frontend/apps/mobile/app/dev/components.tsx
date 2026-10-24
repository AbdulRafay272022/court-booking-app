import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, CalendarDays, House, MessageCircle, Search, Settings, ShieldCheck, User, Wallet } from "lucide-react-native";
import { formatPkr, journeySteps, palette, slotChipState, type Role, type SlotChipState, type VenueCardData } from "@court-booking/ui-tokens";
import {
  ActionBar,
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  CopyField,
  CountdownRing,
  EmptyState,
  ErrorState,
  FontScaleProvider,
  GlassBar,
  Header,
  Hero,
  IconButton,
  Input,
  LangProvider,
  ListRow,
  MoneyRows,
  NotFound,
  OfflineBanner,
  OtpInput,
  Pill,
  RadioGroup,
  RoleProvider,
  SectionHeader,
  SegmentedToggle,
  Sheet,
  SkeletonCard,
  SkeletonList,
  SlotChip,
  StatusPill,
  StepBar,
  StepNumber,
  Stepper,
  Switch,
  TabBar,
  Text,
  Ticket,
  Timeline,
  ToastProvider,
  ToastView,
  VenueCard,
  useToast,
  type Lang,
} from "@/components/ui";

/**
 * DEV ONLY component gallery: every Floodlight component in every state, for both roles.
 * Query params: ?role=player|owner &lang=ru|en &fs=1|1.3|1.6 (font scale preview on Expo web).
 * Release builds redirect away (`__DEV__` is false there). Sample values below are DEV SAMPLES, never product data.
 */
export default function DevComponents() {
  const params = useLocalSearchParams<{ role?: string; lang?: string; fs?: string }>();
  const [role, setRole] = useState<Role>(params.role === "owner" ? "owner" : "player");
  const [lang, setLang] = useState<Lang>(params.lang === "en" ? "en" : "ru");
  const [fs, setFs] = useState<string>(params.fs === "1.3" || params.fs === "1.6" ? params.fs : "1");
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <RoleProvider role={role}>
      <LangProvider lang={lang}>
        <FontScaleProvider scale={Number(fs)}>
          <ToastProvider>
            <Gallery role={role} setRole={setRole} lang={lang} setLang={setLang} fs={fs} setFs={setFs} />
          </ToastProvider>
        </FontScaleProvider>
      </LangProvider>
    </RoleProvider>
  );
}

/** DEV SAMPLE photo: an inline SVG built from tokens (no network, no real venue photo). */
function samplePhoto(bg: string, label: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='720' height='300'><rect width='720' height='300' fill='${bg}'/><path d='M140 280 200 80h316l60 200zM358 80v200M172 180h372' stroke='${palette.white}' stroke-opacity='0.5' stroke-width='4' fill='none'/><text x='24' y='280' font-family='sans-serif' font-size='26' fill='${palette.white}'>DEV SAMPLE ${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <Text variant="eyebrow" tone="muted">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>{children}</View>;
}

function Gallery(p: { role: Role; setRole: (r: Role) => void; lang: Lang; setLang: (l: Lang) => void; fs: string; setFs: (f: string) => void }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [chip, setChip] = useState("padel");
  const [seg, setSeg] = useState<"list" | "map">("list");
  const [check, setCheck] = useState(true);
  const [radio, setRadio] = useState<"amount" | "blurry" | null>("amount");
  const [sw, setSw] = useState(true);
  const [sw2, setSw2] = useState(false);
  const [otp, setOtp] = useState("1234");
  const [step, setStep] = useState(15);
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);
  const expiresAt = useMemo(() => new Date(Date.now() + (14 * 60 + 56) * 1000).toISOString(), []);
  const expiredAt = useMemo(() => new Date(Date.now() - 1000).toISOString(), []);
  const owner = p.role === "owner";

  const now = Date.parse("2026-10-24T12:00:00Z");
  const base = { starts_at: "2026-10-24T16:00:00Z", status: "available" as const, is_mine: false };
  const slotStates: { label: string; state: SlotChipState }[] = [
    { label: "8:00 PM", state: slotChipState(base, { now })! },
    { label: "8:30 PM", state: slotChipState(base, { now, selectedStart: base.starts_at })! },
    { label: "9:00 PM", state: slotChipState(base, { now, inRange: [base.starts_at] })! },
    { label: "9:30 PM", state: slotChipState({ ...base, status: "held" }, { now })! },
    { label: "10:00 PM", state: slotChipState({ ...base, status: "booked" }, { now })! },
    { label: "10:30 PM", state: slotChipState(base, { now, fits: false })! },
    { label: "11:00 PM", state: slotChipState({ ...base, status: "blocked" }, { now })! },
    { label: "11:30 PM", state: slotChipState({ ...base, status: "booked", is_mine: true }, { now })! },
  ];

  const venue = (n: number, name: string, amen: string[]): VenueCardData => ({
    id: `dev-${n}-${name}`,
    slug: "dev",
    name,
    sport: "Padel",
    area: "DHA Phase 6",
    distance: "1.2 km",
    rating: n === 3 ? 4.0 : null,
    reviewCount: n === 3 ? 12 : 0,
    priceFrom: n === 0 ? null : formatPkr(2000),
    nextFree: n === 3 ? "DEV: Agla khaali 8 PM" : null,
    photos: Array.from({ length: n }, (_, i) => samplePhoto([palette.teal, palette.night, palette.tealDeep][i % 3], String(i + 1))),
    amenities: amen,
  });

  const playerTabs = [
    { key: "home", label: "Home", icon: House, active: true, onPress: () => undefined },
    { key: "bookings", label: "Bookings", icon: CalendarDays, onPress: () => undefined },
    { key: "chat", label: "Chat", icon: MessageCircle, badge: 1, accessibilityLabel: "Chat, 1 naya", onPress: () => undefined },
    { key: "profile", label: "Profile", icon: User, onPress: () => undefined },
  ];
  const ownerTabs = [
    { key: "today", label: "Aaj", icon: CalendarDays, active: true, onPress: () => undefined },
    { key: "approvals", label: "Approvals", icon: ShieldCheck, badge: 3, accessibilityLabel: "Approvals, 3 baqi", onPress: () => undefined },
    { key: "paisa", label: "Paisa", icon: Wallet, onPress: () => undefined },
    { key: "more", label: "Aur", icon: Settings, onPress: () => undefined },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <ScrollView testID="dev-components" contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 140, paddingHorizontal: owner ? 16 : 20, gap: 28 }}>
        <Header title="Floodlight components" eyebrow="DEV ONLY" subtitle={`Role: ${p.role} · Lang: ${p.lang} · Font x${p.fs}`} onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <SegmentedToggle accessibilityLabel="Role" value={p.role} onChange={p.setRole} options={[{ value: "player", label: "Player" }, { value: "owner", label: "Owner" }]} testID="dev-role" />
        <SegmentedToggle accessibilityLabel="Language" value={p.lang} onChange={p.setLang} options={[{ value: "ru", label: "Roman Urdu" }, { value: "en", label: "English" }]} testID="dev-lang" />
        <SegmentedToggle accessibilityLabel="Font scale" value={p.fs} onChange={p.setFs} options={[{ value: "1", label: "Font 1x" }, { value: "1.3", label: "1.3x" }, { value: "1.6", label: "1.6x" }]} testID="dev-fs" />

        <Section title="Type">
          <Text variant="displayXL">{formatPkr(4000)}</Text>
          <Text variant="h1">Court dhoondo.</Text>
          <Text variant="h2">Account banayein</Text>
          <Text variant="title">Demo Arena</Text>
          <Text variant="bodyL">Body 16: Bricolage for big numbers, Plus Jakarta for reading.</Text>
          <Text variant="body" tone="muted">Muted 14 (muted token)</Text>
          <Text variant="caption" tone="subtle">Caption 12 subtle</Text>
          <Text variant="bodyBold" tone="link">Link text (role)</Text>
        </Section>

        <Section title="Button">
          <Button label={owner ? "Approve karein" : "Book karo"} onPress={() => toast.show({ message: "Pressed", tone: "success" })} block testID="dev-btn-primary" />
          <Row>
            <Button label="Wahi slot" variant="secondary" size="md" />
            <Button label="Home par jayein" variant="soft" size="md" />
            <Button label="Reject" variant="danger" size="md" />
          </Row>
          <Row>
            <Button label="Cancel karein" variant="dangerSolid" size="sm" />
            <Button label="Small" size="sm" />
            <Button label="Loading" loading size="md" />
            <Button label="Disabled" disabled size="md" />
          </Row>
        </Section>

        <Section title="IconButton (44pt, label required)">
          <Row>
            <IconButton icon={Search} accessibilityLabel="Search" />
            <IconButton icon={Bell} accessibilityLabel="Notifications, 3 nayi" badge={3} variant="mist" />
            <IconButton icon={MessageCircle} accessibilityLabel="Chat" variant="primary" />
            <IconButton icon={Settings} accessibilityLabel="Settings" variant="night" />
            <IconButton icon={Settings} accessibilityLabel="Disabled" disabled />
            <View style={{ backgroundColor: palette.night, padding: 8, borderRadius: 16, flexDirection: "row", gap: 8 }}>
              <IconButton icon={Search} accessibilityLabel="On dark" variant="onDark" />
              <IconButton icon={Search} accessibilityLabel="On photo" variant="onPhoto" />
            </View>
          </Row>
        </Section>

        <Section title="Chip / Pill / StatusPill / Badge">
          <Row>
            {["padel", "futsal", "cricket"].map((k) => (
              <Chip key={k} label={k[0].toUpperCase() + k.slice(1)} selected={chip === k} onPress={() => setChip(k)} />
            ))}
            <Chip label="Disabled" disabled onPress={() => undefined} />
            <Chip label="Amenities" count={6} onPress={() => undefined} />
          </Row>
          <Row>
            <Chip shape="tile" label="Court 1" meta="Padel · Indoor" selected onPress={() => undefined} />
            <Chip shape="tile" label="Court 2" meta="Padel · Outdoor" onPress={() => undefined} />
          </Row>
          <Row>
            {(["open", "waiting", "danger", "neutral", "info", "night", "accent"] as const).map((t) => (
              <Pill key={t} label={t} tone={t} />
            ))}
          </Row>
          <Row>
            <StatusPill booking={{ status: "held" }} />
            <StatusPill booking={{ status: "payment_submitted" }} />
            <StatusPill booking={{ status: "booked" }} />
            <StatusPill booking={{ status: "completed" }} />
            <StatusPill booking={{ status: "no_show" }} />
            <StatusPill booking={{ status: "cancelled", cancelled_by: "player" }} />
            <StatusPill booking={{ status: "cancelled", cancelled_by: "owner" }} />
            <StatusPill booking={{ status: "cancelled", cancelled_by: "system", cancellation_reason: "hold_expired" }} />
            <Badge count={3} />
            <Badge count={120} />
          </Row>
        </Section>

        <Section title="SlotChip (never colour-only)">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {slotStates.map((s) => (
              <View key={s.label} style={{ width: "31%", gap: 4 }}>
                <SlotChip state={s.state} label={s.label} onPress={() => undefined} reason={s.state === "blocked" ? "Maintenance" : null} testID={`dev-slot-${s.state}`} />
                <Text variant="caption" tone="muted" align="center">
                  {s.state}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Input">
          <Input label="Mobile number" prefix="+92" placeholder="300 1234567" keyboardType="phone-pad" value={phone} onChangeText={setPhone} help="WhatsApp code isi number par aayega" />
          <Input label="Password" secureToggle defaultValue="password12" />
          <Input label="Naam" defaultValue="A" error="Naam kam az kam 2 harf ka ho" />
          <Input label="Note" multiline placeholder="Wajah likhein" />
        </Section>

        <Section title="Checkbox / Radio / Switch / Segmented / OTP / Stepper">
          <Checkbox checked={check} onChange={setCheck} label="Main Terms aur Privacy se mutafiq hoon" />
          <Checkbox checked={false} onChange={() => undefined} label="Unchecked" />
          <RadioGroup
            accessibilityLabel="Reject ki wajah"
            danger
            value={radio}
            onChange={setRadio}
            options={[
              { value: "amount", label: "Amount kam hai" },
              { value: "blurry", label: "Screenshot saaf nahi", hint: "Player ko dobara bhejne ka kahein" },
            ]}
          />
          <Switch label="Approve payments" hint="Staff payment approve kar sakta hai" value={sw} onChange={setSw} />
          <Switch label="Refunds" value={sw2} onChange={setSw2} />
          <SegmentedToggle accessibilityLabel="Dikhao" value={seg} onChange={setSeg} options={[{ value: "list", label: "List" }, { value: "map", label: "Naqsha" }]} />
          <SegmentedToggle accessibilityLabel="Bookings" tone="role" value={seg} onChange={setSeg} options={[{ value: "list", label: "Aane wali", count: 3 }, { value: "map", label: "Purani", count: 6 }]} />
          <OtpInput value={otp} onChange={setOtp} />
          <OtpInput value="123456" onChange={() => undefined} error />
          <Stepper label="Hold ka waqt" unit="min" value={step} onChange={setStep} min={5} max={180} step={5} help="Default: 15 min" />
        </Section>

        <Section title="Banner / CopyField / MoneyRows">
          <Banner tone="waiting" body="Code galat hai. 3 koshishein baqi hain." />
          <Banner tone="danger" title="Duplicate screenshot" body="Ye screenshot pehle 2 bookings par use hua hai." />
          <Banner tone="info" body="CNIC verify karein · payout ke liye, 1 minute" />
          <CopyField label="Account number" value="0123 4567 8901 23 (DEV SAMPLE)" testID="dev-copy" />
          <MoneyRows rows={[{ label: "Total", value: formatPkr(4000) }, { label: "Mila", value: formatPkr(1000), tone: "open" }, { label: "Baqi", value: formatPkr(3000), strong: true }]} />
        </Section>

        <Section title="Timeline / StepBar / StepNumber">
          <Card>
            <Timeline steps={journeySteps({ status: "payment_submitted" }, p.lang)} />
          </Card>
          <Card>
            <Timeline steps={journeySteps({ status: "cancelled", proofSent: true }, p.lang)} />
          </Card>
          <Hero>
            <StepBar labels={["Hold", "Pay", "Venue check", "Booked"]} current={1} />
          </Hero>
          <Row>
            <StepNumber n={1} />
            <Text variant="bodyStrong">{formatPkr(4000)} bhejein</Text>
          </Row>
        </Section>

        <Section title="CountdownRing (from a real expiry timestamp)">
          <Hero>
            <Row>
              <CountdownRing expiresAt={expiresAt} caption="pay karne ke liye" />
              <CountdownRing expiresAt={expiredAt} caption="khatam" diameter={110} />
            </Row>
            <Text variant="h3" tone="hero">
              Hero ({p.role})
            </Text>
            <Text variant="body" tone="heroMuted">
              Muted hero text
            </Text>
          </Hero>
          <CountdownRing expiresAt={expiresAt} tone="light" caption="light tone" />
        </Section>

        <Section title="Ticket (QR only when booked)">
          <Ticket
            bookingId="00000000-0000-0000-0000-000000000000"
            booking={{ status: "booked" }}
            venueName="Demo Arena"
            eyebrow="PADEL · COURT 1"
            fields={[
              { label: "Din", value: "Mon, 26 Oct" },
              { label: "Waqt", value: "5:30 – 7:30 PM" },
              { label: "Total", value: formatPkr(4000) },
              { label: "Baqi", value: formatPkr(0) },
            ]}
          />
          <Ticket bookingId="x" booking={{ status: "payment_submitted" }} venueName="Demo Arena (waiting)" fields={[{ label: "Din", value: "Mon, 26 Oct" }]} />
        </Section>

        <Section title="VenueCard (0 / 1 / 3 photos)">
          <VenueCard venue={venue(3, "Demo Arena", ["parking", "washrooms", "changing_room", "floodlights", "drinking_water", "cafe"])} visible onPress={() => undefined} saved={saved} onToggleSave={() => setSaved((s) => !s)} times={[{ label: "8:00 PM", onPress: () => undefined }, { label: "8:30 PM", onPress: () => undefined }, { label: "9:00 PM", onPress: () => undefined }, { label: "10:00 PM", onPress: () => undefined }]} testID="dev-venue-3" />
          <VenueCard venue={venue(1, "Court 22 with a very long venue name that must wrap", ["floodlights", "seating", "equipment_rent", "prayer_area", "wifi", "Rooftop lounge"])} visible onPress={() => undefined} onToggleSave={() => undefined} testID="dev-venue-1" />
          <VenueCard venue={venue(0, "Smash Point", [])} onPress={() => undefined} testID="dev-venue-0" />
        </Section>

        <Section title="ListRow / Avatar / SectionHeader / Card">
          <SectionHeader title="Aaj raat khaali" subtitle="DHA · Padel" actionLabel="Sab dekho" onAction={() => undefined} />
          <Card padding={0}>
            <ListRow icon={Settings} title="Venue settings" subtitle="Courts, pricing, timers" onPress={() => undefined} divider />
            <ListRow leading={<Avatar name="Demo Arena" tone="teal" />} title="Demo Arena" subtitle="Screenshot mil gaya" trailing={<Badge count={1} />} onPress={() => undefined} divider />
            <ListRow icon={User} title="Logout" danger onPress={() => undefined} />
          </Card>
          <Row>
            <Avatar name="Maidan Court" />
            <Avatar name="Smash Point" tone="accent" />
            <Avatar name="Khelo" tone="orange" />
          </Row>
          <Card variant="sunken">
            <Text>Sunken card</Text>
          </Card>
          <Card variant="night">
            <Text tone="onDark">Night card</Text>
          </Card>
        </Section>

        <Section title="Sheet (@gorhom/bottom-sheet)">
          <Button label="Sheet kholein" variant="secondary" onPress={() => setSheet(true)} testID="dev-open-sheet" />
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Booking pakki karein?" subtitle="Demo Arena · Court 1" testID="dev-sheet" footer={<Button label="Haan, hold karo" block onPress={() => setSheet(false)} />}>
            <MoneyRows rows={[{ label: "Abhi bhejna", value: formatPkr(1000) }, { label: "Venue par baqi", value: formatPkr(3000) }, { label: "Total", value: formatPkr(4000), strong: true }]} />
            <Text variant="meta" tone="muted">
              DEV SAMPLE copy. Cancel policy comes from venue.cancellation_allowed / cutoff hours.
            </Text>
          </Sheet>
        </Section>

        <Section title="Toast / Offline / Skeleton">
          <Button label="Toast dikhao" variant="soft" size="md" onPress={() => toast.show({ message: "Copy ho gaya", tone: "success" })} testID="dev-toast" />
          <View style={{ height: 70 }}>
            <ToastView toast={{ message: "Static toast preview", duration: 60_000_000 }} bottomOffset={0} />
          </View>
          <OfflineBanner visible placement="inline" onRetry={() => undefined} />
          <SkeletonCard />
          <SkeletonList cards={1} />
        </Section>

        <Section title="EmptyState / ErrorState">
          <Card>
            <EmptyState title="Koi venue nahi mila" body="Filters kam karein ya doosra din dekhein." actionLabel="Filters hatao" onAction={() => undefined} />
          </Card>
          <Card>
            <ErrorState message="Venue load nahi ho saka." reassurance="Aap ki booking aur paisa mehfooz hain." onRetry={() => undefined} onBack={() => undefined} backLabel="Home par jayein" code="VEN-500" showTopBack />
          </Card>
        </Section>

        <Section title="NotFound (404)">
          <View style={{ height: 560, borderRadius: 30, overflow: "hidden" }}>
            <NotFound onHome={() => undefined} />
          </View>
        </Section>

        <Section title="GlassBar / ActionBar / TabBar (in place)">
          <View style={{ backgroundColor: palette.night, padding: 12, borderRadius: 24, gap: 12 }}>
            <GlassBar floating={false} tone="dark">
              <View style={{ padding: 14 }}>
                <Text tone="onDark">Dark glass (solid on web)</Text>
              </View>
            </GlassBar>
          </View>
          <ActionBar floating={false} caption="Total" value={formatPkr(4000)}>
            <IconButton icon={MessageCircle} accessibilityLabel="Is slot ke baare mein chat mein poochein" variant="mist" />
            <Button label="Book karo" size="md" />
          </ActionBar>
          <View>
            <TabBar floating={false} items={owner ? ownerTabs : playerTabs} fab={owner ? { accessibilityLabel: "Walk-in booking add karein", onPress: () => undefined } : undefined} />
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}
