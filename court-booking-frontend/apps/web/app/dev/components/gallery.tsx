"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatPkr, journeySteps, palette, slotChipState, type Role, type SlotChipState, type VenueCardData } from "@court-booking/ui-tokens";
import {
  Badge,
  Banner,
  Bell,
  Button,
  Card,
  Checkbox,
  Chip,
  CountdownRing,
  EmptyState,
  ErrorState,
  FlRoleProvider,
  IconButton,
  Input,
  MessageCircle,
  MoneyRows,
  NotFound,
  OfflineBanner,
  Pill,
  Search,
  SegmentedToggle,
  Settings,
  Sheet,
  SkeletonCard,
  SlotChip,
  StatusPill,
  Stepper,
  Switch,
  Ticket,
  Timeline,
  Toast,
  ToastProvider,
  VenueCard,
  useFlLang,
  useToast,
} from "@/components/fl";

/** DEV SAMPLE photo built from tokens (no network, no real venue photo). */
function samplePhoto(bg: string, label: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='720' height='420'><rect width='720' height='420' fill='${bg}'/><path d='M140 380 200 120h316l60 260zM358 120v260M172 250h372' stroke='${palette.white}' stroke-opacity='0.5' stroke-width='4' fill='none'/><text x='24' y='400' font-family='sans-serif' font-size='26' fill='${palette.white}'>DEV SAMPLE ${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-[12px] font-extrabold tracking-[0.12em] text-fl-muted">{title.toUpperCase()}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  const [role, setRole] = useState<Role>("player");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("role") === "owner") setRole("owner");
  }, []);
  return (
    <FlRoleProvider role={role}>
      <ToastProvider>
        <Inner role={role} setRole={setRole} />
      </ToastProvider>
    </FlRoleProvider>
  );
}

