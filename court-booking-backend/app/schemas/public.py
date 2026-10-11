from pydantic import BaseModel


class PublicStatsOut(BaseModel):
    """Aggregate counts for the marketing site. Numbers only: no ids, no personal data."""

    venues: int
    courts: int
    bookings: int
    players: int
