import re
import struct
import uuid
from datetime import date, datetime, time, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.court import Court
from app.models.review import Review
from app.models.schedule import ScheduleTemplate
from app.models.user import User, UserRole
from app.models.venue import Venue, VenueStatus
from app.schemas.venue import VenueCreateIn, VenueUpdateIn
from app.services.availability_service import AvailabilityService
from app.services.notification_service import NotificationService
from app.utils.encryption import decrypt_json, encrypt_json
from app.utils.geo import distance_meters, within_radius
from app.utils.timezone import utc_to_pkt_naive
from app.utils.s3 import public_url, upload_public_photo
from app.utils.text import slugify

# Section 32 Part 6: sensible upload caps.
MAX_VENUE_PHOTOS = 8
MAX_COURT_PHOTOS = 5


class VenueService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    async def _generate_unique_slug(self, name: str) -> str:
        base = slugify(name)
        candidate = base
        suffix = 1
        while await self.db.scalar(select(Venue.id).where(Venue.slug == candidate)) is not None:
            suffix += 1
            candidate = f"{base}-{suffix}"
        return candidate

    async def create_venue(self, owner: User, payload: VenueCreateIn) -> Venue:
        venue = Venue(
            owner_id=owner.id,
            name=payload.name,
            slug=await self._generate_unique_slug(payload.name),
            description=payload.description,
            address=payload.address,
            city=payload.city,
            area=payload.area,
            location=f"SRID=4326;POINT({payload.longitude} {payload.latitude})",
            phone=payload.phone,
            whatsapp=payload.whatsapp,
            sports=payload.sports,
            amenities=payload.amenities,
            bank_details=encrypt_json(payload.bank_details.model_dump(), self.settings)
            if payload.bank_details
            else None,
            # one policy per venue (Section 32 Part 4); a cutoff means nothing when cancelling is not allowed
            cancellation_allowed=payload.cancellation_allowed,
            cancellation_cutoff_hours=payload.cancellation_cutoff_hours if payload.cancellation_allowed else None,
            booking_horizon_days=payload.booking_horizon_days,
        )
        self.db.add(venue)
        await self.db.commit()
        venue = await self.get_venue(venue.id)

        await self._notify_admins_new_venue(venue)
        return venue

    async def _notify_admins_new_venue(self, venue: Venue) -> None:
        notifications = NotificationService(self.db, self.settings)
        admins_result = await self.db.execute(select(User).where(User.role == UserRole.ADMIN))
        for admin in admins_result.scalars().all():
            await notifications.notify_venue_pending_review(user=admin, venue_name=venue.name)

    async def get_venue(self, venue_id: uuid.UUID) -> Venue:
        result = await self.db.execute(
            select(Venue)
            .where(Venue.id == venue_id)
            .options(
                selectinload(Venue.courts).selectinload(
                    Court.schedule_templates.and_(ScheduleTemplate.is_active.is_(True))
                ),
                selectinload(Venue.courts).selectinload(Court.pricing_rules),
            )
        )
        venue = result.scalar_one_or_none()
        if venue is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
        return venue

    async def get_venue_by_slug(self, slug: str) -> Venue:
        result = await self.db.execute(
            select(Venue)
            .where(Venue.slug == slug)
            .options(
                selectinload(Venue.courts).selectinload(
                    Court.schedule_templates.and_(ScheduleTemplate.is_active.is_(True))
                ),
                selectinload(Venue.courts).selectinload(Court.pricing_rules),
            )
        )
        venue = result.scalar_one_or_none()
        if venue is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
        return venue

    async def require_owned_venue(
        self, venue_id: uuid.UUID, user: User, permission: str | None = None
    ) -> Venue:
        """Authorize `user` to act on `venue_id`. Admins and the real owner always
        pass. A STAFF user passes only if `permission` is given AND they hold that
        permission at this venue (Section 32 Part 12). Owner-only actions pass no
        permission, so staff are rejected there."""
        venue = await self.get_venue(venue_id)
        if user.role == UserRole.ADMIN or venue.owner_id == user.id:
            return venue
        if user.role == UserRole.STAFF and permission is not None:
            from app.services.staff_service import staff_can

            if await staff_can(self.db, user.id, venue.id, permission):
                return venue
            raise AppError(
                status.HTTP_403_FORBIDDEN,
                ErrorCode.NOT_STAFF_PERMITTED,
                "Your account isn't allowed to do this.",
            )
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")

    async def update_venue(self, venue: Venue, payload: VenueUpdateIn) -> Venue:
        data = payload.model_dump(exclude_unset=True)
        lat = data.pop("latitude", None)
        lon = data.pop("longitude", None)
        bank_details = data.pop("bank_details", "unset")
        for field, value in data.items():
            setattr(venue, field, value)
        if data.get("cancellation_allowed") is False:
            venue.cancellation_cutoff_hours = None  # a cutoff means nothing when cancelling is not allowed
        if bank_details != "unset":
            venue.bank_details = encrypt_json(bank_details, self.settings) if bank_details else None
        if lat is not None and lon is not None:
            venue.location = f"SRID=4326;POINT({lon} {lat})"
        await self.db.commit()
        return await self.get_venue(venue.id)

    async def add_photo(self, venue: Venue, data: bytes, filename: str, content_type: str) -> Venue:
        if len(venue.photos or []) >= MAX_VENUE_PHOTOS:
            raise AppError(
                400, ErrorCode.PHOTO_LIMIT_REACHED, f"A venue can have at most {MAX_VENUE_PHOTOS} photos."
            )
        key = await upload_public_photo(data, filename, content_type)
        venue.photos = [*(venue.photos or []), key]
        await self.db.commit()
        return await self.get_venue(venue.id)

    async def set_photos(self, venue: Venue, keys: list[str]) -> Venue:
        """Reorder / delete / set-cover in one shot (Section 32 Part 6): the client sends the
        desired ORDERED list of the venue's own photo keys. Index 0 is the cover. A key not
        already on this venue is rejected (you can't add via this path -- use add_photo), and
        an omitted key is a delete. The S3 object of a removed key is left in the public bucket
        (harmless orphan); only the reference is dropped."""
        current = set(venue.photos or [])
        if len(keys) != len(set(keys)) or not set(keys).issubset(current):
            raise AppError(400, ErrorCode.INVALID_PHOTO, "Photo list must be a reordering of this venue's own photos.")
        venue.photos = list(keys)
        await self.db.commit()
        return await self.get_venue(venue.id)

    async def set_status(
        self, venue: Venue, status_value: VenueStatus, rejection_reason: str | None = None
    ) -> Venue:
        venue.status = status_value
        venue.rejection_reason = rejection_reason if status_value != VenueStatus.APPROVED else None
        await self.db.commit()
        return await self.get_venue(venue.id)

    async def list_venues(
        self,
        *,
        city: str | None = None,
        sport: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        radius_meters: float = 15000,
        only_approved: bool = True,
        offset: int = 0,
        limit: int = 20,
        area: str | None = None,
        min_price: float | None = None,
        max_price: float | None = None,
        indoor: bool | None = None,
        amenities: list[str] | None = None,
        on_date: date | None = None,
        start_time: time | None = None,
        duration_minutes: int | None = None,
        sort: str | None = None,
    ) -> tuple[list[tuple[Venue, float | None]], int]:
        """Filtered venue search. Venue-level filters (city, area, sport, amenities, radius) run in SQL. Court-level
        filters (indoor, price range, availability at a date/time) must hold for ONE SAME active court -- of the asked
        sport if `sport` is given -- so they are evaluated per court after the SQL filters, availability through
        AvailabilityService (the one source of truth for what is bookable). When any of those (or sort="price") is in
        play the candidates are filtered/sorted in Python and paginated afterwards; otherwise SQL paginates."""
        base_query = select(Venue)
        if only_approved:
            base_query = base_query.where(Venue.status == VenueStatus.APPROVED, Venue.is_active.is_(True))
        if city:
            base_query = base_query.where(func.lower(Venue.city) == city.lower())
        if area:
            base_query = base_query.where(func.lower(Venue.area) == area.strip().lower())
        for i, key in enumerate(amenities or []):
            # ALL requested amenities must be present (case-insensitive); NULL amenities unnest to no rows.
            base_query = base_query.where(
                text(f"EXISTS (SELECT 1 FROM unnest(venues.amenities) AS a WHERE lower(a) = :amenity_{i})").bindparams(
                    **{f"amenity_{i}": key.strip().lower()}
                )
            )
        if sport:
            # Case-insensitive sport match. Venues store a sport as the owner cased
            # it ("Padel"), but the apps filter with a lowercased value ("padel"), so
            # a plain exact `.any(sport)` returned ZERO venues for a live venue and the
            # player saw a stale "no courts" empty state (post-batch backlog #3).
            # Mirror the city filter above and match on lower(). Bound param -> no injection.
            base_query = base_query.where(
                text("EXISTS (SELECT 1 FROM unnest(venues.sports) AS s WHERE lower(s) = lower(:sport))").bindparams(sport=sport)
            )
        if latitude is not None and longitude is not None:
            base_query = base_query.where(within_radius(Venue.location, latitude, longitude, radius_meters))

        court_level = (
            min_price is not None or max_price is not None or indoor is not None or on_date is not None
        )
        in_python = court_level or sort in ("price", "rating")

        query = base_query.options(selectinload(Venue.courts).selectinload(Court.pricing_rules))
        distance_col = None
        if latitude is not None and longitude is not None:
            distance_col = distance_meters(Venue.location, latitude, longitude)
            query = query.add_columns(distance_col.label("distance_meters")).order_by(distance_col)
        else:
            query = query.order_by(Venue.created_at.desc())

        if not in_python:
            total = await self.db.scalar(select(func.count()).select_from(base_query.subquery()))
            result = await self.db.execute(query.offset(offset).limit(limit))
            if distance_col is not None:
                rows = [(row[0], row[1]) for row in result.all()]
            else:
                rows = [(row[0], None) for row in result.all()]
            return rows, total or 0

        result = await self.db.execute(query)
        if distance_col is not None:
            candidates = [(row[0], row[1]) for row in result.all()]
        else:
            candidates = [(row[0], None) for row in result.all()]

        # court-level filters: the courts of each venue that satisfy ALL of them at once
        eligible: dict[uuid.UUID, list[Court]] = {}
        for venue, _dist in candidates:
            courts = []
            for court in venue.courts:
                if not court.is_active or not self._sport_matches(court, sport):
                    continue
                if indoor is not None and court.is_indoor != indoor:
                    continue
                if min_price is not None or max_price is not None:
                    price = AvailabilityService.starts_from_price(court, list(court.pricing_rules))
                    if price is None or (min_price is not None and price < min_price):
                        continue
                    if max_price is not None and price > max_price:
                        continue
                courts.append(court)
            eligible[venue.id] = courts
        if court_level:  # sort=price alone must keep court-less / unpriced venues (they sort last)
            candidates = [(v, d) for v, d in candidates if eligible[v.id]]

        if on_date is not None:
            all_courts = [c for v, _d in candidates for c in eligible[v.id]]
            bookable = await AvailabilityService(self.db).courts_bookable_at(
                all_courts,
                {v.id: v.booking_horizon_days for v, _d in candidates},
                on_date,
                start_time,
                duration_minutes,
            )
            candidates = [(v, d) for v, d in candidates if any(c.id in bookable for c in eligible[v.id])]

        if sort == "price":
            def price_key(row: tuple[Venue, float | None]) -> tuple[bool, float]:
                p = self.min_price(row[0], sport)
                return (p is None, p if p is not None else 0.0)

            candidates.sort(key=price_key)  # stable: ties keep the distance / newest-first order from SQL
        if sort == "rating":
            # best average first, then most reviews; unrated venues last (stable: ties keep distance / newest-first)
            ratings = await self.rating_summaries([v.id for v, _d in candidates])

            def rating_key(row: tuple[Venue, float | None]) -> tuple[bool, float, int]:
                avg, count = ratings[row[0].id]
                return (avg is None, -(avg or 0.0), -count)

            candidates.sort(key=rating_key)
        return candidates[offset : offset + limit], len(candidates)

    @staticmethod
    def _sport_matches(court: Court, sport: str | None) -> bool:
        return not sport or court.sport.lower() == sport.lower()

    @staticmethod
    def min_price(venue: Venue, sport: str | None = None) -> float | None:
        """Lowest starting price (PKR per slot) among the venue's ACTIVE courts, only courts of `sport` when given.
        Derived from each court's active pricing rules exactly like the month calendar's `starts_from_price`.
        Needs `venue.courts[*].pricing_rules` loaded (list_venues does)."""
        prices = [
            p
            for court in venue.courts
            if court.is_active and VenueService._sport_matches(court, sport)
            for p in [AvailabilityService.starts_from_price(court, list(court.pricing_rules))]
            if p is not None
        ]
        return min(prices) if prices else None

    async def list_areas(self) -> list[str]:
        """Distinct non-empty areas of approved, active venues, sorted case-insensitively."""
        result = await self.db.execute(
            select(Venue.area)
            .where(
                Venue.status == VenueStatus.APPROVED,
                Venue.is_active.is_(True),
                Venue.area.is_not(None),
                func.trim(Venue.area) != "",
            )
            .distinct()
        )
        return sorted({a.strip() for (a,) in result.all()}, key=lambda a: (a.lower(), a))

    async def rating_summary(self, venue_id: uuid.UUID) -> tuple[float | None, int]:
        """(average_rating, review_count) over VISIBLE reviews only -- an admin-hidden
        review (Section 32 Part 6) counts for neither."""
        avg, count = (
            await self.db.execute(
                select(func.avg(Review.rating), func.count(Review.id)).where(
                    Review.venue_id == venue_id, Review.is_hidden.is_(False)
                )
            )
        ).one()
        return (round(float(avg), 2) if avg is not None else None, int(count or 0))

    async def rating_summaries(self, venue_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[float | None, int]]:
        """rating_summary for many venues in ONE grouped query (visible reviews only)."""
        out: dict[uuid.UUID, tuple[float | None, int]] = {vid: (None, 0) for vid in venue_ids}
        if not venue_ids:
            return out
        rows = await self.db.execute(
            select(Review.venue_id, func.avg(Review.rating), func.count(Review.id))
            .where(Review.venue_id.in_(venue_ids), Review.is_hidden.is_(False))
            .group_by(Review.venue_id)
        )
        for vid, avg, count in rows.all():
            out[vid] = (round(float(avg), 2) if avg is not None else None, int(count or 0))
        return out

    @staticmethod
    def coordinates(venue: Venue) -> tuple[float | None, float | None]:
        """(latitude, longitude) of the stored POINT, or (None, None) when missing/unreadable. No query, no shapely: the
        column loads as EWKB (a GeoAlchemy2 WKBElement), or as EWKT text on a venue created in this same session."""
        loc = venue.location
        try:
            if isinstance(loc, str):
                m = re.search(r"POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)", loc, re.I)
                return (float(m.group(2)), float(m.group(1))) if m else (None, None)
            raw = loc.data
            data = bytes.fromhex(raw) if isinstance(raw, str) else bytes(raw)
            endian = "<" if data[0] == 1 else ">"
            (geom_type,) = struct.unpack_from(endian + "I", data, 1)
            offset = 5 + (4 if geom_type & 0x20000000 else 0)  # skip the SRID when present
            x, y = struct.unpack_from(endian + "dd", data, offset)
            return float(y), float(x)
        except Exception:
            return None, None

    async def to_list_items(self, rows: list[tuple[Venue, float | None]], *, sport: str | None = None):
        """to_list_item for a whole page with a FIXED number of queries (ratings 1, today's free slots 4), independent
        of the page size. today_free_slots is null if that computation fails. Used by GET /venues and favorites."""
        ratings = await self.rating_summaries([v.id for v, _d in rows])
        courts = [c for v, _d in rows for c in v.courts if c.is_active]
        counts: dict[uuid.UUID, int] | None
        try:
            now = datetime.now(timezone.utc)
            counts = await AvailabilityService(self.db).free_slot_counts_on(courts, utc_to_pkt_naive(now).date(), now)
        except Exception:  # a counting problem must never break the search page
            counts = None
        return [
            await self.to_list_item(
                v,
                distance=d,
                sport=sport,
                rating=ratings[v.id],
                today_free_slots=(
                    sum(counts.get(c.id, 0) for c in v.courts if c.is_active) if counts is not None else None
                ),
            )
            for v, d in rows
        ]

    async def to_list_item(
        self,
        venue: Venue,
        *,
        distance: float | None = None,
        sport: str | None = None,
        rating: tuple[float | None, int] | None = None,
        today_free_slots: int | None = None,
    ):
        """The search-card shape (VenueListItemOut) for one venue; prefer to_list_items for a page (no per-venue queries).
        Needs `venue.courts[*].pricing_rules` loaded (for min_price)."""
        from app.schemas.venue import VenueListItemOut

        avg, count = rating if rating is not None else await self.rating_summary(venue.id)
        active = [c for c in venue.courts if c.is_active]
        lat, lng = self.coordinates(venue)
        return VenueListItemOut(
            id=venue.id,
            name=venue.name,
            slug=venue.slug,
            city=venue.city,
            area=venue.area,
            sports=venue.sports,
            amenities=venue.amenities or [],
            photo_urls=VenueService.photo_urls(venue),
            status=venue.status,
            average_rating=avg,
            review_count=count,
            distance_meters=distance,
            min_price=VenueService.min_price(venue, sport),
            has_indoor=any(c.is_indoor for c in active),
            has_outdoor=any(not c.is_indoor for c in active),
            today_free_slots=today_free_slots,
            latitude=lat,
            longitude=lng,
        )

    async def average_rating(self, venue_id: uuid.UUID) -> float | None:
        avg, _count = await self.rating_summary(venue_id)
        return avg

    def decrypted_bank_details(self, venue: Venue) -> dict | None:
        return decrypt_json(venue.bank_details, self.settings)

    @staticmethod
    def photo_urls(venue: Venue) -> list[str]:
        return [public_url(key) for key in (venue.photos or [])]

    async def to_out(self, venue: Venue, *, requesting_user: User | None = None, distance: float | None = None):
        """Owner/admin shape (VenueOut). Kept for endpoints where the caller is guaranteed to
        be the owner or an admin (e.g. /owners/venues, admin surfaces). Public / mixed-audience
        endpoints should use `to_out_for` instead, which returns a shape structurally incapable
        of leaking bank_details / checkin_qr_token to anyone but the owner."""
        from app.schemas.venue import VenueOut

        out = VenueOut.model_validate(venue)
        out.photo_urls = self.photo_urls(venue)
        out.photo_keys = list(venue.photos or [])
        out.average_rating, out.review_count = await self.rating_summary(venue.id)
        out.distance_meters = distance
        can_see_bank_details = requesting_user is not None and (
            requesting_user.role == UserRole.ADMIN or requesting_user.id == venue.owner_id
        )
        out.bank_details = self.decrypted_bank_details(venue) if can_see_bank_details else None
        # checkin_qr_token isn't encrypted like bank_details, so model_validate
        # above already populated it from the ORM object -- explicitly clear
        # it for anyone who isn't the owner/admin rather than relying on a
        # field that defaults to populated.
        if not can_see_bank_details:
            out.checkin_qr_token = None
        return out

    async def to_out_for(
        self, venue: Venue, *, requesting_user: User | None = None, distance: float | None = None
    ):
        """QA signup-venue round item 10: returns VenueOut (with bank_details / checkin_qr_token)
        only when the caller is the venue's own owner or an admin. Otherwise returns
        VenuePublicOut, which does NOT have those fields at all -- so a future code path that
        forgets to null them can't leak them. This is the "structural split" the round asked for
        as defense-in-depth on top of the field-level nulling already in `to_out`."""
        from app.schemas.venue import VenuePublicOut

        is_owner_or_admin = requesting_user is not None and (
            requesting_user.role == UserRole.ADMIN or requesting_user.id == venue.owner_id
        )
        if is_owner_or_admin:
            return await self.to_out(venue, requesting_user=requesting_user, distance=distance)
        # Public shape: build directly, never touch bank_details / checkin_qr_token on the wire.
        out = VenuePublicOut.model_validate(venue)
        out.photo_urls = self.photo_urls(venue)
        out.photo_keys = list(venue.photos or [])
        out.average_rating, out.review_count = await self.rating_summary(venue.id)
        out.distance_meters = distance
        return out
