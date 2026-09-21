"""venue cancellation policy and overlap-proof bookings

Section 32 Part 4.

1. venues.cancellation_allowed / venues.cancellation_cutoff_hours: the cancellation policy becomes ONE
   policy per venue (reverses Section 31's per-court policy). Backfilled from each venue's courts, taking
   the most player-friendly values when a venue's courts disagree (the venues where they did are printed
   below so the owner can be told). The old courts.cancellation_* columns are left in place, unused and
   marked deprecated, for one release so this migration is reversible; nothing reads or writes them.

2. bookings gets an EXCLUDE constraint (btree_gist) that refuses any two live bookings on the same court
   whose [starts_at, ends_at) ranges overlap, so a multi-slot booking can never overlap another. The old
   one_live_booking_per_slot unique index is deliberately kept. Before adding the constraint this checks that
   every booking has ends_at > starts_at and that no two live bookings already overlap, and stops with a
   readable message (changing nothing) if either is untrue.

   CREATE EXTENSION btree_gist lives HERE (not in bootstrap.sh db-init) because, unlike PostGIS, btree_gist is
   a "trusted" extension since PostgreSQL 13: the migration's own database user (court_admin, who owns the
   database on RDS) may create it without rds_superuser, and CREATE EXTENSION IF NOT EXISTS is idempotent.
   That keeps the migration self-contained: it works the same on a fresh install, locally and on RDS.
   PostGIS stays in db-init because it must exist before the first migration runs.

Revision ID: dd23d75cf310
Revises: 19cf7e553535
Create Date: 2026-09-22 09:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dd23d75cf310'
down_revision: Union[str, None] = '19cf7e553535'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LIVE = "('held', 'payment_submitted', 'booked')"


def _preflight_bookings(conn) -> None:
    bad = conn.execute(
        sa.text("SELECT id, court_id, starts_at, ends_at FROM bookings WHERE ends_at IS NULL OR ends_at <= starts_at")
    ).fetchall()
    if bad:
        rows = "\n".join(f"  booking {r.id} court {r.court_id}: starts_at={r.starts_at} ends_at={r.ends_at}" for r in bad)
        raise RuntimeError(
            f"Cannot add the overlap constraint: {len(bad)} booking(s) have no valid ends_at "
            f"(ends_at must be later than starts_at). Nothing was changed. Fix these rows first:\n{rows}"
        )
    clash = conn.execute(
        sa.text(
            f"""
            SELECT a.id AS a_id, b.id AS b_id, a.court_id, a.starts_at AS a_start, a.ends_at AS a_end,
                   b.starts_at AS b_start, b.ends_at AS b_end
            FROM bookings a
            JOIN bookings b ON a.court_id = b.court_id AND a.id < b.id
            WHERE a.status IN {LIVE} AND b.status IN {LIVE}
              AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
            """
        )
    ).fetchall()
    if clash:
        rows = "\n".join(
            f"  {r.a_id} [{r.a_start} -> {r.a_end}) overlaps {r.b_id} [{r.b_start} -> {r.b_end}) on court {r.court_id}"
            for r in clash
        )
        raise RuntimeError(
            f"Cannot add the overlap constraint: {len(clash)} pair(s) of live bookings already overlap. "
            f"Nothing was changed. Resolve these first:\n{rows}"
        )


def upgrade() -> None:
    conn = op.get_bind()

    # 1. venue-level cancellation policy ------------------------------------------------------
    op.add_column('venues', sa.Column('cancellation_allowed', sa.Boolean(), server_default=sa.text('true'), nullable=False))
    op.add_column('venues', sa.Column('cancellation_cutoff_hours', sa.Integer(), nullable=True))

    # Most player-friendly values across a venue's courts: allowed if ANY court allows it; then no cutoff
    # if any allowing court has none, otherwise the SHORTEST cutoff (the most permissive window).
    disagree = conn.execute(
        sa.text(
            """
            SELECT v.name, count(*) AS courts,
                   string_agg(c.name || ': ' || CASE WHEN c.cancellation_allowed THEN 'allowed'
                              || COALESCE(', up to ' || c.cancellation_cutoff_hours || 'h before', ', any time')
                              ELSE 'not allowed' END, ' | ' ORDER BY c.name) AS detail
            FROM venues v JOIN courts c ON c.venue_id = v.id
            GROUP BY v.id, v.name
            HAVING count(DISTINCT (c.cancellation_allowed, c.cancellation_cutoff_hours)) > 1
            """
        )
    ).fetchall()
    conn.execute(
        sa.text(
            """
            UPDATE venues v SET
                cancellation_allowed = agg.allowed,
                cancellation_cutoff_hours = agg.cutoff
            FROM (
                SELECT venue_id,
                       bool_or(cancellation_allowed) AS allowed,
                       CASE WHEN bool_or(cancellation_allowed AND cancellation_cutoff_hours IS NULL) THEN NULL
                            ELSE min(cancellation_cutoff_hours) FILTER (WHERE cancellation_allowed) END AS cutoff
                FROM courts GROUP BY venue_id
            ) agg
            WHERE agg.venue_id = v.id
            """
        )
    )
    print("\n[migration dd23d75cf310] venues.cancellation_* backfilled from courts.")
    if disagree:
        print(f"[migration dd23d75cf310] {len(disagree)} venue(s) whose courts DISAGREED (most player-friendly values used):")
        for r in disagree:
            print(f"    - {r.name}: {r.detail}")
    else:
        print("[migration dd23d75cf310] no venue had courts that disagreed.")

    # 2. overlap-proof bookings ----------------------------------------------------------------
    _preflight_bookings(conn)
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute(
        f"""
        ALTER TABLE bookings ADD CONSTRAINT no_overlapping_live_bookings
        EXCLUDE USING gist (court_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
        WHERE (status IN {LIVE})
        """
    )
    n = conn.execute(sa.text("SELECT count(*) FROM bookings")).scalar()
    print(f"[migration dd23d75cf310] no_overlapping_live_bookings added; {n} existing booking(s) satisfied it.")


def downgrade() -> None:
    conn = op.get_bind()
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_overlapping_live_bookings")
    # The code being downgraded to reads the per-court columns, so put the venue's CURRENT policy back on
    # every one of its courts (an owner may have changed it since the upgrade) before dropping the venue columns.
    conn.execute(
        sa.text(
            """
            UPDATE courts c SET cancellation_allowed = v.cancellation_allowed,
                                cancellation_cutoff_hours = v.cancellation_cutoff_hours
            FROM venues v WHERE c.venue_id = v.id
            """
        )
    )
    op.drop_column('venues', 'cancellation_cutoff_hours')
    op.drop_column('venues', 'cancellation_allowed')
    # btree_gist is intentionally left installed: dropping an extension is not needed for a downgrade and
    # could break anything else that came to rely on it.
