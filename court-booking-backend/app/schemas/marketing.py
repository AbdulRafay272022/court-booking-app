from pydantic import BaseModel, Field


class AnnouncementIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=1000)


class AnnouncementResultOut(BaseModel):
    sent: int
    skipped_cap_reached: int