function Inner({ role, setRole }: { role: Role; setRole: (r: Role) => void }) {
  const lang = useFlLang();
  const toast = useToast();
  const owner = role === "owner";
  const [chip, setChip] = useState("padel");
  const [seg, setSeg] = useState<"list" | "map">("list");
  const [check, setCheck] = useState(true);
  const [sw, setSw] = useState(true);
  const [step, setStep] = useState(15);
  const [sheet, setSheet] = useState(false);
  const [saved, setSaved] = useState(false);
  // Dev sample expiry, created after mount so server and client HTML match.
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  useEffect(() => setExpiresAt(new Date(Date.now() + (14 * 60 + 56) * 1000).toISOString()), []);
  const now = Date.parse("2026-10-24T12:00:00Z");
  const base = { starts_at: "2026-10-24T16:00:00Z", status: "available" as const, is_mine: false };
  const slots: { label: string; state: SlotChipState }[] = [
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
    rating: n >= 3 ? 4.3 : null,
    reviewCount: n >= 3 ? 9 : 0,
    priceFrom: n === 0 ? null : formatPkr(2500),
    nextFree: null,
    photos: Array.from({ length: n }, (_, i) => samplePhoto([palette.teal, palette.night, palette.tealDeep, palette.orangeDeep][i % 4], String(i + 1))),
    amenities: amen,
  });

  return (
    <main data-fl-role={role} data-testid="fl-dev" className="min-h-screen bg-fl-ground px-4 py-8 font-fl-body text-fl-night sm:px-8">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-8">
        <header className="flex flex-col gap-2">
          <span className="text-[13px] font-extrabold text-fl-muted">DEV ONLY · {lang}</span>
          <h1 className="m-0 font-fl-display text-[34px] font-extrabold">Floodlight web components</h1>
          <div className="max-w-sm">
            <SegmentedToggle aria-label="Role" value={role} onChange={setRole} options={[{ value: "player", label: "Player" }, { value: "owner", label: "Owner" }]} />
          </div>
        </header>

        <Section title="Button / IconButton">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button label={owner ? "Approve karein" : "Book karo"} onClick={() => toast.show({ message: "Pressed", tone: "success" })} />
            <Button label="Wahi slot" variant="secondary" size="md" />
            <Button label="Home par jayein" variant="soft" size="md" />
            <Button label="Reject" variant="danger" size="md" />
            <Button label="Cancel karein" variant="dangerSolid" size="sm" />
            <Button label="Loading" loading size="md" />
            <Button label="Disabled" disabled size="md" />
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <IconButton icon={Search} aria-label="Search" />
            <IconButton icon={Bell} aria-label="Notifications, 3 nayi" badge={3} variant="mist" />
            <IconButton icon={MessageCircle} aria-label="Chat" variant="primary" />
            <IconButton icon={Settings} aria-label="Settings" variant="night" />
            <span className="flex gap-2 rounded-2xl bg-fl-night p-2">
              <IconButton icon={Search} aria-label="On dark" variant="onDark" />
              <IconButton icon={Search} aria-label="On photo" variant="onPhoto" />
            </span>
          </div>
        </Section>

        <Section title="Chip / Pill / StatusPill / Badge">
          <div className="flex flex-wrap gap-2.5">
            {["padel", "futsal", "cricket"].map((k) => (
              <Chip key={k} label={k[0].toUpperCase() + k.slice(1)} selected={chip === k} onClick={() => setChip(k)} />
            ))}
            <Chip label="Disabled" disabled />
            <Chip label="Amenities" count={6} onClick={() => undefined} />
            <Chip shape="tile" label="Court 1" meta="Padel · Indoor" selected onClick={() => undefined} />
          </div>
          <div className="flex flex-wrap gap-2">
            {(["open", "waiting", "danger", "neutral", "info", "night", "accent"] as const).map((t) => (
              <Pill key={t} label={t} tone={t} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill booking={{ status: "held" }} />
            <StatusPill booking={{ status: "payment_submitted" }} />
            <StatusPill booking={{ status: "booked" }} />
            <StatusPill booking={{ status: "completed" }} />
            <StatusPill booking={{ status: "no_show" }} />
            <StatusPill booking={{ status: "cancelled", cancelled_by: "owner" }} />
            <StatusPill booking={{ status: "cancelled", cancelled_by: "system", cancellation_reason: "hold_expired" }} />
            <Badge count={3} />
          </div>
        </Section>

        <Section title="SlotChip (never colour-only)">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-8">
            {slots.map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <SlotChip state={s.state} label={s.label} onClick={() => undefined} reason={s.state === "blocked" ? "Maintenance" : null} />
                <span className="text-center text-[12px] text-fl-muted">{s.state}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Input / Controls">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Mobile number" prefix="+92" placeholder="300 1234567" help="WhatsApp code isi number par aayega" />
            <Input label="Password" secureToggle defaultValue="password12" />
            <Input label="Naam" defaultValue="A" error="Naam kam az kam 2 harf ka ho" />
            <div className="flex flex-col gap-3">
              <Checkbox checked={check} onChange={setCheck} label="Main Terms aur Privacy se mutafiq hoon" />
              <Switch label="Approve payments" hint="Staff payment approve kar sakta hai" value={sw} onChange={setSw} />
              <SegmentedToggle aria-label="Dikhao" value={seg} onChange={setSeg} options={[{ value: "list", label: "List" }, { value: "map", label: "Naqsha" }]} />
              <SegmentedToggle aria-label="Bookings" tone="role" value={seg} onChange={setSeg} options={[{ value: "list", label: "Aane wali", count: 3 }, { value: "map", label: "Purani", count: 6 }]} />
              <Stepper label="Hold ka waqt" unit="min" value={step} onChange={setStep} min={5} max={180} step={5} help="Default: 15 min" />
            </div>
          </div>
        </Section>

        <Section title="Banner / MoneyRows / Timeline / CountdownRing">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Banner tone="waiting" body="Code galat hai. 3 koshishein baqi hain." />
              <Banner tone="danger" title="Duplicate screenshot" body="Ye screenshot pehle 2 bookings par use hua hai." />
              <MoneyRows rows={[{ label: "Total", value: formatPkr(4000) }, { label: "Mila", value: formatPkr(1000), tone: "open" }, { label: "Baqi", value: formatPkr(3000), strong: true }]} />
            </div>
            <Card>
              <Timeline steps={journeySteps({ status: "payment_submitted" }, lang)} />
            </Card>
            <div className={owner ? "flex flex-wrap gap-4 rounded-fl-card bg-fl-teal-deep p-5" : "flex flex-wrap gap-4 rounded-fl-card bg-fl-night p-5"}>
              <CountdownRing expiresAt={expiresAt} caption="pay karne ke liye" />
              <CountdownRing expiresAt={new Date(0).toISOString()} caption="khatam" diameter={110} />
            </div>
            <CountdownRing expiresAt={expiresAt} tone="light" caption="light tone" />
          </div>
        </Section>

        <Section title="Ticket">
          <div className="grid gap-4 sm:grid-cols-2">
            <Ticket bookingId="00000000-0000-0000-0000-000000000000" booking={{ status: "booked" }} venueName="Demo Arena" eyebrow="PADEL · COURT 1" fields={[{ label: "Din", value: "Mon, 26 Oct" }, { label: "Waqt", value: "5:30 – 7:30 PM" }, { label: "Total", value: formatPkr(4000) }, { label: "Baqi", value: formatPkr(0) }]} />
            <Ticket bookingId="x" booking={{ status: "payment_submitted" }} venueName="Demo Arena (waiting)" fields={[{ label: "Din", value: "Mon, 26 Oct" }]} />
          </div>
        </Section>

        <Section title="VenueCard (3 / 1 / 0 photos) + Amenities popover">
          <div className="grid gap-6 pt-40 sm:grid-cols-2 lg:grid-cols-3" data-testid="fl-dev-cards">
            <VenueCard venue={venue(4, "Demo Arena", ["parking", "washrooms", "changing_room", "floodlights", "drinking_water", "cafe"])} href="#" eager saved={saved} onToggleSave={() => setSaved((s) => !s)} action={{ label: "Slots dekho", href: "#" }} />
            <VenueCard venue={venue(1, "Court 22 with a long name that wraps", ["floodlights", "seating", "equipment_rent", "prayer_area", "wifi", "Rooftop lounge"])} href="#" eager onToggleSave={() => undefined} action={{ label: "Slots dekho", href: "#" }} />
            <VenueCard venue={venue(0, "Smash Point", [])} href="#" action={{ label: "Slots dekho", href: "#" }} />
          </div>
        </Section>

        <Section title="Sheet / Toast / Offline / Skeleton">
          <div className="flex flex-wrap items-center gap-3">
            <Button label="Sheet kholein" variant="secondary" size="md" onClick={() => setSheet(true)} data-testid="fl-dev-open-sheet" />
            <Toast message="Static toast preview" tone="success" />
          </div>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Booking pakki karein?" subtitle="Demo Arena · Court 1" footer={<Button label="Haan, hold karo" block onClick={() => setSheet(false)} />}>
            <MoneyRows rows={[{ label: "Abhi bhejna", value: formatPkr(1000) }, { label: "Venue par baqi", value: formatPkr(3000) }, { label: "Total", value: formatPkr(4000), strong: true }]} />
            <span className="text-[13px] text-fl-muted">DEV SAMPLE copy.</span>
          </Sheet>
          <OfflineBanner visible onRetry={() => undefined} />
          <div className="grid gap-4 sm:grid-cols-3">
            <SkeletonCard />
          </div>
        </Section>

        <Section title="EmptyState / ErrorState / NotFound">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <EmptyState title="Koi venue nahi mila" body="Filters kam karein ya doosra din dekhein." actionLabel="Filters hatao" onAction={() => undefined} />
            </Card>
            <Card>
              <ErrorState message="Venue load nahi ho saka." reassurance="Aap ki booking aur paisa mehfooz hain." onRetry={() => undefined} onBack={() => undefined} backLabel="Home par jayein" code="VEN-500" />
            </Card>
            <div className="overflow-hidden rounded-fl-sheet">
              <NotFound onHome={() => undefined} />
            </div>
          </div>
        </Section>
      </div>
    </main>
  );
}
