from fastapi import APIRouter

from app.api import (
    admin,
    auth,
    availability,
    bookings,
    chat,
    courts,
    owners,
    payments,
    reviews,
    users,
    venues,
    waitlist,
    webhooks,
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(venues.router)
api_router.include_router(courts.router)
api_router.include_router(availability.router)
api_router.include_router(bookings.router)
api_router.include_router(payments.router)
api_router.include_router(waitlist.router)
api_router.include_router(reviews.router)
api_router.include_router(owners.router)
api_router.include_router(admin.router)
api_router.include_router(chat.router)
api_router.include_router(webhooks.router)
