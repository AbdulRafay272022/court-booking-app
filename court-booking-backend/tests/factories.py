"""factory_boy factories that build (unpersisted) ORM instances.

These build plain model objects via `Model(**kwargs)` -- they do not touch the
database. Tests add() and commit() the instances themselves via a db_session
fixture, which keeps these factories usable regardless of which async session
a given test is working with.
"""

import factory
from faker import Faker

from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.court import Court
from app.models.payment import Payment
from app.models.review import Review
from app.models.user import User, UserRole
from app.models.venue import Venue, VenueStatus
from app.models.waitlist import WaitlistEntry

fake = Faker()


class UserFactory(factory.Factory):
    class Meta:
        model = User

    phone = factory.Sequence(lambda n: f"+9230010{n:05d}")
    name = factory.Faker("name")
    role = UserRole.PLAYER


class OwnerFactory(UserFactory):
    role = UserRole.OWNER


class AdminFactory(UserFactory):
    role = UserRole.ADMIN


class VenueFactory(factory.Factory):
    class Meta:
        model = Venue

    name = factory.Faker("company")
    slug = factory.Sequence(lambda n: f"venue-{n}")
    description = factory.Faker("catch_phrase")
    address = factory.Faker("address")
    city = "Karachi"
    location = "SRID=4326;POINT(67.0 24.8)"
    sports = factory.LazyFunction(lambda: ["padel"])
    amenities = factory.LazyFunction(lambda: ["parking", "floodlights"])
    status = VenueStatus.APPROVED


class CourtFactory(factory.Factory):
    class Meta:
        model = Court

    name = factory.Sequence(lambda n: f"Court {n}")
    sport = "padel"
    slot_minutes = 60
    is_active = True


class BookingFactory(factory.Factory):
    class Meta:
        model = Booking

    status = BookingStatus.HELD
    source = BookingSource.APP
    price = 3000
    advance_amount = 3000
    balance_due = 0


class PaymentFactory(factory.Factory):
    class Meta:
        model = Payment

    amount_claimed = 3000


class WaitlistEntryFactory(factory.Factory):
    class Meta:
        model = WaitlistEntry

    is_active = True


class ReviewFactory(factory.Factory):
    class Meta:
        model = Review

    rating = 5
    comment = factory.Faker("sentence")
