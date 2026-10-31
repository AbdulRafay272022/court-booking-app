from fastapi import APIRouter

from app.api import (
    admin,
    admin_billing,
    auth,
    availability,
    bookings,
    chat,
    courts,
    favorites,
    feature_flags,
    owner_premium,
    owners,
    payments,
    phase3,
    public,
    reviews,
    stage2,
    staff,
    users,
    venues,
    waitlist,
    web_push,
    webhooks,
)

api_router = APIRouter()

api_router.include_router(phase3.router)  # audit Phase 3 (before users/owners so its fixed paths win)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(web_push.router)
api_router.include_router(favorites.router)
api_router.include_router(venues.router)
api_router.include_router(courts.router)
api_router.include_router(availability.router)
api_router.include_router(bookings.router)
api_router.include_router(payments.router)
api_router.include_router(waitlist.router)
api_router.include_router(reviews.router)
api_router.include_router(owner_premium.router)
api_router.include_router(stage2.owner_router)
api_router.include_router(owners.router)
api_router.include_router(stage2.admin_router)
api_router.include_router(admin.router)
api_router.include_router(admin_billing.router)
api_router.include_router(chat.router)
api_router.include_router(webhooks.router)
api_router.include_router(feature_flags.router)
api_router.include_router(staff.router)
api_router.include_router(public.router)
