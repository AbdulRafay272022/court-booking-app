from fastapi import APIRouter

from app.dependencies import FeatureFlags
from app.schemas.feature_flag import PublicFlagsOut

router = APIRouter(tags=["feature-flags"])


@router.get("/feature-flags", response_model=PublicFlagsOut)
async def public_feature_flags(flags: FeatureFlags) -> PublicFlagsOut:
    """The on/off state of every global flag, so the web and mobile apps can hide
    a disabled feature's entry points (the backend still enforces it regardless)."""
    return PublicFlagsOut(flags=await flags.as_map())
